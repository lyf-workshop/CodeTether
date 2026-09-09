//! NSWorkspace notifications feed the existing generation/coalescing authority.
//! No new reconnect worker, re-pair, session hydration, or Prompt retry exists.
#[cfg(target_os = "macos")]
mod platform {
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
    use std::{cell::RefCell, ptr::NonNull};

    struct Observers {
        center: Retained<NSNotificationCenter>,
        tokens: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    }
    impl Drop for Observers {
        fn drop(&mut self) {
            for token in &self.tokens {
                unsafe {
                    let observer = <ProtocolObject<dyn NSObjectProtocol> as AsRef<
                        objc2::runtime::AnyObject,
                    >>::as_ref(token);
                    self.center.removeObserver(observer);
                }
            }
        }
    }
    thread_local! { static OBSERVERS: RefCell<Option<Observers>> = const { RefCell::new(None) }; }

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        OBSERVERS.with(|slot| {
            if slot.borrow().is_some() {
                return Ok(());
            }
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let mut tokens = Vec::new();
            for waking in [false, true] {
                let app = app.clone();
                let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
                    let target = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if waking {
                            crate::host_supervisor::resume_windows_runtime(&target);
                        } else {
                            crate::host_supervisor::confirm_windows_suspend(&target);
                        }
                    });
                });
                unsafe {
                    let name = if waking {
                        NSWorkspaceDidWakeNotification
                    } else {
                        NSWorkspaceWillSleepNotification
                    };
                    tokens.push(center.addObserverForName_object_queue_usingBlock(
                        Some(name),
                        None,
                        None,
                        &callback,
                    ));
                }
            }
            *slot.borrow_mut() = Some(Observers { center, tokens });
            Ok(())
        })
    }
}

#[cfg(target_os = "macos")]
pub(crate) use platform::install;
