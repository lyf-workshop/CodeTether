mod attention_notifications;
mod host_supervisor;
mod project_directory_picker;
mod startup_error;
mod system_tray;

pub fn run() {
    host_supervisor::run_desktop();
}
