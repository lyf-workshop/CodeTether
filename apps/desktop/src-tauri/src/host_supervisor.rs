mod process_tree;

use std::{
    io::{self, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{SyncSender, sync_channel},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

use self::process_tree::ProcessTreeGuard;
use crate::{
    attention_notifications::AttentionNotificationState,
    desktop_lifecycle::{
        DesktopLifecycle, LifecycleSnapshot, MainWindowCloseAction, ResumeDecision, SystemState,
    },
    startup_error::{self, StartupFailureKind},
    system_tray, windows_lifecycle,
};

const HOST_ADDRESS: &str = "127.0.0.1:4317";
const HOST_URL: &str = "http://127.0.0.1:4317";
const PROTOCOL_VERSION: u32 = 1;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(12);
const SESSION_END_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const SHUTDOWN_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(15);
const RESUME_HEALTH_TIMEOUT: Duration = Duration::from_millis(750);
const PROBE_INTERVAL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT: Duration = Duration::from_millis(350);
const MAX_BOOTSTRAP_BYTES: u64 = 64 * 1024;
const MAX_SMOKE_EXIT_DELAY_MS: u64 = 3_900_000;
const DESKTOP_RESUMED_EVENT: &str = "codetether://desktop-resumed";

#[derive(Clone)]
struct DesktopState {
    host: Arc<Mutex<Option<HostSupervisor>>>,
    host_epoch: Arc<Mutex<Option<String>>>,
    lifecycle: Arc<Mutex<DesktopLifecycle>>,
    surface_initialized: Arc<AtomicBool>,
    background_education_shown: Arc<AtomicBool>,
    lifecycle_log: Option<SyncSender<String>>,
}

impl DesktopState {
    fn new(host: HostSupervisor, background_education_shown: bool) -> Self {
        Self {
            host: Arc::new(Mutex::new(Some(host))),
            host_epoch: Arc::new(Mutex::new(None)),
            lifecycle: Arc::new(Mutex::new(DesktopLifecycle::new())),
            surface_initialized: Arc::new(AtomicBool::new(false)),
            background_education_shown: Arc::new(AtomicBool::new(background_education_shown)),
            lifecycle_log: create_lifecycle_log_channel(),
        }
    }

    fn mark_ready(&self) {
        lock(&self.lifecycle).mark_ready();
    }

    #[cfg(test)]
    fn is_ready(&self) -> bool {
        lock(&self.lifecycle).is_ready()
    }

    fn begin_shutdown(&self) -> bool {
        let claimed = lock(&self.lifecycle).begin_shutdown();
        if claimed && let Some(host) = lock(&self.host).as_ref() {
            host.prepare_shutdown();
        }
        claimed
    }

    fn begin_failure_shutdown(&self) -> bool {
        let claimed = lock(&self.lifecycle).begin_failure_shutdown();
        if claimed && let Some(host) = lock(&self.host).as_ref() {
            host.prepare_shutdown();
        }
        claimed
    }

    fn is_shutting_down(&self) -> bool {
        lock(&self.lifecycle).is_shutting_down()
    }

    fn can_restore_main_window(&self) -> bool {
        lock(&self.lifecycle).can_restore_main_window()
    }

    fn main_window_close_action(&self) -> MainWindowCloseAction {
        lock(&self.lifecycle).main_window_close_action()
    }

    fn claim_background_education(&self) -> bool {
        self.background_education_shown
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn should_prevent_exit(&self) -> bool {
        lock(&self.lifecycle).should_prevent_exit()
    }

    fn allow_exit(&self) {
        lock(&self.lifecycle).allow_exit();
    }

    fn shutdown_owned_host(&self, timeout: Duration) -> ShutdownOutcome {
        if let Some(host) = lock(&self.host).as_mut() {
            return host.shutdown(timeout);
        }
        ShutdownOutcome::Clean
    }

    fn snapshot(&self) -> LifecycleSnapshot {
        lock(&self.lifecycle).snapshot()
    }

    fn host_process(&self) -> Option<(u32, ProcessObservation)> {
        lock(&self.host)
            .as_ref()
            .and_then(|host| host.pid().map(|pid| (pid, host.observation())))
    }

    fn set_host_epoch(&self, epoch: String) {
        *lock(&self.host_epoch) = Some(epoch);
    }

    fn host_epoch(&self) -> Option<String> {
        lock(&self.host_epoch).clone()
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionEndReason {
    pub(crate) critical: bool,
    pub(crate) logoff: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopResumePayload {
    host_epoch: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResumeHealthOutcome {
    Ready(Duration),
    HostExited,
    ProtocolIncompatible,
    IdentityChanged,
    Unavailable,
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
                            let failure_app = monitor_app.clone();
                            if let Err(error) = monitor_app.run_on_main_thread(move || {
                                handle_unexpected_host_exit(failure_app);
                            }) {
                                eprintln!(
                                    "[codetether:desktop] could not schedule the Host failure surface: {error}"
                                );
                                emergency_shutdown_after_event_loop_failure(&monitor_app, 1);
                            }
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

    fn prepare_shutdown(&self) {
        self.observation.stopping.store(true, Ordering::Release);
    }

    fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(CommandChild::pid)
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

#[derive(Clone, Debug, Eq, PartialEq)]
enum Readiness {
    Ready(BootstrapIdentity),
    NotReady,
    ProtocolIncompatible,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct BootstrapIdentity {
    epoch: String,
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
) -> Result<(Duration, BootstrapIdentity), StartupFailureKind> {
    wait_for_readiness_with_probe(observation, timeout, PROBE_INTERVAL, || {
        probe_readiness(expected_host_version)
    })
}

fn wait_for_readiness_with_probe(
    observation: &ProcessObservation,
    timeout: Duration,
    interval: Duration,
    mut probe: impl FnMut() -> Readiness,
) -> Result<(Duration, BootstrapIdentity), StartupFailureKind> {
    let started_at = Instant::now();
    loop {
        if observation.termination().is_some() {
            return Err(StartupFailureKind::HostExited);
        }
        match probe() {
            Readiness::Ready(identity) => {
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
                return Ok((started_at.elapsed(), identity));
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
            Readiness::Ready(identity)
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
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid bootstrap timeout"))?;
    let stream = TcpStream::connect_timeout(&address, timeout)?;
    read_bootstrap_from_stream(stream, address, deadline)
}

fn read_bootstrap_from_stream(
    mut stream: TcpStream,
    address: SocketAddr,
    deadline: Instant,
) -> io::Result<Option<BootstrapIdentity>> {
    stream.set_write_timeout(Some(remaining_until(deadline)?))?;
    stream.write_all(
        format!("GET /api/v1/bootstrap HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    )?;
    let mut response = Vec::new();
    let mut limited = stream.take(MAX_BOOTSTRAP_BYTES);
    loop {
        limited
            .get_mut()
            .set_read_timeout(Some(remaining_until(deadline)?))?;
        let mut chunk = [0_u8; 8 * 1024];
        let read = limited.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
    }
    Ok(parse_bootstrap_response(&response))
}

fn remaining_until(deadline: Instant) -> io::Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "bootstrap deadline elapsed"))
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
            && milliseconds <= MAX_SMOKE_EXIT_DELAY_MS
        {
            return Some(Duration::from_millis(milliseconds));
        }
    }
    None
}

fn create_lifecycle_log_channel() -> Option<SyncSender<String>> {
    let (sender, receiver) = sync_channel::<String>(256);
    thread::Builder::new()
        .name("codetether-lifecycle-log".into())
        .spawn(move || {
            while let Ok(record) = receiver.recv() {
                eprintln!("[codetether:lifecycle] {record}");
            }
        })
        .ok()
        .map(|_| sender)
}

fn log_lifecycle_event(event: &str, state: &DesktopState, details: serde_json::Value) {
    let record = serde_json::json!({
        "event": event,
        "desktopPid": std::process::id(),
        "state": state.snapshot(),
        "details": details,
    });
    if let Some(sender) = &state.lifecycle_log {
        // Lifecycle hooks run on the native window thread. Never let a full or
        // broken diagnostic sink block WM_QUERYENDSESSION/WM_ENDSESSION.
        let _ = sender.try_send(record.to_string());
    }
}

pub(crate) fn confirm_windows_suspend(app: &AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    let mut lifecycle = lock(&state.lifecycle);
    lifecycle.begin_suspend();
    lifecycle.mark_suspended();
    drop(lifecycle);
    log_lifecycle_event("system_suspended", &state, serde_json::json!({}));
}

pub(crate) fn handle_windows_session_change(app: &AppHandle, locked: bool) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    lock(&state.lifecycle).mark_session_locked(locked);
    log_lifecycle_event(
        if locked {
            "session_locked"
        } else {
            "session_unlocked"
        },
        &state,
        serde_json::json!({}),
    );
}

pub(crate) fn query_windows_session_end(app: &AppHandle, reason: SessionEndReason) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    // WM_QUERYENDSESSION must return immediately. This in-memory transition
    // only disables hide/restore; diagnostics and bounded I/O are deferred
    // until WM_ENDSESSION confirms the session end.
    lock(&state.lifecycle).query_session_end();
    let _ = reason;
}

pub(crate) fn confirm_windows_session_end(app: &AppHandle, reason: SessionEndReason) {
    let session_end_started_at = Instant::now();
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    lock(&state.lifecycle).query_session_end();
    log_lifecycle_event(
        "session_ending",
        &state,
        serde_json::to_value(reason).unwrap_or_else(|_| serde_json::json!({})),
    );
    finish_unpreventable_shutdown(&state, session_end_started_at);
    // A real Windows broadcast will also reach Tao's private lifecycle HWND,
    // but explicitly requesting exit makes the bounded main-window hook
    // complete correctly in message-level harnesses and unusual shell paths.
    // The reducer guard keeps the later Tao RunEvent::Exit drain idempotent.
    app.exit(0);
}

pub(crate) fn cancel_windows_session_end(app: &AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    if lock(&state.lifecycle).cancel_session_end() {
        log_lifecycle_event("session_end_cancelled", &state, serde_json::json!({}));
        if state.snapshot().app == crate::desktop_lifecycle::AppState::Ready
            && !state.surface_initialized.load(Ordering::Acquire)
        {
            finish_desktop_initialization(app.clone(), state.inner().clone(), None);
        }
    }
}

pub(crate) fn resume_windows_runtime(app: &AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    // Windows commonly delivers both PBT_APMRESUMEAUTOMATIC and
    // PBT_APMRESUMESUSPEND for one wake. Drop the reducer guard before the
    // duplicate/deferred branches log a snapshot; otherwise the temporary
    // guard from the match scrutinee can live through the selected arm and
    // deadlock the native window thread on the second resume message.
    let resume_decision = {
        let mut lifecycle = lock(&state.lifecycle);
        lifecycle.begin_resume()
    };
    let resume_generation = match resume_decision {
        ResumeDecision::Ignored => {
            log_lifecycle_event("system_resume_duplicate", &state, serde_json::json!({}));
            return;
        }
        ResumeDecision::StartupDeferred => {
            log_lifecycle_event(
                "system_resume_startup_deferred",
                &state,
                serde_json::json!({}),
            );
            // Startup's existing readiness worker remains the only native
            // Host validator; Web may still need to retire a half-open SSE.
            emit_desktop_resumed(app);
            return;
        }
        ResumeDecision::Reconcile(generation) => generation,
    };
    let Some((host_pid, observation)) = state.host_process() else {
        if lock(&state.lifecycle).finish_resume(resume_generation, false) {
            handle_resume_health_failure(
                app.clone(),
                state.inner().clone(),
                ResumeHealthOutcome::HostExited,
            );
        }
        return;
    };
    let Some(expected_epoch) = state.host_epoch() else {
        if lock(&state.lifecycle).finish_resume(resume_generation, false) {
            handle_resume_health_failure(
                app.clone(),
                state.inner().clone(),
                ResumeHealthOutcome::IdentityChanged,
            );
        }
        return;
    };
    log_lifecycle_event(
        "system_resuming",
        &state,
        serde_json::json!({ "hostPid": host_pid }),
    );
    let resume_app = app.clone();
    let resume_state = state.inner().clone();
    thread::spawn(move || {
        let outcome = wait_for_resume_health(
            &observation,
            RESUME_HEALTH_TIMEOUT,
            env!("CODETETHER_BUILD_ID"),
            &expected_epoch,
        );
        match outcome {
            ResumeHealthOutcome::Ready(elapsed) => {
                if !lock(&resume_state.lifecycle).finish_resume(resume_generation, true) {
                    return;
                }
                log_lifecycle_event(
                    "system_resumed",
                    &resume_state,
                    serde_json::json!({
                        "hostPid": host_pid,
                        "healthCheckMs": elapsed.as_millis(),
                    }),
                );
                emit_desktop_resumed(&resume_app);
            }
            ResumeHealthOutcome::Unavailable => {
                if !lock(&resume_state.lifecycle).finish_resume(resume_generation, false) {
                    return;
                }
                log_lifecycle_event(
                    "system_resume_unavailable",
                    &resume_state,
                    serde_json::json!({ "hostPid": host_pid }),
                );
                // The owned child is still alive. Do not restart or kill it;
                // force the existing cursor-based Web transport to reconcile.
                emit_desktop_resumed(&resume_app);
            }
            failure => {
                if !lock(&resume_state.lifecycle).finish_resume(resume_generation, false) {
                    return;
                }
                handle_resume_health_failure(resume_app, resume_state, failure);
            }
        }
    });
}

fn emit_desktop_resumed(app: &AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    let Some(host_epoch) = state.host_epoch() else {
        return;
    };
    if let Err(error) = app.emit(DESKTOP_RESUMED_EVENT, DesktopResumePayload { host_epoch }) {
        eprintln!(
            "[codetether:desktop] could not emit the bounded resume recovery signal: {error}"
        );
    }
}

fn wait_for_resume_health(
    observation: &ProcessObservation,
    timeout: Duration,
    expected_host_version: &str,
    expected_epoch: &str,
) -> ResumeHealthOutcome {
    wait_for_resume_health_with_probe(observation, expected_host_version, expected_epoch, || {
        read_bootstrap(timeout)
    })
}

fn wait_for_resume_health_with_probe(
    observation: &ProcessObservation,
    expected_host_version: &str,
    expected_epoch: &str,
    probe: impl FnOnce() -> io::Result<Option<BootstrapIdentity>>,
) -> ResumeHealthOutcome {
    let started_at = Instant::now();
    if observation.termination().is_some() {
        return ResumeHealthOutcome::HostExited;
    }
    let identity = match probe() {
        Ok(Some(identity)) => identity,
        Ok(None) | Err(_) => {
            return if observation.termination().is_some() {
                ResumeHealthOutcome::HostExited
            } else {
                ResumeHealthOutcome::Unavailable
            };
        }
    };
    if observation.termination().is_some() {
        return ResumeHealthOutcome::HostExited;
    }
    if identity.protocol_version != PROTOCOL_VERSION
        || identity.host_version != expected_host_version
    {
        return ResumeHealthOutcome::ProtocolIncompatible;
    }
    if identity.epoch != expected_epoch {
        return ResumeHealthOutcome::IdentityChanged;
    }
    ResumeHealthOutcome::Ready(started_at.elapsed())
}

fn handle_resume_health_failure(app: AppHandle, state: DesktopState, failure: ResumeHealthOutcome) {
    log_lifecycle_event(
        "system_resume_failed",
        &state,
        serde_json::json!({ "reason": format!("{failure:?}") }),
    );
    let surface = match failure {
        ResumeHealthOutcome::ProtocolIncompatible | ResumeHealthOutcome::IdentityChanged => {
            StartupFailureKind::ProtocolIncompatible
        }
        ResumeHealthOutcome::Unavailable => StartupFailureKind::ReadinessTimeout,
        ResumeHealthOutcome::HostExited | ResumeHealthOutcome::Ready(_) => {
            StartupFailureKind::HostExited
        }
    };
    let failure_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if !state.begin_failure_shutdown() {
            return;
        }
        if state.snapshot().system != SystemState::SessionEnding {
            show_main_window_for_failure(&failure_app);
            show_runtime_failure(&failure_app, surface);
        }
        thread::spawn(move || finish_owned_shutdown(state, failure_app, 1));
    }) {
        eprintln!("[codetether:desktop] could not schedule resume failure handling: {error}");
        emergency_shutdown_after_event_loop_failure(&app, 1);
    }
}

fn finish_owned_shutdown(state: DesktopState, app: AppHandle, code: i32) -> ! {
    // This is a final process-level guard around the normal bounded Host
    // shutdown. If a platform process primitive itself stalls, exiting the
    // Desktop closes the Windows Job handle and still prevents an orphaned
    // Host/Codex process tree.
    thread::spawn(|| {
        thread::sleep(SHUTDOWN_WATCHDOG_TIMEOUT);
        eprintln!("[codetether:desktop] shutdown watchdog forced process exit");
        std::process::exit(1);
    });
    let outcome = state.shutdown_owned_host(SHUTDOWN_TIMEOUT);
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
    system_tray::remove(&app);
    // The Host and its owned process tree are fully drained at this point.
    // Exiting directly avoids a Windows/Tauri edge case where re-requesting
    // exit after preventing the original window-close event can leave a
    // windowless event loop alive indefinitely. Shutdown diagnostics must not
    // open a blocking modal here: the visible product window is already
    // closing and an unowned MessageBox can itself orphan the Desktop process.
    std::process::exit(exit_code);
}

fn finish_unpreventable_shutdown(state: &DesktopState, started_at: Instant) {
    let session_ending = state.snapshot().system == SystemState::SessionEnding;
    if !state.begin_shutdown() {
        return;
    }
    // RunEvent::Exit is unpreventable. On Windows it can execute synchronously
    // inside WM_ENDSESSION, including the narrow case where QUERY was not
    // observed. Keep the UI thread bounded even if a pipe, process primitive,
    // or Host cleanup step itself stalls beyond its internal timeout.
    let deadline = started_at + SESSION_END_SHUTDOWN_TIMEOUT;
    let worker_timeout = deadline.saturating_duration_since(Instant::now());
    let shutdown_state = state.clone();
    let (completed, completion) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = completed.send(shutdown_state.shutdown_owned_host(worker_timeout));
    });
    let wait_timeout = deadline.saturating_duration_since(Instant::now());
    let outcome = if wait_timeout.is_zero() {
        None
    } else {
        completion.recv_timeout(wait_timeout).ok()
    };
    state.allow_exit();
    if session_ending {
        log_lifecycle_event(
            "session_end_shutdown_finished",
            state,
            serde_json::json!({
                "budgetMs": SESSION_END_SHUTDOWN_TIMEOUT.as_millis(),
                "elapsedMs": started_at.elapsed().as_millis(),
                "outcome": outcome
                    .map(|value| format!("{value:?}"))
                    .unwrap_or_else(|| "TimedOut".to_owned()),
            }),
        );
    }
}

pub(crate) fn request_app_quit(app: &AppHandle, code: i32) {
    let quit_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(state) = quit_app.try_state::<DesktopState>() else {
            quit_app.exit(code);
            return;
        };
        if !state.begin_shutdown() {
            return;
        }
        let state = state.inner().clone();
        thread::spawn(move || finish_owned_shutdown(state, quit_app, code));
    }) {
        eprintln!("[codetether:desktop] could not schedule explicit quit: {error}");
        emergency_shutdown_after_event_loop_failure(app, code);
    }
}

pub(crate) fn show_main_window(app: &AppHandle) -> Result<bool, String> {
    let Some(state) = app.try_state::<DesktopState>() else {
        return Ok(false);
    };
    if !state.can_restore_main_window() {
        return Ok(false);
    }
    let restore_app = app.clone();
    app.run_on_main_thread(move || {
        let Some(state) = restore_app.try_state::<DesktopState>() else {
            return;
        };
        // This effect-time check runs on the same main event loop as Quit,
        // CloseRequested, tray callbacks, and second-instance activation. A
        // queued background notification therefore cannot reveal the window
        // after a previously handled Quit transition.
        if !state.can_restore_main_window() {
            return;
        }
        let started_at = Instant::now();
        let result = (|| {
            let window = restore_app
                .get_webview_window("main")
                .ok_or_else(|| "the configured main window is unavailable".to_owned())?;
            window.unminimize().map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            lock(&state.lifecycle).mark_window_visible();
            Ok::<(), String>(())
        })();
        match result {
            Ok(()) => log_lifecycle_event(
                "main_window_restored",
                &state,
                serde_json::json!({ "nativeLatencyMs": started_at.elapsed().as_millis() }),
            ),
            Err(error) => {
                eprintln!("[codetether:desktop] could not restore the main window: {error}")
            }
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(true)
}

fn emergency_shutdown_after_event_loop_failure(app: &AppHandle, code: i32) {
    let Some(state) = app.try_state::<DesktopState>() else {
        std::process::exit(code);
    };
    if !state.begin_failure_shutdown() {
        return;
    }
    let state = state.inner().clone();
    let app = app.clone();
    thread::spawn(move || finish_owned_shutdown(state, app, code));
}

fn handle_unexpected_host_exit(app: AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        startup_error::show(StartupFailureKind::HostExited);
        std::process::exit(1);
    };
    if !state.begin_failure_shutdown() {
        return;
    }
    if state.snapshot().system != SystemState::SessionEnding {
        show_main_window_for_failure(&app);
        show_runtime_failure(&app, StartupFailureKind::HostExited);
    }
    let state = state.inner().clone();
    thread::spawn(move || finish_owned_shutdown(state, app, 1));
}

fn finish_desktop_initialization(
    app: AppHandle,
    state: DesktopState,
    smoke_exit_delay: Option<Duration>,
) {
    if state.is_shutting_down() {
        return;
    }
    state.mark_ready();
    if state.snapshot().system == SystemState::SessionEnding {
        log_lifecycle_event(
            "desktop_surface_deferred_for_session_end",
            &state,
            serde_json::json!({}),
        );
        return;
    }
    let initialization = (|| {
        system_tray::create(&app).map_err(|error| (StartupFailureKind::TrayUnavailable, error))?;
        let window = app.get_webview_window("main").ok_or_else(|| {
            (
                StartupFailureKind::HostSpawnFailed,
                "the configured main window is missing".to_owned(),
            )
        })?;
        window
            .show()
            .map_err(|error| (StartupFailureKind::HostSpawnFailed, error.to_string()))?;
        state.surface_initialized.store(true, Ordering::Release);
        lock(&state.lifecycle).mark_window_visible();
        log_lifecycle_event("desktop_ready", &state, serde_json::json!({}));
        Ok::<(), (StartupFailureKind, String)>(())
    })();
    if let Err((failure, error)) = initialization {
        system_tray::remove(&app);
        eprintln!("[codetether:desktop] could not initialize the Desktop window/tray: {error}");
        if !state.begin_failure_shutdown() {
            return;
        }
        if state.snapshot().system != SystemState::SessionEnding {
            startup_error::show(failure);
        }
        thread::spawn(move || finish_owned_shutdown(state, app, 1));
        return;
    }
    if let Some(delay) = smoke_exit_delay {
        thread::spawn(move || {
            thread::sleep(delay);
            request_app_quit(&app, 0);
        });
    }
}

fn finish_startup_failure(app: AppHandle, state: DesktopState, failure: StartupFailureKind) {
    if !state.begin_failure_shutdown() {
        return;
    }
    if state.snapshot().system != SystemState::SessionEnding {
        startup_error::show(failure);
    }
    thread::spawn(move || finish_owned_shutdown(state, app, 1));
}

fn show_main_window_for_failure(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.unminimize() {
        eprintln!("[codetether:desktop] could not unminimize the failed Desktop window: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("[codetether:desktop] could not reveal the failed Desktop window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[codetether:desktop] could not focus the failed Desktop window: {error}");
    }
}

fn show_runtime_failure(app: &AppHandle, failure: StartupFailureKind) {
    if let Some(window) = app.get_webview_window("main") {
        startup_error::show_for_window(failure, &window);
    } else {
        startup_error::show(failure);
    }
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
            if let Err(error) = show_main_window(app) {
                eprintln!(
                    "[codetether:desktop] could not restore the main window for a second launch: {error}"
                );
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            crate::project_directory_picker::pick_project_directory,
            crate::attention_notifications::deliver_attention_notification,
            crate::attention_notifications::take_pending_notification_intent
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
            let state = DesktopState::new(
                host,
                system_tray::background_education_was_shown(app.handle()),
            );
            app.manage(state.clone());
            app.manage(AttentionNotificationState::default());

            if let Err(error) = windows_lifecycle::install(app.handle()) {
                eprintln!(
                    "[codetether:desktop] could not initialize Windows lifecycle handling: {error}"
                );
                finish_startup_failure(
                    app.handle().clone(),
                    state,
                    StartupFailureKind::LifecycleUnavailable,
                );
                return Ok(());
            }

            let app_handle = app.handle().clone();
            let smoke_exit_delay = smoke_exit_delay(std::env::args());
            thread::spawn(move || {
                match wait_for_readiness(&observation, STARTUP_TIMEOUT, env!("CODETETHER_BUILD_ID"))
                {
                    Ok((elapsed, identity)) => {
                        state.set_host_epoch(identity.epoch);
                        eprintln!(
                            "[codetether:desktop] Host ready at {HOST_URL} in {} ms",
                            elapsed.as_millis()
                        );
                        let initialization_app = app_handle.clone();
                        let initialization_state = state.clone();
                        if let Err(error) = app_handle.run_on_main_thread(move || {
                            finish_desktop_initialization(
                                initialization_app,
                                initialization_state,
                                smoke_exit_delay,
                            );
                        }) {
                            eprintln!(
                                "[codetether:desktop] could not schedule Desktop initialization: {error}"
                            );
                            emergency_shutdown_after_event_loop_failure(&app_handle, 1);
                        }
                    }
                    Err(failure) => {
                        let failure_app = app_handle.clone();
                        let failure_state = state.clone();
                        if let Err(error) = app_handle.run_on_main_thread(move || {
                            finish_startup_failure(failure_app, failure_state, failure);
                        }) {
                            eprintln!(
                                "[codetether:desktop] could not schedule startup failure handling: {error}"
                            );
                            emergency_shutdown_after_event_loop_failure(&app_handle, 1);
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
            if let Some(state) = app_handle.try_state::<DesktopState>() {
                match state.main_window_close_action() {
                    MainWindowCloseAction::Hide => {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let started_at = Instant::now();
                            match window.hide() {
                                Ok(()) => {
                                    lock(&state.lifecycle).mark_window_hidden();
                                    log_lifecycle_event(
                                        "main_window_hidden",
                                        &state,
                                        serde_json::json!({
                                            "nativeLatencyMs": started_at.elapsed().as_millis(),
                                        }),
                                    );
                                    if state.claim_background_education() {
                                        system_tray::persist_and_show_background_education(
                                            app_handle,
                                        );
                                    }
                                }
                                Err(error) => eprintln!(
                                    "[codetether:desktop] could not hide the main window: {error}"
                                ),
                            }
                        }
                    }
                    MainWindowCloseAction::Prevent => api.prevent_close(),
                    MainWindowCloseAction::Allow => {}
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Resized(_),
            ..
        } if label == "main" => {
            if let (Some(state), Some(window)) = (
                app_handle.try_state::<DesktopState>(),
                app_handle.get_webview_window("main"),
            ) {
                match window.is_minimized() {
                    Ok(true) => lock(&state.lifecycle).mark_window_minimized(),
                    Ok(false) => {
                        if window.is_visible().unwrap_or(false) {
                            lock(&state.lifecycle).mark_window_visible();
                        }
                    }
                    Err(error) => eprintln!(
                        "[codetether:desktop] could not observe the main window state: {error}"
                    ),
                }
            }
        }
        RunEvent::ExitRequested { code, api, .. } => {
            if let Some(state) = app_handle.try_state::<DesktopState>()
                && state.should_prevent_exit()
            {
                api.prevent_exit();
                request_app_quit(app_handle, code.unwrap_or(0));
            }
        }
        RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<DesktopState>() {
                finish_unpreventable_shutdown(&state, Instant::now());
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desktop_state() -> DesktopState {
        DesktopState {
            host: Arc::new(Mutex::new(None)),
            host_epoch: Arc::new(Mutex::new(None)),
            lifecycle: Arc::new(Mutex::new(DesktopLifecycle::new())),
            surface_initialized: Arc::new(AtomicBool::new(false)),
            background_education_shown: Arc::new(AtomicBool::new(false)),
            lifecycle_log: None,
        }
    }

    fn bootstrap_identity(epoch: &str) -> BootstrapIdentity {
        BootstrapIdentity {
            epoch: epoch.to_owned(),
            protocol_version: PROTOCOL_VERSION,
            host_version: "git-test".to_owned(),
        }
    }

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
        let state = desktop_state();
        assert!(state.should_prevent_exit());
        assert!(state.begin_shutdown());
        assert!(state.should_prevent_exit());
        assert!(!state.begin_shutdown());
        assert_eq!(
            state.shutdown_owned_host(SHUTDOWN_TIMEOUT),
            ShutdownOutcome::Clean
        );
        state.allow_exit();
        assert!(!state.should_prevent_exit());
    }

    #[test]
    fn second_launch_cannot_reveal_the_window_before_readiness() {
        let state = desktop_state();
        assert!(!state.is_ready());
        assert!(!state.can_restore_main_window());
        state.mark_ready();
        assert!(state.is_ready());
        assert!(state.can_restore_main_window());
    }

    #[test]
    fn window_close_hides_only_while_the_runtime_is_running() {
        let state = desktop_state();
        assert_eq!(
            state.main_window_close_action(),
            MainWindowCloseAction::Hide
        );
        assert!(state.begin_shutdown());
        assert_eq!(
            state.main_window_close_action(),
            MainWindowCloseAction::Prevent
        );
        assert!(!state.can_restore_main_window());
        state.allow_exit();
        assert_eq!(
            state.main_window_close_action(),
            MainWindowCloseAction::Allow
        );
    }

    #[test]
    fn restore_effect_is_rejected_after_quit_transition() {
        let state = desktop_state();
        state.mark_ready();
        assert!(state.can_restore_main_window());
        assert!(state.begin_shutdown());
        assert!(!state.can_restore_main_window());
    }

    #[test]
    fn readiness_side_effects_are_skipped_after_shutdown_begins() {
        let state = desktop_state();
        assert!(state.begin_shutdown());
        assert!(state.is_shutting_down());
        assert!(!state.is_ready());
    }

    #[test]
    fn background_education_is_claimed_at_most_once_per_process() {
        let state = desktop_state();
        assert!(state.claim_background_education());
        assert!(!state.claim_background_education());
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
        let valid = b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"epoch\":\"11111111-1111-4111-8111-111111111111\",\"protocolVersion\":1,\"hostVersion\":\"git-abc1234\"}";
        let identity = parse_bootstrap_response(valid).unwrap();
        assert_eq!(identity.epoch, "11111111-1111-4111-8111-111111111111");
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
            smoke_exit_delay(["--desktop-smoke-exit-after-ready-ms=3900001".into()]),
            None,
        );
    }

    #[test]
    fn readiness_succeeds_without_a_fixed_startup_sleep() {
        let observation = ProcessObservation::new();
        let (elapsed, identity) = wait_for_readiness_with_probe(
            &observation,
            Duration::from_secs(1),
            Duration::ZERO,
            || Readiness::Ready(bootstrap_identity("epoch-ready")),
        )
        .unwrap();
        assert!(elapsed < Duration::from_secs(1));
        assert_eq!(identity.epoch, "epoch-ready");
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
                Readiness::Ready(bootstrap_identity("epoch-exited"))
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
                    Readiness::Ready(bootstrap_identity("epoch-race"))
                },
            ),
            Err(StartupFailureKind::HostExited),
        );
    }

    #[test]
    fn resume_health_uses_one_probe_and_requires_the_owned_epoch() {
        let observation = ProcessObservation::new();
        let probe_calls = std::cell::Cell::new(0_u8);
        let ready =
            wait_for_resume_health_with_probe(&observation, "git-test", "epoch-owned", || {
                probe_calls.set(probe_calls.get() + 1);
                Ok(Some(bootstrap_identity("epoch-owned")))
            });
        assert!(matches!(ready, ResumeHealthOutcome::Ready(_)));
        assert_eq!(probe_calls.get(), 1);

        assert_eq!(
            wait_for_resume_health_with_probe(&observation, "git-test", "epoch-owned", || Ok(
                Some(bootstrap_identity("epoch-replaced"))
            ),),
            ResumeHealthOutcome::IdentityChanged,
        );
    }

    #[test]
    fn resume_health_keeps_a_live_but_unresponsive_host_owned() {
        let observation = ProcessObservation::new();
        assert_eq!(
            wait_for_resume_health_with_probe(&observation, "git-test", "epoch-owned", || Ok(None),),
            ResumeHealthOutcome::Unavailable,
        );
        observation.record_termination(Some(1));
        assert_eq!(
            wait_for_resume_health_with_probe(&observation, "git-test", "epoch-owned", || panic!(
                "an exited Host must not be probed"
            ),),
            ResumeHealthOutcome::HostExited,
        );
    }

    #[test]
    fn session_end_budget_is_shorter_than_normal_quit_and_the_os_guard() {
        assert!(SESSION_END_SHUTDOWN_TIMEOUT < SHUTDOWN_TIMEOUT);
        assert!(SESSION_END_SHUTDOWN_TIMEOUT < SHUTDOWN_WATCHDOG_TIMEOUT);
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
                        b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n{\"epoch\":\"99999999-9999-4999-8999-999999999999\",\"protocolVersion\":1,\"hostVersion\":\"external\"}",
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
