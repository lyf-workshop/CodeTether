#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StartupFailureKind {
    HostBinaryMissing,
    HostSpawnFailed,
    ExistingCodeTetherHost,
    PortConflict,
    HostExited,
    ReadinessTimeout,
    ProtocolIncompatible,
    TrayUnavailable,
    LifecycleUnavailable,
}

impl StartupFailureKind {
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
    let owner = None;
    show_with_optional_owner(kind, owner);
}

#[cfg(windows)]
type NativeWindow = windows_sys::Win32::Foundation::HWND;

#[cfg(not(windows))]
type NativeWindow = *mut std::ffi::c_void;

fn show_with_optional_owner(kind: StartupFailureKind, owner: Option<NativeWindow>) {
    eprintln!("[codetether:desktop] {}: {}", kind.title(), kind.message());
    if std::env::var_os("CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG").is_some() {
        return;
    }

    #[cfg(windows)]
    unsafe {
        use std::iter;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

        let title = kind
            .title()
            .encode_utf16()
            .chain(iter::once(0))
            .collect::<Vec<_>>();
        let message = kind
            .message()
            .encode_utf16()
            .chain(iter::once(0))
            .collect::<Vec<_>>();
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

    #[test]
    fn startup_failures_are_specific_and_safe() {
        let messages = [
            StartupFailureKind::HostBinaryMissing,
            StartupFailureKind::HostSpawnFailed,
            StartupFailureKind::ExistingCodeTetherHost,
            StartupFailureKind::PortConflict,
            StartupFailureKind::HostExited,
            StartupFailureKind::ReadinessTimeout,
            StartupFailureKind::ProtocolIncompatible,
            StartupFailureKind::TrayUnavailable,
            StartupFailureKind::LifecycleUnavailable,
        ]
        .map(StartupFailureKind::message);

        assert_eq!(messages.len(), 9);
        assert!(messages.iter().all(|message| !message.is_empty()));
        assert!(messages.iter().all(|message| !message.contains("JSON-RPC")));
    }
}
