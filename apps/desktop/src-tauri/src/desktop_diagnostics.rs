//! Bounded, private desktop process diagnostics. No Host or Provider prose is
//! written: imported lines are reconstructed from a small set of safe shapes.

use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

const FILE_BYTES: u64 = 256 * 1024;
const FILE_COUNT: usize = 8;
const MAX_RECORD_BYTES: usize = 8 * 1024;
const MAX_HOST_LINE_BYTES: usize = 240;
const MAX_STARTUP_STDERR_LINES: usize = 40;
const MAX_BURST_KEYS: usize = 64;
const MAX_IDENTICAL_PER_MINUTE: u8 = 8;
const MAX_RECORDS_PER_MINUTE: u16 = 256;
const BURST_WINDOW_MS: u128 = 60_000;
const REDACTED_STDERR: &str = "[redacted host stderr]";

static DIAGNOSTICS: OnceLock<DesktopDiagnostics> = OnceLock::new();

struct Burst {
    count: u8,
}

struct WriterState {
    bursts: HashMap<String, Burst>,
    window_start_ms: u128,
    total_count: u16,
}

struct DesktopDiagnostics {
    path: Option<PathBuf>,
    max_file_bytes: u64,
    file_count: usize,
    state: Mutex<WriterState>,
}

impl DesktopDiagnostics {
    fn new(path: Option<PathBuf>) -> Self {
        Self {
            path,
            max_file_bytes: FILE_BYTES,
            file_count: FILE_COUNT,
            state: Mutex::new(WriterState {
                bursts: HashMap::new(),
                window_start_ms: 0,
                total_count: 0,
            }),
        }
    }

    fn record(&self, event: &'static str, fields: Value) {
        self.record_at(event, fields, now_ms());
    }

    fn record_at(&self, event: &'static str, fields: Value, timestamp_ms: u128) {
        let Some(path) = &self.path else { return };
        let key = format!("{event}:{fields}");
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if state.total_count == 0 && state.bursts.is_empty() {
            state.window_start_ms = timestamp_ms;
        } else if timestamp_ms.saturating_sub(state.window_start_ms) >= BURST_WINDOW_MS {
            state.bursts.clear();
            state.window_start_ms = timestamp_ms;
            state.total_count = 0;
        }
        if state.total_count >= MAX_RECORDS_PER_MINUTE
            || (state.bursts.len() >= MAX_BURST_KEYS && !state.bursts.contains_key(&key))
        {
            return;
        }
        if let Some(burst) = state.bursts.get(&key)
            && burst.count >= MAX_IDENTICAL_PER_MINUTE
        {
            return;
        }
        let line = format!(
            "{}\n",
            json!({
                "timestampUnixMs": timestamp_ms,
                "component": "desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "build": env!("CODETETHER_BUILD_ID"),
                "event": event,
                "fields": fields,
            })
        );
        if line.len() > MAX_RECORD_BYTES
            || append_bounded(path, line.as_bytes(), self.max_file_bytes, self.file_count).is_err()
        {
            // A diagnostic sink must never alter Desktop or Host behavior.
            return;
        }
        let burst = state.bursts.entry(key).or_insert(Burst { count: 0 });
        burst.count += 1;
        state.total_count += 1;
    }
}

fn append_bounded(
    path: &Path,
    line: &[u8],
    max_file_bytes: u64,
    file_count: usize,
) -> io::Result<()> {
    if line.len() as u64 > max_file_bytes || file_count == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostic record exceeds cap",
        ));
    }
    let directory = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "diagnostic path has no parent")
    })?;
    fs::create_dir_all(directory)?;
    reject_reparse_or_symlink(directory)?;
    reject_reparse_or_symlink(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    let current_bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .or_else(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                Ok(0)
            } else {
                Err(error)
            }
        })?;
    if current_bytes.saturating_add(line.len() as u64) > max_file_bytes {
        rotate(path, file_count)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(line)
}

fn reject_reparse_or_symlink(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "diagnostic path is a reparse point",
            ));
        }
    }
    #[cfg(unix)]
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostic path is a symlink",
        ));
    }
    Ok(())
}

fn rotate(path: &Path, file_count: usize) -> io::Result<()> {
    if file_count == 1 {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }
    for index in (1..file_count).rev() {
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            rotated_path(path, index - 1)
        };
        let destination = rotated_path(path, index);
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        if source.exists() {
            fs::rename(source, destination)?;
        }
    }
    Ok(())
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
}

fn log_path() -> Option<PathBuf> {
    if let Some(isolated) = option_env!("CODETETHER_W0F_DATA_DIR") {
        return Some(PathBuf::from(isolated).join("logs").join("desktop.jsonl"));
    }
    let configured = std::env::var_os("CODETETHER_DATA_DIR");
    let data_dir = match configured {
        Some(path) if Path::new(&path).is_absolute() => PathBuf::from(path),
        Some(_) => return None,
        None => default_data_directory()?,
    };
    Some(data_dir.join("logs").join("desktop.jsonl"))
}

fn default_data_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA")?;
        return Some(PathBuf::from(local).join("CodeTether"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        return Some(PathBuf::from(home).join("Library/Application Support/CodeTether"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Some(PathBuf::from(data_home).join("codetether"));
        }
        let home = std::env::var_os("HOME")?;
        return Some(PathBuf::from(home).join(".local/share/codetether"));
    }
    #[allow(unreachable_code)]
    None
}

pub(crate) fn initialize() {
    DIAGNOSTICS.get_or_init(|| DesktopDiagnostics::new(log_path()));
}

fn with_diagnostics(f: impl FnOnce(&DesktopDiagnostics)) {
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        f(diagnostics);
    }
}

pub(crate) fn host_spawn(pid: u32) {
    with_diagnostics(|log| log.record("host.spawn", json!({ "pid": pid })));
}

pub(crate) fn host_ready(elapsed: Duration) {
    with_diagnostics(|log| log.record("host.ready", json!({ "elapsedMs": elapsed.as_millis() })));
}

pub(crate) fn host_exit(code: Option<i32>, expected: bool, elapsed: Duration) {
    with_diagnostics(|log| {
        log.record(
            "host.exit",
            json!({
                "exitCode": code,
                "expected": expected,
                "elapsedMs": elapsed.as_millis(),
            }),
        )
    });
}

pub(crate) fn dialog(kind: &'static str, shown: bool) {
    with_diagnostics(|log| log.record("dialog", json!({ "kind": kind, "shown": shown })));
}

pub(crate) fn host_output(raw: &str) {
    if let Some(line) = safe_host_output_line(raw) {
        with_diagnostics(|log| log.record("host.output", json!({ "line": line })));
    }
}

/// A startup-only tail. Unknown stderr is represented by a fixed marker. This
/// protects paths, tokens, and arbitrary exception messages printed by Node.
#[derive(Default)]
pub(crate) struct StartupStderrTail {
    lines: VecDeque<String>,
}

impl StartupStderrTail {
    pub(crate) fn push(&mut self, raw: &str) {
        if self.lines.len() == MAX_STARTUP_STDERR_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(
            safe_host_output_line(raw)
                .or_else(|| safe_startup_phase(raw))
                .unwrap_or_else(|| REDACTED_STDERR.to_owned()),
        );
    }

    pub(crate) fn flush(&mut self) {
        with_diagnostics(|log| self.flush_to(log));
        self.lines.clear();
    }

    fn flush_to(&mut self, log: &DesktopDiagnostics) {
        let lines: Vec<_> = self.lines.drain(..).collect();
        if !lines.is_empty() {
            log.record("host.stderr.before_ready", json!({ "lines": lines }));
        }
    }
}

fn safe_host_output_line(raw: &str) -> Option<String> {
    let line = raw.trim_end_matches(['\r', '\n']);
    let safe = match line {
        "[codetether:host] UNSUPPORTED_SQLITE_SCHEMA_MIGRATION" => line.to_owned(),
        "[codetether:host] STARTUP_FAILURE" => line.to_owned(),
        "[codetether:codex] Provider diagnostic output was suppressed" => line.to_owned(),
        "[codetether:provider-unknown-notification] Suppressed unrecognized Provider notification" => {
            line.to_owned()
        }
        "[codetether:provider-unknown-request] Suppressed unrecognized Provider request" => {
            line.to_owned()
        }
        "[codetether:provider-unknown-response] Suppressed unrecognized Provider response" => {
            line.to_owned()
        }
        "[codetether:host] managed shutdown requested (desktop_shutdown)" => line.to_owned(),
        _ if line.starts_with("[codex:failure]") => "[codex:failure] [details redacted]".to_owned(),
        _ if line.starts_with("[codetether:host]") => {
            "[codetether:host] [details redacted]".to_owned()
        }
        _ if line.starts_with("[codetether:") => "[codetether:other] [details redacted]".to_owned(),
        _ => return None,
    };
    Some(truncate_utf8(&safe, MAX_HOST_LINE_BYTES))
}

fn safe_startup_phase(raw: &str) -> Option<String> {
    if raw.len() > 4 * 1024 {
        return None;
    }
    let value: Value = serde_json::from_str(raw).ok()?;
    if value.get("component")?.as_str()? != "host"
        || value.get("event")?.as_str()? != "startup.phase"
    {
        return None;
    }
    const PHASES: &[&str] = &[
        "PROCESS_START",
        "LOCAL_STATE_OPEN",
        "PRODUCTDEVICE_RESTORED",
        "HOST_IDENTITY_RESTORED",
        "SUPERVISOR_4318_LISTENING",
        "PRODUCT_API_4317_LISTENING",
        "PROVIDER_DISCOVERY_START",
        "PROVIDER_DISCOVERY_DONE",
        "RELAY_START",
        "PRESENCE_PUBLISHER_START",
        "LOCAL_READY",
    ];
    let phase = value.get("phase")?.as_str()?;
    if !PHASES.contains(&phase) {
        return None;
    }
    let elapsed = value.get("elapsedMs")?.as_f64()?;
    if !elapsed.is_finite() || !(0.0..=3_600_000.0).contains(&elapsed) {
        return None;
    }
    Some(format!("startup.phase {phase} elapsedMs={elapsed:.2}"))
}

fn truncate_utf8(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "codetether-desktop-log-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn prefix_filter_reconstructs_only_safe_lines() {
        assert_eq!(safe_host_output_line("unowned secret"), None);
        assert_eq!(
            safe_host_output_line("{\"databasePath\":\"C:\\\\secret\"}"),
            None
        );
        assert_eq!(
            safe_host_output_line("[codetether:host] token=secret C:\\\\Project"),
            Some("[codetether:host] [details redacted]".to_owned())
        );
        assert_eq!(
            safe_host_output_line(
                "[codex:failure] variant=accountName httpStatus=401 reason=auth_required"
            ),
            Some("[codex:failure] [details redacted]".to_owned())
        );
        assert_eq!(
            safe_host_output_line("[codetether:host] UNSUPPORTED_SQLITE_SCHEMA_MIGRATION"),
            Some("[codetether:host] UNSUPPORTED_SQLITE_SCHEMA_MIGRATION".to_owned())
        );
        assert_eq!(
            safe_host_output_line("[codetether:host] STARTUP_FAILURE"),
            Some("[codetether:host] STARTUP_FAILURE".to_owned())
        );
    }

    #[test]
    fn truncation_preserves_utf8_boundary() {
        assert_eq!(truncate_utf8("ab中def", 4), "ab");
        assert_eq!(truncate_utf8("abcdef", 4), "abcd");
    }

    #[test]
    fn before_ready_tail_keeps_40_sanitized_lines() {
        let dir = test_dir();
        let path = dir.join("logs/desktop.jsonl");
        let log = DesktopDiagnostics::new(Some(path.clone()));
        let mut tail = StartupStderrTail::default();
        tail.push(r#"{"component":"host","event":"startup.phase","phase":"PROCESS_START","elapsedMs":0,"token":"fake-secret"}"#);
        for index in 0..45 {
            tail.push(&format!("private-line-{index} C:\\\\Project fake-secret"));
        }
        assert_eq!(tail.lines.len(), 40);
        assert!(tail.lines.iter().all(|line| line == REDACTED_STDERR));
        assert!(tail.lines.iter().all(|line| !line.contains("fake-secret")));
        tail.flush_to(&log);
        let record: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(record["fields"]["lines"].as_array().unwrap().len(), 40);
        assert!(!record.to_string().contains("fake-secret"));
        assert!(!record.to_string().contains("Project"));
        assert_eq!(
            safe_startup_phase(
                r#"{"component":"host","event":"startup.phase","phase":"PROCESS_START","elapsedMs":0,"token":"fake-secret"}"#
            ),
            Some("startup.phase PROCESS_START elapsedMs=0.00".to_owned())
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bounded_rotation_and_rate_limit() {
        let dir = test_dir();
        let path = dir.join("logs/desktop.jsonl");
        let mut log = DesktopDiagnostics::new(Some(path.clone()));
        log.max_file_bytes = 260;
        log.file_count = 3;
        for _ in 0..12 {
            log.record_at("host.output", json!({ "line": "same" }), 1000);
        }
        assert_eq!(
            log.state
                .lock()
                .unwrap()
                .bursts
                .get("host.output:{\"line\":\"same\"}")
                .unwrap()
                .count,
            MAX_IDENTICAL_PER_MINUTE,
        );
        let count = fs::read_to_string(&path).unwrap().lines().count()
            + fs::read_to_string(rotated_path(&path, 1))
                .map(|s| s.lines().count())
                .unwrap_or(0)
            + fs::read_to_string(rotated_path(&path, 2))
                .map(|s| s.lines().count())
                .unwrap_or(0);
        assert!(count <= MAX_IDENTICAL_PER_MINUTE as usize);
        for index in 0..30 {
            log.record_at(
                "host.output",
                json!({ "line": format!("line-{index}") }),
                61_000,
            );
        }
        for index in 0..3 {
            let file = if index == 0 {
                path.clone()
            } else {
                rotated_path(&path, index)
            };
            assert!(fs::metadata(file).unwrap().len() <= 260);
        }
        assert!(!rotated_path(&path, 3).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn many_unique_keys_cannot_reset_an_identical_burst() {
        let dir = test_dir();
        let path = dir.join("logs/desktop.jsonl");
        let log = DesktopDiagnostics::new(Some(path.clone()));
        for _ in 0..MAX_IDENTICAL_PER_MINUTE {
            log.record_at("host.output", json!({ "line": "same" }), 1000);
        }
        for index in 0..MAX_BURST_KEYS {
            log.record_at(
                "host.output",
                json!({ "line": format!("unique-{index}") }),
                1000,
            );
        }
        for _ in 0..MAX_IDENTICAL_PER_MINUTE {
            log.record_at("host.output", json!({ "line": "same" }), 1000);
        }
        let contents = fs::read_to_string(&path).unwrap();
        let same_count = contents
            .lines()
            .filter(|line| {
                let record: Value = serde_json::from_str(line).unwrap();
                record["fields"]["line"] == "same"
            })
            .count();
        assert_eq!(same_count, MAX_IDENTICAL_PER_MINUTE as usize);
        assert_eq!(log.state.lock().unwrap().bursts.len(), MAX_BURST_KEYS);
        log.record_at("host.output", json!({ "line": "new-minute" }), 61_000);
        assert_eq!(log.state.lock().unwrap().total_count, 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn total_rate_cap_applies_with_many_distinct_records() {
        let dir = test_dir();
        let path = dir.join("logs/desktop.jsonl");
        let log = DesktopDiagnostics::new(Some(path.clone()));
        for index in 0..MAX_BURST_KEYS {
            for _ in 0..MAX_IDENTICAL_PER_MINUTE {
                log.record_at(
                    "host.output",
                    json!({ "line": format!("unique-{index}") }),
                    1000,
                );
            }
        }
        assert_eq!(
            log.state.lock().unwrap().total_count,
            MAX_RECORDS_PER_MINUTE
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap().lines().count(),
            MAX_RECORDS_PER_MINUTE as usize
        );
        log.record_at("host.output", json!({ "line": "after-cap" }), 1000);
        assert_eq!(
            fs::read_to_string(&path).unwrap().lines().count(),
            MAX_RECORDS_PER_MINUTE as usize
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_failure_does_not_escape_or_consume_rate_budget() {
        let dir = test_dir();
        fs::create_dir_all(&dir).unwrap();
        let log = DesktopDiagnostics::new(Some(dir.join("blocked/desktop.jsonl")));
        fs::write(dir.join("blocked"), b"not a directory").unwrap();
        log.record_at("host.spawn", json!({ "pid": 1 }), 1000);
        assert!(log.state.lock().unwrap().bursts.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
