#[cfg(windows)]
mod platform {
    use std::{
        panic::{AssertUnwindSafe, catch_unwind},
        sync::atomic::{AtomicBool, Ordering},
    };

    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::{
        Foundation::{FALSE, HWND, LPARAM, LRESULT, TRUE, WPARAM},
        System::RemoteDesktop::{
            NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification,
            WTSUnRegisterSessionNotification,
        },
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                ENDSESSION_CRITICAL, ENDSESSION_LOGOFF, PBT_APMRESUMEAUTOMATIC,
                PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WM_ENDSESSION, WM_NCDESTROY,
                WM_POWERBROADCAST, WM_QUERYENDSESSION, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK,
                WTS_SESSION_UNLOCK,
            },
        },
    };

    use crate::host_supervisor::{
        SessionEndReason, cancel_windows_session_end, confirm_windows_session_end,
        confirm_windows_suspend, handle_windows_session_change, query_windows_session_end,
        resume_windows_runtime,
    };

    const SUBCLASS_ID: usize = 0x4354_4C43;

    struct LifecycleHookContext {
        app: AppHandle,
        session_notifications_registered: AtomicBool,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum WindowsLifecycleMessage {
        Suspended,
        Resume,
        SessionLocked,
        SessionUnlocked,
        SessionEndQuery(SessionEndReason),
        SessionEndCancelled,
        SessionEndConfirmed(SessionEndReason),
    }

    pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "the configured main window is unavailable".to_owned())?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        let context = Box::new(LifecycleHookContext {
            app: app.clone(),
            session_notifications_registered: AtomicBool::new(false),
        });
        let context = Box::into_raw(context);

        let subclassed = unsafe {
            SetWindowSubclass(
                hwnd,
                Some(lifecycle_subclass_proc),
                SUBCLASS_ID,
                context as usize,
            )
        };
        if subclassed == FALSE {
            unsafe { drop(Box::from_raw(context)) };
            return Err(format!(
                "could not attach the Windows lifecycle hook: {}",
                std::io::Error::last_os_error()
            ));
        }

        let registered = unsafe { WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) };
        if registered == FALSE {
            // Lock/unlock observation is diagnostic-only and can be
            // temporarily unavailable while Terminal Services starts. Power
            // and end-session handling remain installed and authoritative.
            eprintln!(
                "[codetether:lifecycle] Windows lock/unlock notifications are unavailable: {}",
                std::io::Error::last_os_error()
            );
        } else {
            unsafe {
                (*context)
                    .session_notifications_registered
                    .store(true, Ordering::Release);
            }
        }
        eprintln!("[codetether:lifecycle] Windows power/session hook registered");
        Ok(())
    }

    unsafe extern "system" fn lifecycle_subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        reference_data: usize,
    ) -> LRESULT {
        if message == WM_NCDESTROY {
            let context = reference_data as *mut LifecycleHookContext;
            if !context.is_null() {
                if unsafe {
                    (*context)
                        .session_notifications_registered
                        .swap(false, Ordering::AcqRel)
                } {
                    unsafe { WTSUnRegisterSessionNotification(hwnd) };
                }
                unsafe {
                    RemoveWindowSubclass(hwnd, Some(lifecycle_subclass_proc), SUBCLASS_ID);
                }
                let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
                unsafe { drop(Box::from_raw(context)) };
                return result;
            }
        }

        let context = reference_data as *const LifecycleHookContext;
        if context.is_null() {
            return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        }
        let app = unsafe { &(*context).app };
        let Some(lifecycle_message) = map_windows_message(message, wparam, lparam) else {
            return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        };
        let dispatch = || match lifecycle_message {
            WindowsLifecycleMessage::Suspended => {
                confirm_windows_suspend(app);
                TRUE as LRESULT
            }
            WindowsLifecycleMessage::Resume => {
                resume_windows_runtime(app);
                TRUE as LRESULT
            }
            WindowsLifecycleMessage::SessionLocked => {
                handle_windows_session_change(app, true);
                0
            }
            WindowsLifecycleMessage::SessionUnlocked => {
                handle_windows_session_change(app, false);
                0
            }
            WindowsLifecycleMessage::SessionEndQuery(reason) => {
                query_windows_session_end(app, reason);
                // Microsoft requires an immediate TRUE response; cleanup is
                // deferred until WM_ENDSESSION confirms the session end.
                TRUE as LRESULT
            }
            WindowsLifecycleMessage::SessionEndCancelled => {
                cancel_windows_session_end(app);
                unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
            }
            WindowsLifecycleMessage::SessionEndConfirmed(reason) => {
                confirm_windows_session_end(app, reason);
                // Chain after the bounded drain so Tao/Windows can complete
                // the actual application/session teardown. Swallowing this
                // message would leave a drained Desktop and Tray alive.
                unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
            }
        };
        match catch_unwind(AssertUnwindSafe(dispatch)) {
            Ok(result) => result,
            // Never perform fallible diagnostic I/O after catching a panic:
            // a second panic must not cross this extern "system" boundary.
            Err(_) => match lifecycle_message {
                WindowsLifecycleMessage::Suspended
                | WindowsLifecycleMessage::Resume
                | WindowsLifecycleMessage::SessionEndQuery(_) => TRUE as LRESULT,
                WindowsLifecycleMessage::SessionEndCancelled
                | WindowsLifecycleMessage::SessionEndConfirmed(_) => unsafe {
                    DefSubclassProc(hwnd, message, wparam, lparam)
                },
                WindowsLifecycleMessage::SessionLocked
                | WindowsLifecycleMessage::SessionUnlocked => 0,
            },
        }
    }

    fn map_windows_message(
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> Option<WindowsLifecycleMessage> {
        match message {
            WM_POWERBROADCAST => match wparam as u32 {
                PBT_APMSUSPEND => Some(WindowsLifecycleMessage::Suspended),
                PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
                    Some(WindowsLifecycleMessage::Resume)
                }
                _ => None,
            },
            WM_WTSSESSION_CHANGE => match wparam as u32 {
                WTS_SESSION_LOCK => Some(WindowsLifecycleMessage::SessionLocked),
                WTS_SESSION_UNLOCK => Some(WindowsLifecycleMessage::SessionUnlocked),
                _ => None,
            },
            WM_QUERYENDSESSION => Some(WindowsLifecycleMessage::SessionEndQuery(
                session_end_reason(lparam),
            )),
            WM_ENDSESSION if wparam == FALSE as usize => {
                Some(WindowsLifecycleMessage::SessionEndCancelled)
            }
            WM_ENDSESSION => Some(WindowsLifecycleMessage::SessionEndConfirmed(
                session_end_reason(lparam),
            )),
            _ => None,
        }
    }

    fn session_end_reason(lparam: LPARAM) -> SessionEndReason {
        let flags = lparam as u32;
        SessionEndReason {
            critical: flags & ENDSESSION_CRITICAL != 0,
            logoff: flags & ENDSESSION_LOGOFF != 0,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn power_messages_map_to_bounded_lifecycle_semantics() {
            assert_eq!(
                map_windows_message(WM_POWERBROADCAST, PBT_APMSUSPEND as _, 0),
                Some(WindowsLifecycleMessage::Suspended)
            );
            assert_eq!(
                map_windows_message(WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC as _, 0),
                Some(WindowsLifecycleMessage::Resume)
            );
        }

        #[test]
        fn lock_and_unlock_messages_are_distinct() {
            assert_eq!(
                map_windows_message(WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK as _, 7),
                Some(WindowsLifecycleMessage::SessionLocked)
            );
            assert_eq!(
                map_windows_message(WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK as _, 7),
                Some(WindowsLifecycleMessage::SessionUnlocked)
            );
        }

        #[test]
        fn session_end_flags_are_a_bitmask_and_cancellation_is_preserved() {
            let flags = (ENDSESSION_LOGOFF | ENDSESSION_CRITICAL) as isize;
            assert_eq!(
                map_windows_message(WM_QUERYENDSESSION, 0, flags),
                Some(WindowsLifecycleMessage::SessionEndQuery(SessionEndReason {
                    critical: true,
                    logoff: true,
                }))
            );
            assert_eq!(
                map_windows_message(WM_ENDSESSION, FALSE as _, flags),
                Some(WindowsLifecycleMessage::SessionEndCancelled)
            );
            assert_eq!(
                map_windows_message(WM_ENDSESSION, TRUE as _, flags),
                Some(WindowsLifecycleMessage::SessionEndConfirmed(
                    SessionEndReason {
                        critical: true,
                        logoff: true,
                    }
                ))
            );
        }
    }
}

#[cfg(windows)]
pub(crate) use platform::install;

#[cfg(target_os = "macos")]
pub(crate) use crate::macos_lifecycle::install;

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn install(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
