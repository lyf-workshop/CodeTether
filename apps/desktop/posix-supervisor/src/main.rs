fn main() {
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
        let _descendant = std::process::Command::new("sleep")
            .arg("30")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .spawn()
            .map(|child| {
                println!("{}", child.id());
                child
            })
            .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    #[cfg(unix)]
    if let Some(code) = codetether_posix_supervisor::guardian_entry() {
        std::process::exit(code);
    }
}
