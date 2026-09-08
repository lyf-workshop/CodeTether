fn main() {
    #[cfg(unix)]
    if std::env::args().nth(1).as_deref() == Some("--test-auto-reap") {
        unsafe {
            libc::signal(libc::SIGCHLD, libc::SIG_IGN);
        }
        assert!(
            codetether_posix_supervisor::OwnedGroup::spawn(&mut std::process::Command::new("true"))
                .is_err()
        );
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--port") {
        use std::io::BufRead;
        for line in std::io::stdin().lock().lines() {
            match line.as_deref() {
                Ok("start") => println!("started"),
                Ok("shutdown") => return,
                _ => {}
            }
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--test-descendants") {
        let mut descendant = std::process::Command::new("sleep")
            .arg("30")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        println!("{}", descendant.id());
        descendant.wait().unwrap();
        return;
    }
    #[cfg(unix)]
    if let Some(code) = codetether_posix_supervisor::guardian_entry() {
        std::process::exit(code);
    }
}
