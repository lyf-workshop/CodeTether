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
        pub fn assign(process_id: u32) -> io::Result<Self> {
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

#[cfg(not(windows))]
mod platform {
    use std::io;

    pub struct ProcessTreeGuard;

    impl ProcessTreeGuard {
        pub fn assign(_process_id: u32) -> io::Result<Self> {
            Ok(Self)
        }

        pub fn terminate(self) {}
    }
}

pub use platform::ProcessTreeGuard;
