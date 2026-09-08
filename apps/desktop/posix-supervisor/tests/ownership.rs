#![cfg(unix)]
use codetether_posix_supervisor::OwnedGroup;
use std::{
    io::{BufRead, BufReader},
    process::Command,
    thread,
    time::{Duration, Instant},
};

#[test]
fn descendants_are_cleaned_when_the_owner_drops() {
    let mut command = Command::new(env!("CARGO_BIN_EXE_codetether-supervision-test"));
    command
        .arg("--test-descendants")
        .stdout(std::process::Stdio::piped());
    let mut group = OwnedGroup::spawn(&mut command).unwrap();
    let mut line = String::new();
    BufReader::new(group.output().unwrap())
        .read_line(&mut line)
        .unwrap();
    let descendant: i32 = line.trim().parse().unwrap();
    drop(group);
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if unsafe { libc::kill(descendant, 0) } != 0 {
            break;
        }
        #[cfg(target_os = "linux")]
        if std::fs::read_to_string(format!("/proc/{descendant}/stat")).is_ok_and(|stat| {
            stat.split(')')
                .nth(1)
                .is_some_and(|tail| tail.starts_with(" Z"))
        }) {
            break;
        }
        assert!(Instant::now() < deadline, "owned descendant survived");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn private_guardian_cleans_up_on_parent_pipe_eof() {
    use std::{fs, io::Write, process::Stdio};
    let root =
        std::env::temp_dir().join(format!("codetether-guardian-test-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    let source = env!("CARGO_BIN_EXE_codetether-supervision-test");
    let guardian = root.join("guardian");
    fs::copy(source, &guardian).unwrap();
    fs::copy(source, root.join("codetether-host")).unwrap();
    let mut child = Command::new(&guardian)
        .args([
            codetether_posix_supervisor::GUARDIAN_ARGUMENT,
            "--port",
            "4317",
            "--origin",
            "tauri://localhost",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stdin.take().unwrap();
    pipe.write_all(b"start\n").unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(line, "started\n");
    drop(pipe); // Models the kernel's pipe close on hard Desktop termination.
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn detached_probe_has_exact_parent_death_ownership() {
    use std::{
        io::Write,
        os::{
            fd::AsRawFd,
            unix::{net::UnixStream, process::CommandExt},
        },
        process::Stdio,
    };
    let (configuration, mut writer) = UnixStream::pair().unwrap();
    let descriptor = configuration.as_raw_fd();
    let executable = env!("CARGO_BIN_EXE_codetether-supervision-test");
    let mut command = Command::new(executable);
    command
        .arg(codetether_posix_supervisor::PROBE_ARGUMENT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(descriptor, 3) == -1 || libc::fcntl(3, libc::F_SETFD, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut guardian = command.spawn().unwrap();
    drop(configuration);
    writer
        .write_all(
            serde_json::json!({ "executable": executable,
        "arguments": ["--test-descendants"], "timeout_ms": 5000 })
            .to_string()
            .as_bytes(),
        )
        .unwrap();
    writer.shutdown(std::net::Shutdown::Write).unwrap();
    let mut line = String::new();
    BufReader::new(guardian.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert!(line.trim().parse::<u32>().unwrap() > 0);
    drop(guardian.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if guardian.try_wait().unwrap().is_some() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "probe guardian survived parent EOF"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn sleeper() -> OwnedGroup {
    OwnedGroup::spawn(Command::new("sleep").arg("30")).unwrap()
}

#[test]
fn auto_reaping_cannot_invalidate_the_ownership_reservation() {
    assert!(
        Command::new(env!("CARGO_BIN_EXE_codetether-supervision-test"))
            .arg("--test-auto-reap")
            .status()
            .unwrap()
            .success()
    );
}

#[test]
fn normal_exit_is_observed_without_reaping() {
    let mut owned = OwnedGroup::spawn(&mut Command::new("true")).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !owned.exited().unwrap() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    assert!(owned.exited().unwrap());
    assert_eq!(owned.finish().unwrap(), 0);
}

#[test]
fn cleanup_is_bounded_idempotent_and_does_not_signal_another_generation() {
    let mut old = sleeper();
    let started = Instant::now();
    old.finish().unwrap();
    assert!(started.elapsed() < Duration::from_secs(3));
    let mut current = sleeper();
    old.finish().unwrap();
    drop(old);
    assert!(!current.exited().unwrap());
    current.finish().unwrap();
}

#[test]
fn concurrent_groups_and_unrelated_process_survive_other_group_cleanup() {
    let mut unrelated = Command::new("sleep").arg("30").spawn().unwrap();
    let mut first = sleeper();
    let mut second = sleeper();
    first.finish().unwrap();
    assert!(!second.exited().unwrap());
    assert!(unrelated.try_wait().unwrap().is_none());
    second.finish().unwrap();
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
}
