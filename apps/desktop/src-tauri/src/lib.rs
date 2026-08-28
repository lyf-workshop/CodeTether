mod host_supervisor;
mod startup_error;

pub fn run() {
    host_supervisor::run_desktop();
}
