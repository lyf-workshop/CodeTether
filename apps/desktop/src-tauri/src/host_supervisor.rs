mod process_tree;

use std::{
    io::{self, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

use self::process_tree::ProcessTreeGuard;
use crate::startup_error::{self, StartupFailureKind};

const HOST_ADDRESS: &str = "127.0.0.1:4317";
const HOST_URL: &str = "http://127.0.0.1:4317";
const PROTOCOL_VERSION: u32 = 1;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(12);
const SHUTDOWN_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_INTERVAL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT: Duration = Duration::from_millis(350);
const MAX_BOOTSTRAP_BYTES: u64 = 64 * 1024;
const LIFECYCLE_RUNNING: u8 = 0;
const LIFECYCLE_STOPPING: u8 = 1;
const LIFECYCLE_EXIT_ALLOWED: u8 = 2;

#[derive(Clone)]
struct DesktopState {
    host: Arc<Mutex<Option<HostSupervisor>>>,
    lifecycle: Arc<AtomicU8>,
    ready: Arc<AtomicBool>,
}

impl DesktopState {
    fn new(host: HostSupervisor) -> Self {
        Self {
            host: Arc::new(Mutex::new(Some(host))),
            lifecycle: Arc::new(AtomicU8::new(LIFECYCLE_RUNNING)),
            ready: Arc::new(AtomicBool::new(false)),
        }
    }

    fn mark_ready(&self) {
        self.ready.store(true, Ordering::Release);
    }

    fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    fn begin_shutdown(&self) -> bool {
        self.lifecycle
            .compare_exchange(
                LIFECYCLE_RUNNING,
                LIFECYCLE_STOPPING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn is_shutting_down(&self) -> bool {
        self.lifecycle.load(Ordering::Acquire) != LIFECYCLE_RUNNING
    }

    fn should_prevent_exit(&self) -> bool {
        self.lifecycle.load(Ordering::Acquire) != LIFECYCLE_EXIT_ALLOWED
    }

    fn allow_exit(&self) {
        self.lifecycle
            .store(LIFECYCLE_EXIT_ALLOWED, Ordering::Release);
    }

    fn shutdown_owned_host(&self) -> ShutdownOutcome {
        if let Some(host) = lock(&self.host).as_mut() {
            return host.shutdown(SHUTDOWN_TIMEOUT);
        }
        ShutdownOutcome::Clean
    }
}

#[derive(Clone)]
struct ProcessObservation {
    termination: Arc<(Mutex<Option<Option<i32>>>, Condvar)>,
    ready: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    unexpected_exit: Arc<AtomicBool>,
}

impl ProcessObservation {
    fn new() -> Self {
        Self {
            termination: Arc::new((Mutex::new(None), Condvar::new())),
            ready: Arc::new(AtomicBool::new(false)),
            stopping: Arc::new(AtomicBool::new(false)),
            unexpected_exit: Arc::new(AtomicBool::new(false)),
        }
    }

    fn record_termination(&self, code: Option<i32>) {
        let (status, changed) = &*self.termination;
        *lock(status) = Some(code);
        changed.notify_all();
    }

    fn termination(&self) -> Option<Option<i32>> {
        *lock(&self.termination.0)
    }

    fn wait_for_termination(&self, timeout: Duration) -> bool {
        let (status, changed) = &*self.termination;
        let status = lock(status);
        if status.is_some() {
            return true;
        }
        let result = changed.wait_timeout_while(status, timeout, |value| value.is_none());
        match result {
            Ok((value, _)) => value.is_some(),
            Err(poisoned) => poisoned.into_inner().0.is_some(),
        }
    }
}

struct HostSupervisor {
    child: Option<CommandChild>,
    process_tree: Option<ProcessTreeGuard>,
    observation: ProcessObservation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShutdownOutcome {
    Clean,
    HostExitedUnexpectedly,
    Failed,
}

impl HostSupervisor {
    fn start(app: &tauri::AppHandle) -> Result<Self, StartError> {
        match inspect_host_port() {
            ExistingService::None => {}
            ExistingService::CodeTether => return Err(StartError::ExistingCodeTetherHost),
            ExistingService::Other => return Err(StartError::PortConflict),
        }

        let sidecar_path = packaged_sidecar_path()?;
        if !sidecar_path.is_file() {
            return Err(StartError::HostBinaryMissing(sidecar_path));
        }

        let origin = desktop_origin();
        let command = app
            .shell()
            .sidecar("codetether-host")
            .map_err(|error| StartError::Spawn(error.to_string()))?
            .args(["--port", "4317", "--origin", origin])
            .env("CODETETHER_DESKTOP_MANAGED", "1");
        let (mut events, mut child) = command
            .spawn()
            .map_err(|error| StartError::Spawn(error.to_string()))?;
        let process_tree = match ProcessTreeGuard::assign(child.pid()) {
            Ok(guard) => guard,
            Err(error) => {
                let _ = child.write(b"shutdown\n");
                let _ = child.kill();
                return Err(StartError::Spawn(format!(
                    "could not establish owned process tree: {error}"
                )));
            }
        };
        if let Err(error) = child.write(b"start\n") {
            process_tree.terminate();
            let _ = child.kill();
            return Err(StartError::Spawn(format!(
                "could not activate owned Host: {error}"
            )));
        }
        let observation = ProcessObservation::new();
        let monitor_observation = observation.clone();
        let monitor_app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Ok(text) = std::str::from_utf8(&line) {
                            eprintln!("[codetether:host] {}", text.trim());
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        if let Ok(text) = std::str::from_utf8(&line) {
                            eprintln!("[codetether:host] {}", text.trim());
                        }
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("[codetether:host] process channel error: {error}");
                    }
                    CommandEvent::Terminated(payload) => {
                        monitor_observation.record_termination(payload.code);
                        if monitor_observation.ready.load(Ordering::Acquire)
                            && !monitor_observation.stopping.load(Ordering::Acquire)
                        {
                            monitor_observation
                                .unexpected_exit
                                .store(true, Ordering::Release);
                            eprintln!(
                                "[codetether:desktop] owned Host exited unexpectedly ({:?})",
                                payload.code
                            );
                            startup_error::show(StartupFailureKind::HostExited);
                            monitor_app.exit(1);
                        }
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            child: Some(child),
            process_tree: Some(process_tree),
            observation,
        })
    }

    fn observation(&self) -> ProcessObservation {
        self.observation.clone()
    }

    fn shutdown(&mut self, timeout: Duration) -> ShutdownOutcome {
        let started_at = Instant::now();
        self.observation.stopping.store(true, Ordering::Release);
        let Some(mut child) = self.child.take() else {
            return ShutdownOutcome::Clean;
        };
        eprintln!("[codetether:desktop] requesting graceful Host shutdown");
        let channel_ok = child.write(b"shutdown\n").is_ok();
        let terminated = self.observation.wait_for_termination(timeout);
        if !terminated {
            eprintln!(
                "[codetether:desktop] graceful Host shutdown timed out; terminating owned tree"
            );
            if let Some(tree) = self.process_tree.take() {
                tree.terminate();
            }
            let _ = child.kill();
        }
        self.process_tree.take();
        eprintln!(
            "[codetether:desktop] owned Host shutdown path finished in {} ms",
            started_at.elapsed().as_millis()
        );
        if self.observation.unexpected_exit.load(Ordering::Acquire) {
            return ShutdownOutcome::HostExitedUnexpectedly;
        }
        if channel_ok && terminated && self.observation.termination() == Some(Some(0)) {
            ShutdownOutcome::Clean
        } else {
            eprintln!(
                "[codetether:desktop] Host did not confirm a clean shutdown ({:?})",
                self.observation.termination()
            );
            ShutdownOutcome::Failed
        }
    }
}

impl Drop for HostSupervisor {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.write(b"shutdown\n");
            self.process_tree.take();
            let _ = child.kill();
        }
    }
}

#[derive(Debug)]
enum StartError {
    HostBinaryMissing(PathBuf),
    Spawn(String),
    ExistingCodeTetherHost,
    PortConflict,
}

impl StartError {
    fn failure_kind(&self) -> StartupFailureKind {
        match self {
            Self::HostBinaryMissing(_) => StartupFailureKind::HostBinaryMissing,
            Self::Spawn(_) => StartupFailureKind::HostSpawnFailed,
            Self::ExistingCodeTetherHost => StartupFailureKind::ExistingCodeTetherHost,
            Self::PortConflict => StartupFailureKind::PortConflict,
        }
    }

    fn diagnostic(&self) -> String {
        match self {
            Self::HostBinaryMissing(path) => {
                format!("Host sidecar is missing at {}", path.display())
            }
            Self::Spawn(message) => format!("Host spawn failed: {message}"),
            Self::ExistingCodeTetherHost => "a CodeTether-compatible Host owns port 4317".into(),
            Self::PortConflict => "an unknown service owns port 4317".into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExistingService {
    None,
    CodeTether,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Readiness {
    Ready,
    NotReady,
    ProtocolIncompatible,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapIdentity {
    protocol_version: u32,
    host_version: String,
}

fn inspect_host_port() -> ExistingService {
    let address: SocketAddr = HOST_ADDRESS.parse().expect("static Host address");
    inspect_service_at(address, PROBE_TIMEOUT)
}

fn inspect_service_at(address: SocketAddr, timeout: Duration) -> ExistingService {
    if let Ok(listener) = TcpListener::bind(address) {
        drop(listener);
        return ExistingService::None;
    }
    match read_bootstrap_at(address, timeout) {
        Ok(Some(_)) => ExistingService::CodeTether,
        Ok(None) | Err(_) => ExistingService::Other,
    }
}

fn wait_for_readiness(
    observation: &ProcessObservation,
    timeout: Duration,
    expected_host_version: &str,
) -> Result<Duration, StartupFailureKind> {
    wait_for_readiness_with_probe(observation, timeout, PROBE_INTERVAL, || {
        probe_readiness(expected_host_version)
    })
}

fn wait_for_readiness_with_probe(
    observation: &ProcessObservation,
    timeout: Duration,
    interval: Duration,
    mut probe: impl FnMut() -> Readiness,
) -> Result<Duration, StartupFailureKind> {
    let started_at = Instant::now();
    loop {
        if observation.termination().is_some() {
            return Err(StartupFailureKind::HostExited);
        }
        match probe() {
            Readiness::Ready => {
                observation.ready.store(true, Ordering::Release);
                // Close the gap between the pre-probe termination check and
                // publishing readiness. If the Host exits after answering
                // bootstrap but before `ready` becomes visible, the process
                // monitor cannot classify that one termination as unexpected.
                // Rechecking here guarantees either this path or the monitor
                // owns the failure transition.
                if observation.termination().is_some() {
                    return Err(StartupFailureKind::HostExited);
                }
                return Ok(started_at.elapsed());
            }
            Readiness::ProtocolIncompatible => {
                return Err(StartupFailureKind::ProtocolIncompatible);
            }
            Readiness::NotReady => {}
        }
        if started_at.elapsed() >= timeout {
            return Err(StartupFailureKind::ReadinessTimeout);
        }
        thread::sleep(interval);
    }
}

fn probe_readiness(expected_host_version: &str) -> Readiness {
    match read_bootstrap(PROBE_TIMEOUT) {
        Ok(Some(identity))
            if identity.protocol_version == PROTOCOL_VERSION
                && identity.host_version == expected_host_version =>
        {
            Readiness::Ready
        }
        Ok(Some(_)) => Readiness::ProtocolIncompatible,
        Ok(None) | Err(_) => Readiness::NotReady,
    }
}

fn read_bootstrap(timeout: Duration) -> io::Result<Option<BootstrapIdentity>> {
    let address: SocketAddr = HOST_ADDRESS.parse().expect("static Host address");
    read_bootstrap_at(address, timeout)
}

fn read_bootstrap_at(
    address: SocketAddr,
    timeout: Duration,
) -> io::Result<Option<BootstrapIdentity>> {
    let stream = TcpStream::connect_timeout(&address, timeout)?;
    read_bootstrap_from_stream(stream, address, timeout)
}

fn read_bootstrap_from_stream(
    mut stream: TcpStream,
    address: SocketAddr,
    timeout: Duration,
) -> io::Result<Option<BootstrapIdentity>> {
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(
        format!("GET /api/v1/bootstrap HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    )?;
    let mut response = Vec::new();
    stream
        .take(MAX_BOOTSTRAP_BYTES)
        .read_to_end(&mut response)?;
    Ok(parse_bootstrap_response(&response))
}

fn desktop_origin() -> &'static str {
    if cfg!(debug_assertions) {
        return "http://127.0.0.1:5173";
    }

    #[cfg(windows)]
    return "http://tauri.localhost";

    #[cfg(not(windows))]
    return "tauri://localhost";
}

fn parse_bootstrap_response(response: &[u8]) -> Option<BootstrapIdentity> {
    let separator = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")?;
    let headers = std::str::from_utf8(&response[..separator]).ok()?;
    if !headers.lines().next()?.starts_with("HTTP/1.1 200 ") {
        return None;
    }
    serde_json::from_slice(&response[(separator + 4)..]).ok()
}

fn packaged_sidecar_path() -> Result<PathBuf, StartError> {
    let executable =
        std::env::current_exe().map_err(|error| StartError::Spawn(error.to_string()))?;
    sidecar_path_for_executable(&executable).ok_or(StartError::HostBinaryMissing(executable))
}

fn sidecar_path_for_executable(executable: &Path) -> Option<PathBuf> {
    let executable_directory = executable.parent()?;
    let base_directory = if executable_directory.ends_with("deps") {
        executable_directory.parent()?
    } else {
        executable_directory
    };
    Some(base_directory.join(if cfg!(windows) {
        "codetether-host.exe"
    } else {
        "codetether-host"
    }))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn smoke_exit_delay(arguments: impl IntoIterator<Item = String>) -> Option<Duration> {
    for argument in arguments {
        if argument == "--desktop-smoke-exit-after-ready" {
            return Some(Duration::ZERO);
        }
        if let Some(value) = argument.strip_prefix("--desktop-smoke-exit-after-ready-ms=")
            && let Ok(milliseconds) = value.parse::<u64>()
            && milliseconds <= 60_000
        {
            return Some(Duration::from_millis(milliseconds));
        }
    }
    None
}

fn finish_owned_shutdown(state: DesktopState, code: i32) -> ! {
    // This is a final process-level guard around the normal bounded Host
    // shutdown. If a platform process primitive itself stalls, exiting the
    // Desktop closes the Windows Job handle and still prevents an orphaned
    // Host/Codex process tree.
    thread::spawn(|| {
        thread::sleep(SHUTDOWN_WATCHDOG_TIMEOUT);
        eprintln!("[codetether:desktop] shutdown watchdog forced process exit");
        std::process::exit(1);
    });
    let outcome = state.shutdown_owned_host();
    match outcome {
        ShutdownOutcome::Clean => {}
        ShutdownOutcome::HostExitedUnexpectedly => {
            eprintln!("[codetether:desktop] owned Host exited before shutdown completed");
        }
        ShutdownOutcome::Failed => {
            eprintln!("[codetether:desktop] owned Host shutdown was not confirmed clean");
        }
    }
    let exit_code = shutdown_exit_code(outcome, code);
    state.allow_exit();
    // The Host and its owned process tree are fully drained at this point.
    // Exiting directly avoids a Windows/Tauri edge case where re-requesting
    // exit after preventing the original window-close event can leave a
    // windowless event loop alive indefinitely. Shutdown diagnostics must not
    // open a blocking modal here: the visible product window is already
    // closing and an unowned MessageBox can itself orphan the Desktop process.
    std::process::exit(exit_code);
}

fn shutdown_exit_code(outcome: ShutdownOutcome, requested_code: i32) -> i32 {
    match outcome {
        ShutdownOutcome::Clean => requested_code,
        ShutdownOutcome::HostExitedUnexpectedly | ShutdownOutcome::Failed => 1,
    }
}

pub fn run_desktop() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if app
                .try_state::<DesktopState>()
                .is_some_and(|state| state.is_ready())
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            crate::project_directory_picker::pick_project_directory
        ])
        .setup(|app| {
            let host = match HostSupervisor::start(app.handle()) {
                Ok(host) => host,
                Err(error) => {
                    eprintln!("[codetether:desktop] {}", error.diagnostic());
                    startup_error::show(error.failure_kind());
                    // Setup failures occur before Desktop owns a running Host.
                    // Tauri's pre-run `AppHandle::exit` is not guaranteed to
                    // propagate its code on Windows, so terminate explicitly
                    // after the native diagnostic has been acknowledged.
                    std::process::exit(1);
                }
            };
            let observation = host.observation();
            let state = DesktopState::new(host);
            app.manage(state.clone());

            let app_handle = app.handle().clone();
            let smoke_exit_delay = smoke_exit_delay(std::env::args());
            thread::spawn(move || {
                match wait_for_readiness(&observation, STARTUP_TIMEOUT, env!("CODETETHER_BUILD_ID"))
                {
                    Ok(elapsed) => {
                        eprintln!(
                            "[codetether:desktop] Host ready at {HOST_URL} in {} ms",
                            elapsed.as_millis()
                        );
                        match app_handle.get_webview_window("main") {
                            Some(window) => {
                                if let Err(error) = window.show() {
                                    eprintln!(
                                        "[codetether:desktop] could not reveal the main window: {error}"
                                    );
                                    if state.begin_shutdown() {
                                        finish_owned_shutdown(state, 1);
                                    }
                                    return;
                                }
                                state.mark_ready();
                            }
                            None => {
                                eprintln!(
                                    "[codetether:desktop] the configured main window is missing"
                                );
                                if state.begin_shutdown() {
                                    finish_owned_shutdown(state, 1);
                                }
                                return;
                            }
                        }
                        if let Some(delay) = smoke_exit_delay {
                            thread::sleep(delay);
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Err(error) = window.close() {
                                    eprintln!(
                                        "[codetether:desktop] could not close the smoke window: {error}"
                                    );
                                    if state.begin_shutdown() {
                                        finish_owned_shutdown(state, 1);
                                    }
                                }
                            } else if state.begin_shutdown() {
                                finish_owned_shutdown(state, 1);
                            }
                        }
                    }
                    Err(failure) if !state.is_shutting_down() && state.begin_shutdown() => {
                        startup_error::show(failure);
                        let _ = state.shutdown_owned_host();
                        state.allow_exit();
                        std::process::exit(1);
                    }
                    Err(_) => {
                        if state.begin_shutdown() {
                            let _ = state.shutdown_owned_host();
                            state.allow_exit();
                            std::process::exit(1);
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build CodeTether Desktop");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            if let Some(state) = app_handle.try_state::<DesktopState>()
                && state.should_prevent_exit()
            {
                // The single-instance plugin owns a hidden helper window on
                // Windows, so closing the visible main window is not always
                // followed by an application-level ExitRequested event.
                // Intercept the product window directly: close means exit,
                // and owned Host teardown must happen before that exit.
                api.prevent_close();
                if state.begin_shutdown() {
                    let state = state.inner().clone();
                    thread::spawn(move || finish_owned_shutdown(state, 0));
                }
            }
        }
        RunEvent::ExitRequested { code, api, .. } => {
            if let Some(state) = app_handle.try_state::<DesktopState>()
                && state.should_prevent_exit()
            {
                api.prevent_exit();
                if state.begin_shutdown() {
                    let state = state.inner().clone();
                    thread::spawn(move || finish_owned_shutdown(state, code.unwrap_or(0)));
                }
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_sidecar_is_resolved_next_to_the_desktop_binary() {
        let executable = if cfg!(windows) {
            Path::new(r"C:\Program Files\CodeTether\codetether-desktop.exe")
        } else {
            Path::new("/opt/codetether/codetether-desktop")
        };
        let expected = executable.parent().unwrap().join(if cfg!(windows) {
            "codetether-host.exe"
        } else {
            "codetether-host"
        });
        assert_eq!(sidecar_path_for_executable(executable), Some(expected));
    }

    #[test]
    fn startup_failures_keep_spawn_and_port_conflicts_distinct() {
        assert_eq!(
            StartError::Spawn("denied".into()).failure_kind(),
            StartupFailureKind::HostSpawnFailed,
        );
        assert_eq!(
            StartError::ExistingCodeTetherHost.failure_kind(),
            StartupFailureKind::ExistingCodeTetherHost,
        );
        assert_eq!(
            StartError::PortConflict.failure_kind(),
            StartupFailureKind::PortConflict,
        );
    }

    #[test]
    fn every_exit_is_blocked_until_the_single_shutdown_worker_finishes() {
        let state = DesktopState {
            host: Arc::new(Mutex::new(None)),
            lifecycle: Arc::new(AtomicU8::new(LIFECYCLE_RUNNING)),
            ready: Arc::new(AtomicBool::new(false)),
        };
        assert!(state.should_prevent_exit());
        assert!(state.begin_shutdown());
        assert!(state.should_prevent_exit());
        assert!(!state.begin_shutdown());
        assert_eq!(state.shutdown_owned_host(), ShutdownOutcome::Clean);
        state.allow_exit();
        assert!(!state.should_prevent_exit());
    }

    #[test]
    fn second_launch_cannot_reveal_the_window_before_readiness() {
        let state = DesktopState {
            host: Arc::new(Mutex::new(None)),
            lifecycle: Arc::new(AtomicU8::new(LIFECYCLE_RUNNING)),
            ready: Arc::new(AtomicBool::new(false)),
        };
        assert!(!state.is_ready());
        state.mark_ready();
        assert!(state.is_ready());
    }

    #[test]
    fn shutdown_failures_remain_nonzero_without_blocking_exit() {
        assert_eq!(shutdown_exit_code(ShutdownOutcome::Clean, 0), 0);
        assert_eq!(shutdown_exit_code(ShutdownOutcome::Clean, 7), 7);
        assert_eq!(
            shutdown_exit_code(ShutdownOutcome::HostExitedUnexpectedly, 0),
            1
        );
        assert_eq!(shutdown_exit_code(ShutdownOutcome::Failed, 0), 1);
        assert!(SHUTDOWN_WATCHDOG_TIMEOUT > SHUTDOWN_TIMEOUT);
    }

    #[test]
    fn bootstrap_parser_accepts_only_successful_normalized_identity() {
        let valid = b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"protocolVersion\":1,\"hostVersion\":\"git-abc1234\"}";
        let identity = parse_bootstrap_response(valid).unwrap();
        assert_eq!(identity.protocol_version, 1);
        assert_eq!(identity.host_version, "git-abc1234");
        assert!(parse_bootstrap_response(b"HTTP/1.1 503 Nope\r\n\r\n{}").is_none());
        assert!(parse_bootstrap_response(b"not http").is_none());
    }

    #[test]
    fn process_observation_detects_exit_and_wakes_shutdown_waiter() {
        let observation = ProcessObservation::new();
        let monitor = observation.clone();
        thread::spawn(move || monitor.record_termination(Some(0)));
        assert!(observation.wait_for_termination(Duration::from_secs(1)));
        assert_eq!(observation.termination(), Some(Some(0)));
    }

    #[test]
    fn process_observation_has_a_bounded_timeout() {
        let observation = ProcessObservation::new();
        assert!(!observation.wait_for_termination(Duration::from_millis(1)));
    }

    #[test]
    fn smoke_exit_delay_is_explicit_and_bounded() {
        assert_eq!(
            smoke_exit_delay(["--desktop-smoke-exit-after-ready".into()]),
            Some(Duration::ZERO),
        );
        assert_eq!(
            smoke_exit_delay(["--desktop-smoke-exit-after-ready-ms=2500".into()]),
            Some(Duration::from_millis(2_500)),
        );
        assert_eq!(
            smoke_exit_delay(["--desktop-smoke-exit-after-ready-ms=60001".into()]),
            None,
        );
    }

    #[test]
    fn readiness_succeeds_without_a_fixed_startup_sleep() {
        let observation = ProcessObservation::new();
        let elapsed = wait_for_readiness_with_probe(
            &observation,
            Duration::from_secs(1),
            Duration::ZERO,
            || Readiness::Ready,
        )
        .unwrap();
        assert!(elapsed < Duration::from_secs(1));
        assert!(observation.ready.load(Ordering::Acquire));
    }

    #[test]
    fn readiness_distinguishes_protocol_mismatch_timeout_and_early_exit() {
        let mismatch = ProcessObservation::new();
        assert_eq!(
            wait_for_readiness_with_probe(
                &mismatch,
                Duration::from_secs(1),
                Duration::ZERO,
                || Readiness::ProtocolIncompatible,
            ),
            Err(StartupFailureKind::ProtocolIncompatible),
        );

        let timeout = ProcessObservation::new();
        assert_eq!(
            wait_for_readiness_with_probe(
                &timeout,
                Duration::from_millis(1),
                Duration::from_millis(1),
                || Readiness::NotReady,
            ),
            Err(StartupFailureKind::ReadinessTimeout),
        );

        let exited = ProcessObservation::new();
        exited.record_termination(Some(3));
        assert_eq!(
            wait_for_readiness_with_probe(&exited, Duration::from_secs(1), Duration::ZERO, || {
                Readiness::Ready
            },),
            Err(StartupFailureKind::HostExited),
        );

        let exits_during_ready_probe = ProcessObservation::new();
        let probe_observation = exits_during_ready_probe.clone();
        assert_eq!(
            wait_for_readiness_with_probe(
                &exits_during_ready_probe,
                Duration::from_secs(1),
                Duration::ZERO,
                move || {
                    probe_observation.record_termination(Some(1));
                    Readiness::Ready
                },
            ),
            Err(StartupFailureKind::HostExited),
        );
    }

    #[test]
    fn port_inspection_identifies_codetether_and_does_not_own_the_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 512];
                let _ = stream.read(&mut request).unwrap();
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n{\"protocolVersion\":1,\"hostVersion\":\"external\"}",
                    )
                    .unwrap();
            }
        });

        assert_eq!(
            inspect_service_at(address, Duration::from_secs(1)),
            ExistingService::CodeTether,
        );
        assert_eq!(
            read_bootstrap_at(address, Duration::from_secs(1))
                .unwrap()
                .unwrap()
                .host_version,
            "external",
        );
        server.join().unwrap();
    }

    #[test]
    fn port_inspection_distinguishes_unknown_and_unoccupied_ports() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let occupied_address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nconnection: close\r\n\r\nnot-codetether")
                .unwrap();
        });
        assert_eq!(
            inspect_service_at(occupied_address, Duration::from_secs(1)),
            ExistingService::Other,
        );
        server.join().unwrap();

        let free_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let free_address = free_listener.local_addr().unwrap();
        drop(free_listener);
        assert_eq!(
            inspect_service_at(free_address, Duration::from_millis(100)),
            ExistingService::None,
        );
    }

    #[test]
    fn a_silent_listener_is_a_conflict_not_a_free_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        assert_eq!(
            inspect_service_at(address, Duration::from_millis(20)),
            ExistingService::Other,
        );
        server.join().unwrap();
    }
}
