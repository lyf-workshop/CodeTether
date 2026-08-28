mod host_supervisor;
mod project_directory_picker;
mod startup_error;

pub fn run() {
    host_supervisor::run_desktop();
}
