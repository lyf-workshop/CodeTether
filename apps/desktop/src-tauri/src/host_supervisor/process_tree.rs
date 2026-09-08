use std::sync::{Arc, Mutex};

/// Private pipe ownership is shareable, numeric process authority is not.
pub struct CommandChild(Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>);

impl CommandChild {
    pub fn new(child: tauri_plugin_shell::process::CommandChild) -> Self {
        Self(Arc::new(Mutex::new(Some(child))))
    }
    pub fn pid(&self) -> u32 {
        self.0.lock().unwrap().as_ref().expect("owned child").pid()
    }
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), tauri_plugin_shell::Error> {
        self.0
            .lock()
            .unwrap()
            .as_mut()
            .expect("owned child")
            .write(bytes)
    }
    pub fn kill(self) -> Result<(), tauri_plugin_shell::Error> {
        #[cfg(windows)]
        {
            self.0.lock().unwrap().take().expect("owned child").kill()
        }
        #[cfg(unix)]
        {
            self.0
                .lock()
                .unwrap()
                .as_mut()
                .expect("owned child")
                .write(b"terminate-tree\n")
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::{io, mem::size_of};

    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };

    pub struct ProcessTreeGuard(HANDLE);

    // Windows kernel handles may be transferred between threads. Access to this
    // guard is serialized by the Desktop supervisor.
    unsafe impl Send for ProcessTreeGuard {}

    impl ProcessTreeGuard {
        pub fn assign(child: &super::CommandChild) -> io::Result<Self> {
            let process_id = child.pid();
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(io::Error::last_os_error());
                }

                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                {
                    let error = io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(error);
                }

                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, process_id);
                if process.is_null() {
                    let error = io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(error);
                }
                let assigned = AssignProcessToJobObject(job, process);
                let assignment_error = (assigned == 0).then(io::Error::last_os_error);
                CloseHandle(process);
                if let Some(error) = assignment_error {
                    CloseHandle(job);
                    return Err(error);
                }
                Ok(Self(job))
            }
        }

        pub fn terminate(self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for ProcessTreeGuard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(unix)]
mod platform {
    use std::io;

    pub struct ProcessTreeGuard(super::CommandChild);

    impl ProcessTreeGuard {
        pub fn assign(child: &super::CommandChild) -> io::Result<Self> {
            // The launched private guardian creates the group before forwarding
            // `start`. This handle carries only that launch's pipe, never a PID.
            Ok(Self(super::CommandChild(child.0.clone())))
        }

        pub fn terminate(self) {
            drop(self);
        }
    }

    impl Drop for ProcessTreeGuard {
        fn drop(&mut self) {
            let _ = self.0.write(b"terminate-tree\n");
        }
    }
}

pub use platform::ProcessTreeGuard;
