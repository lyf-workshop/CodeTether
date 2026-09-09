//! Private Desktop sidecar supervision, not a command/remote execution API.
//! The guardian is outside the owned group. The leader is not reaped until the
//! last group signal: WNOWAIT keeps its PID reserved, including after exit.
#![cfg(unix)]

use std::{
    io::{self, BufRead, Read, Write},
    os::unix::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

pub const GUARDIAN_ARGUMENT: &str = "--codetether-private-host-guardian";
pub const PROBE_ARGUMENT: &str = "--codetether-private-probe-guardian";
const GRACE: Duration = Duration::from_secs(12);

pub struct OwnedGroup {
    child: Option<Child>,
}

impl OwnedGroup {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        unsafe {
            let mut disposition: libc::sigaction = std::mem::zeroed();
            if libc::sigaction(libc::SIGCHLD, std::ptr::null(), &mut disposition) != 0 {
                return Err(io::Error::last_os_error());
            }
            if disposition.sa_sigaction != libc::SIG_DFL
                || disposition.sa_flags & libc::SA_NOCLDWAIT != 0
            {
                return Err(io::Error::other(
                    "owned groups require exclusive child reaping",
                ));
            }
        }
        // Applied in the child before exec; never assign an arbitrary live PID.
        command.process_group(0);
        Ok(Self {
            child: Some(command.spawn()?),
        })
    }

    pub fn exited(&self) -> io::Result<bool> {
        let Some(child) = &self.child else {
            return Ok(true);
        };
        unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            if libc::waitid(
                libc::P_PID,
                child.id(),
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            ) != 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(info.si_pid() != 0)
        }
    }

    pub fn input(&mut self) -> Option<std::process::ChildStdin> {
        self.child.as_mut()?.stdin.take()
    }

    pub fn output(&mut self) -> Option<std::process::ChildStdout> {
        self.child.as_mut()?.stdout.take()
    }

    pub fn finish(&mut self) -> io::Result<i32> {
        // If another reaper ever broke the reservation, fail closed instead of
        // signalling a numeric ID that could now belong to another launch.
        let exited = match self.exited() {
            Ok(exited) => exited,
            Err(error) => {
                self.child.take();
                return Err(error);
            }
        };
        let Some(mut child) = self.child.take() else {
            return Ok(0);
        };
        // A live or unreaped owned leader reserves this PGID. Consume ownership
        // before signalling; neither delayed calls nor Drop can signal it again.
        let result = unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
        if result != 0 {
            let error = io::Error::last_os_error();
            // Darwin reports EPERM when an already-exited leader has no
            // remaining process group to signal. The WNOWAIT observation still
            // reserves this exact child, so consume it below. A live group's
            // EPERM remains a fail-closed ownership error.
            let group_gone =
                exited && matches!(error.raw_os_error(), Some(libc::ESRCH | libc::EPERM));
            if !group_gone {
                self.child = Some(child);
                return Err(error);
            }
        }
        // Do not wait indefinitely on uninterruptible kernel I/O.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait()? {
                return Ok(status.code().unwrap_or(1));
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "owned process did not exit",
                ));
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for OwnedGroup {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

/// Called before Tauri/GUI initialization. The only executable admitted is the
/// fixed adjacent packaged Host, never a path supplied by Web or a Machine.
pub fn guardian_entry() -> Option<i32> {
    let mut arguments = std::env::args().skip(1);
    let argument = arguments.next();
    if matches!(
        argument.as_deref(),
        Some(GUARDIAN_ARGUMENT | PROBE_ARGUMENT)
    ) {
        // An inherited SIG_IGN/SA_NOCLDWAIT would auto-reap the group leader.
        // This is a private, pre-Tauri process; it owns all its child waits.
        unsafe {
            let mut disposition: libc::sigaction = std::mem::zeroed();
            disposition.sa_sigaction = libc::SIG_DFL;
            libc::sigemptyset(&mut disposition.sa_mask);
            if libc::sigaction(libc::SIGCHLD, &disposition, std::ptr::null_mut()) != 0 {
                return Some(1);
            }
        }
    }
    if argument.as_deref() == Some(PROBE_ARGUMENT) && arguments.next().is_none() {
        return Some(run_probe_guardian().unwrap_or(1));
    }
    if argument.as_deref() != Some(GUARDIAN_ARGUMENT) {
        return None;
    }
    Some(run_guardian(arguments.collect()).unwrap_or(1))
}

fn run_guardian(arguments: Vec<String>) -> io::Result<i32> {
    let executable = std::env::current_exe()?;
    let host = executable
        .parent()
        .ok_or_else(|| io::Error::other("bundle path unavailable"))?
        .join("codetether-host");
    if arguments.len() != 4
        || arguments[0] != "--port"
        || arguments[1] != "4317"
        || arguments[2] != "--origin"
        || !["tauri://localhost", "http://127.0.0.1:5173"].contains(&arguments[3].as_str())
    {
        return Err(io::Error::other("invalid private Host launch"));
    }
    let mut command = Command::new(host);
    command
        .args(arguments)
        .env("CODETETHER_DESKTOP_MANAGED", "1")
        .env("CODETETHER_POSIX_GUARDIAN", &executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let mut owned = OwnedGroup::spawn(&mut command)?;
    let mut input = owned
        .input()
        .ok_or_else(|| io::Error::other("Host pipe unavailable"))?;
    let (sender, receiver) = mpsc::sync_channel(8);
    thread::spawn(move || {
        let mut reader = io::stdin().lock();
        loop {
            let mut line = Vec::new();
            // Private commands are bounded; never buffer an unbounded line.
            let read = (&mut reader).take(129).read_until(b'\n', &mut line);
            if !matches!(read, Ok(1..=128)) || !line.ends_with(b"\n") {
                break;
            }
            if sender.send(line).is_err() {
                return;
            }
        }
    });
    let mut ending: Option<Instant> = None;
    loop {
        if owned.exited()? {
            return owned.finish();
        }
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(line) if line == b"terminate-tree\n" => return owned.finish(),
            Ok(line) => {
                if line == b"shutdown\n" {
                    ending.get_or_insert(Instant::now());
                }
                if input.write_all(&line).is_err() {
                    return owned.finish();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if ending.is_none() {
                    let _ = input.write_all(b"shutdown\n");
                    ending = Some(Instant::now());
                }
                thread::sleep(Duration::from_millis(20));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if ending.is_some_and(|time| time.elapsed() >= GRACE) {
            return owned.finish();
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Probe {
    executable: String,
    arguments: Vec<String>,
    timeout_ms: u64,
}

static STOP_PROBE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
extern "C" fn stop_probe(_: i32) {
    STOP_PROBE.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// A metadata-only adapter's detached group needs its own parent-death guardian.
/// The exact executable/argv cross inherited fd 3, not a public API or command
/// line. Environment is inherited from the adapter's already-sanitized spawn.
fn run_probe_guardian() -> io::Result<i32> {
    use std::os::fd::FromRawFd;
    unsafe {
        libc::signal(libc::SIGTERM, stop_probe as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, stop_probe as *const () as libc::sighandler_t);
    }
    let mut bytes = Vec::new();
    unsafe { std::fs::File::from_raw_fd(3) }
        .take(65_537)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 65_536 {
        return Err(io::Error::other("probe configuration exceeds bound"));
    }
    let probe: Probe =
        serde_json::from_slice(&bytes).map_err(|_| io::Error::other("invalid private probe"))?;
    if !std::path::Path::new(&probe.executable).is_absolute()
        || probe.executable.len() > 16_384
        || probe.arguments.len() > 32
        || probe.arguments.iter().any(|value| value.len() > 16_384)
        || probe.timeout_ms == 0
        || probe.timeout_ms > 30_000
    {
        return Err(io::Error::other("invalid private probe bounds"));
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = io::stdin().read(&mut [0u8; 1]);
        let _ = sender.send(());
    });
    let mut command = Command::new(probe.executable);
    command
        .args(probe.arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let mut owned = OwnedGroup::spawn(&mut command)?;
    let deadline = Instant::now() + Duration::from_millis(probe.timeout_ms);
    loop {
        if owned.exited()? {
            return owned.finish();
        }
        if STOP_PROBE.load(std::sync::atomic::Ordering::Relaxed)
            || Instant::now() >= deadline
            || receiver.try_recv().is_ok()
        {
            owned.finish()?;
            return Ok(1);
        }
        thread::sleep(Duration::from_millis(5));
    }
}
