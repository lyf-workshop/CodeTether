#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StartupFailureKind {
    HostBinaryMissing,
    HostSpawnFailed,
    ExistingCodeTetherHost,
    PortConflict,
    HostExited,
    ReadinessTimeout,
    ProtocolIncompatible,
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
        }
    }
}

pub fn show(kind: StartupFailureKind) {
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
            std::ptr::null_mut(),
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
        ]
        .map(StartupFailureKind::message);

        assert_eq!(messages.len(), 7);
        assert!(messages.iter().all(|message| !message.is_empty()));
        assert!(messages.iter().all(|message| !message.contains("JSON-RPC")));
    }
}
