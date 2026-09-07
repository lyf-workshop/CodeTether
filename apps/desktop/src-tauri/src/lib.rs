mod attention_notifications;
mod desktop_lifecycle;
mod host_supervisor;
mod project_directory_picker;
mod provider_guidance;
mod startup_error;
mod system_tray;
mod windows_lifecycle;

pub fn run() {
    host_supervisor::run_desktop();
}
