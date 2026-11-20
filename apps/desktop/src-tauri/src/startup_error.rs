#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StartupFailureKind {
    HostBinaryMissing,
    HostSpawnFailed,
    ExistingCodeTetherHost,
    PortConflict,
    HostExited,
    DatabaseFromNewerVersion,
    ReadinessTimeout,
    ProtocolIncompatible,
    TrayUnavailable,
    LifecycleUnavailable,
}

impl StartupFailureKind {
    const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::HostBinaryMissing => "host_binary_missing",
            Self::HostSpawnFailed => "host_spawn_failed",
            Self::ExistingCodeTetherHost => "existing_host",
            Self::PortConflict => "port_conflict",
            Self::HostExited => "host_exited",
            Self::DatabaseFromNewerVersion => "database_from_newer_version",
            Self::ReadinessTimeout => "readiness_timeout",
            Self::ProtocolIncompatible => "protocol_incompatible",
            Self::TrayUnavailable => "tray_unavailable",
            Self::LifecycleUnavailable => "lifecycle_unavailable",
        }
    }

    pub const fn title(self) -> &'static str {
        "CodeTether 启动失败"
    }

    pub const fn message(self) -> &'static str {
        match self {
            Self::HostBinaryMissing => "找不到 CodeTether 本地服务程序。请重新安装 CodeTether。",
            Self::HostSpawnFailed => "无法启动 CodeTether 本地服务。请查看诊断日志后重试。",
            Self::ExistingCodeTetherHost => {
                "CodeTether 本地服务已在运行。请关闭其他 CodeTether Host 后重试。"
            }
            Self::PortConflict => "本地端口 4317 已被其他程序占用。请释放该端口后重试。",
            Self::HostExited => "CodeTether 本地服务意外退出。请重新启动 CodeTether。",
            Self::DatabaseFromNewerVersion => {
                "这份本机数据来自更新版本的 CodeTether，当前版本不能打开。请安装更新的版本，或按说明恢复更新前的备份。"
            }
            Self::ReadinessTimeout => "CodeTether 本地服务启动超时。请查看诊断日志后重试。",
            Self::ProtocolIncompatible => {
                "桌面程序与本地服务版本不兼容。请重新安装同一版本的 CodeTether。"
            }
            Self::TrayUnavailable => "无法创建 CodeTether 系统托盘入口。请重新启动 CodeTether。",
            Self::LifecycleUnavailable => {
                "CodeTether 无法初始化 Windows 后台运行。请重新启动 CodeTether。"
            }
        }
    }
}

pub fn show(kind: StartupFailureKind) {
    show_with_optional_owner(kind, None);
}

pub fn show_for_window<R: tauri::Runtime>(
    kind: StartupFailureKind,
    window: &tauri::WebviewWindow<R>,
) {
    #[cfg(windows)]
    let owner = window.hwnd().ok().map(|handle| handle.0);
    #[cfg(not(windows))]
    let owner = {
        let _ = window;
        None
    };
    show_with_optional_owner(kind, owner);
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostExitDialog {
    Startup(StartupFailureKind),
    Stopped,
}

#[cfg(windows)]
impl HostExitDialog {
    pub fn new(surface_initialized: bool, startup_failure: StartupFailureKind) -> Self {
        if surface_initialized {
            Self::Stopped
        } else {
            Self::Startup(startup_failure)
        }
    }

    const fn title(self) -> &'static str {
        match self {
            Self::Startup(failure) => failure.title(),
            Self::Stopped => "CodeTether 本地服务已停止",
        }
    }

    const fn message(self) -> &'static str {
        match self {
            Self::Startup(failure) => failure.message(),
            Self::Stopped => {
                "已保存的项目和对话仍保留在这台电脑上。你可以重启 CodeTether，或安全退出。"
            }
        }
    }
}

#[cfg(windows)]
const RESTART_BUTTON_ID: i32 = 100;

#[cfg(windows)]
fn restart_selected(dialog_succeeded: bool, button: i32) -> bool {
    dialog_succeeded && button == RESTART_BUTTON_ID
}

#[cfg(windows)]
pub fn show_host_exit<R: tauri::Runtime>(
    dialog: HostExitDialog,
    window: Option<&tauri::WebviewWindow<R>>,
) -> bool {
    use windows_sys::Win32::UI::{
        Controls::{
            TASKDIALOG_BUTTON, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TD_ERROR_ICON,
            TDF_ALLOW_DIALOG_CANCELLATION, TDF_POSITION_RELATIVE_TO_WINDOW, TaskDialogIndirect,
        },
        WindowsAndMessaging::IDCANCEL,
    };

    let owner = window.and_then(|window| window.hwnd().ok().map(|handle| handle.0));
    if let HostExitDialog::Startup(failure) = dialog {
        show_with_optional_owner(failure, owner);
        return false;
    }

    let title = dialog.title();
    let message = dialog.message();
    eprintln!("[codetether:desktop] {title}: {message}");
    let shown = !suppress_dialog();
    crate::desktop_diagnostics::dialog("host_stopped", shown);
    if !shown {
        return false;
    }

    let title = wide(title);
    let content = wide(message);
    let restart = wide("重启 CodeTether");
    let exit = wide("退出 CodeTether");
    let buttons = [
        TASKDIALOG_BUTTON {
            nButtonID: RESTART_BUTTON_ID,
            pszButtonText: restart.as_ptr(),
        },
        TASKDIALOG_BUTTON {
            nButtonID: IDCANCEL,
            pszButtonText: exit.as_ptr(),
        },
    ];
    let config = TASKDIALOGCONFIG {
        cbSize: size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: owner.unwrap_or(std::ptr::null_mut()),
        dwFlags: TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW,
        pszWindowTitle: title.as_ptr(),
        pszContent: content.as_ptr(),
        Anonymous1: TASKDIALOGCONFIG_0 {
            pszMainIcon: TD_ERROR_ICON,
        },
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        nDefaultButton: IDCANCEL,
        ..Default::default()
    };
    let mut button = 0;
    // All strings and native button definitions live through this synchronous call.
    let result = unsafe {
        TaskDialogIndirect(
            &config,
            &mut button,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result < 0 {
        eprintln!("[codetether:desktop] could not show the local service dialog: {result:#x}");
        show_windows_message(
            owner,
            dialog.title(),
            "已保存的项目和对话仍保留在这台电脑上。退出后，你可以重新打开 CodeTether。",
        );
    }
    restart_selected(result >= 0, button)
}

#[cfg(windows)]
type NativeWindow = windows_sys::Win32::Foundation::HWND;

#[cfg(not(windows))]
type NativeWindow = *mut std::ffi::c_void;

fn show_with_optional_owner(kind: StartupFailureKind, owner: Option<NativeWindow>) {
    eprintln!("[codetether:desktop] {}: {}", kind.title(), kind.message());
    #[cfg(not(windows))]
    {
        let _ = owner;
        crate::desktop_diagnostics::dialog(kind.diagnostic_code(), false);
    }
    #[cfg(windows)]
    {
        let shown = !suppress_dialog();
        crate::desktop_diagnostics::dialog(kind.diagnostic_code(), shown);
        if shown {
            show_windows_message(owner, kind.title(), kind.message());
        }
    }
}

#[cfg(windows)]
fn suppress_dialog() -> bool {
    std::env::var_os("CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG").is_some()
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn show_windows_message(owner: Option<NativeWindow>, title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

    let title = wide(title);
    let message = wide(message);
    unsafe {
        MessageBoxW(
            owner.unwrap_or(std::ptr::null_mut()),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::StartupFailureKind;

    #[cfg(windows)]
    #[test]
    fn host_exit_message_depends_on_whether_desktop_opened() {
        use super::HostExitDialog;

        let startup = HostExitDialog::new(false, StartupFailureKind::HostExited);
        assert_eq!(startup.title(), "CodeTether 启动失败");
        assert_eq!(
            startup.message(),
            "CodeTether 本地服务意外退出。请重新启动 CodeTether。"
        );
        let stopped = HostExitDialog::new(true, StartupFailureKind::HostExited);
        assert_eq!(stopped.title(), "CodeTether 本地服务已停止");
        assert!(
            stopped
                .message()
                .contains("已保存的项目和对话仍保留在这台电脑上。")
        );
    }

    #[cfg(windows)]
    #[test]
    fn host_stop_dialog_requires_explicit_restart_selection() {
        use super::{RESTART_BUTTON_ID, restart_selected};
        use windows_sys::Win32::UI::WindowsAndMessaging::IDCANCEL;

        assert!(restart_selected(true, RESTART_BUTTON_ID));
        assert!(!restart_selected(true, IDCANCEL));
        assert!(!restart_selected(true, 0));
        assert!(!restart_selected(false, RESTART_BUTTON_ID));
    }

    #[test]
    fn startup_failures_are_specific_and_safe() {
        let messages = [
            StartupFailureKind::HostBinaryMissing,
            StartupFailureKind::HostSpawnFailed,
            StartupFailureKind::ExistingCodeTetherHost,
            StartupFailureKind::PortConflict,
            StartupFailureKind::HostExited,
            StartupFailureKind::DatabaseFromNewerVersion,
            StartupFailureKind::ReadinessTimeout,
            StartupFailureKind::ProtocolIncompatible,
            StartupFailureKind::TrayUnavailable,
            StartupFailureKind::LifecycleUnavailable,
        ]
        .map(StartupFailureKind::message);

        assert_eq!(messages.len(), 10);
        assert!(messages.iter().all(|message| !message.is_empty()));
        assert!(messages.iter().all(|message| !message.contains("JSON-RPC")));
    }
}
