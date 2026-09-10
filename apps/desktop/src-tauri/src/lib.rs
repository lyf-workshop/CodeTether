mod attention_notifications;
mod desktop_lifecycle;
mod host_supervisor;
mod macos_lifecycle;
#[cfg(target_os = "macos")]
mod macos_notifications;
mod project_directory_picker;
mod provider_guidance;
mod startup_error;
mod system_tray;
mod windows_lifecycle;

pub fn run() {
    #[cfg(unix)]
    if let Some(code) = codetether_posix_supervisor::guardian_entry() {
        std::process::exit(code);
    }
    host_supervisor::run_desktop();
}
