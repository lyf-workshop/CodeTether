use std::{
    fs,
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Url, ipc::Channel};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

const UPDATE_EVENT: &str = "codetether://update-state";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(30);
const PACKAGE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const SUCCESS_MARKER: &str = "desktop-update-pending";
const MAX_NOTES_CHARS: usize = 2_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum UpdateStatus {
    Unconfigured,
    Latest,
    Checking,
    Available,
    Downloading,
    Downloaded,
    Installing,
    CheckFailed,
    DownloadFailed,
    SignatureFailed,
    InstallFailed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateSnapshot {
    status: UpdateStatus,
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    available_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress_percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_checked_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_to: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    progress_percent: Option<u8>,
}

struct UpdateInner {
    snapshot: UpdateSnapshot,
    announced: Option<Update>,
    package: Option<Vec<u8>>,
}

#[derive(Clone)]
pub(crate) struct DesktopUpdate(Arc<Mutex<UpdateInner>>);

impl DesktopUpdate {
    fn new(app: &AppHandle) -> Self {
        let configured = compiled_configuration().is_some();
        Self(Arc::new(Mutex::new(UpdateInner {
            snapshot: UpdateSnapshot {
                status: if configured {
                    UpdateStatus::Latest
                } else {
                    UpdateStatus::Unconfigured
                },
                current_version: env!("CARGO_PKG_VERSION").to_owned(),
                available_version: None,
                notes: None,
                progress_percent: None,
                last_checked_at: None,
                updated_to: read_success_marker(app),
            },
            announced: None,
            package: None,
        })))
    }

    fn snapshot(&self) -> UpdateSnapshot {
        lock(&self.0).snapshot.clone()
    }

    fn emit(&self, app: &AppHandle) -> UpdateSnapshot {
        let snapshot = self.snapshot();
        let _ = app.emit(UPDATE_EVENT, snapshot.clone());
        snapshot
    }

    async fn check(&self, app: &AppHandle) -> UpdateSnapshot {
        let Some((endpoint, _)) = compiled_configuration() else {
            return self.snapshot();
        };
        {
            let mut inner = lock(&self.0);
            if matches!(
                inner.snapshot.status,
                UpdateStatus::Checking
                    | UpdateStatus::Downloading
                    | UpdateStatus::Downloaded
                    | UpdateStatus::Installing
            ) {
                return inner.snapshot.clone();
            }
            inner.snapshot.status = UpdateStatus::Checking;
            inner.snapshot.progress_percent = None;
        }
        self.emit(app);

        let result = match app
            .updater_builder()
            .timeout(MANIFEST_TIMEOUT)
            .endpoints(vec![endpoint.clone()])
        {
            Ok(builder) => match builder.build() {
                Ok(updater) => updater.check().await,
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        };
        let mut inner = lock(&self.0);
        inner.snapshot.last_checked_at = Some(now_ms());
        match result {
            Ok(Some(update))
                if allowed_download_url(&endpoint, &update.download_url, &update.version) =>
            {
                inner.snapshot.status = UpdateStatus::Available;
                inner.snapshot.available_version = Some(update.version.clone());
                inner.snapshot.notes = update.body.as_deref().map(truncate_notes);
                inner.announced = Some(update);
                inner.package = None;
            }
            Ok(Some(_)) => {
                inner.snapshot.status = UpdateStatus::CheckFailed;
                inner.snapshot.available_version = None;
                inner.snapshot.notes = None;
                inner.announced = None;
                inner.package = None;
            }
            Ok(None)
            | Err(UpdaterError::TargetNotFound(_))
            | Err(UpdaterError::TargetsNotFound(_)) => {
                inner.snapshot.status = UpdateStatus::Latest;
                inner.snapshot.available_version = None;
                inner.snapshot.notes = None;
                inner.announced = None;
                inner.package = None;
            }
            Err(error) => {
                eprintln!("[codetether:desktop] update check failed: {error}");
                inner.snapshot.status = UpdateStatus::CheckFailed;
                inner.snapshot.available_version = None;
                inner.snapshot.notes = None;
                inner.announced = None;
                inner.package = None;
            }
        }
        drop(inner);
        self.emit(app)
    }

    async fn download(
        &self,
        app: &AppHandle,
        channel: Channel<UpdateProgress>,
    ) -> Result<UpdateSnapshot, String> {
        let announced = {
            let mut inner = lock(&self.0);
            if !matches!(
                inner.snapshot.status,
                UpdateStatus::Available
                    | UpdateStatus::DownloadFailed
                    | UpdateStatus::SignatureFailed
            ) {
                return Err("目前没有可下载的更新".to_owned());
            }
            let mut announced = inner
                .announced
                .clone()
                .ok_or_else(|| "更新信息已失效，请重新检查更新".to_owned())?;
            // Updater 2.11.0 does not copy UpdaterBuilder::timeout into Update.
            // Bound the package request separately so a stalled download ends.
            announced.timeout = Some(PACKAGE_TIMEOUT);
            inner.snapshot.status = UpdateStatus::Downloading;
            inner.snapshot.progress_percent = Some(0);
            inner.package = None;
            announced
        };
        self.emit(app);

        let mut downloaded_bytes = 0_u64;
        let progress_state = self.clone();
        let progress_app = app.clone();
        let result = announced
            .download(
                move |chunk_bytes, total_bytes| {
                    downloaded_bytes = downloaded_bytes.saturating_add(chunk_bytes as u64);
                    let progress_percent = total_bytes.filter(|total| *total > 0).map(|total| {
                        ((downloaded_bytes.saturating_mul(100) / total).min(100)) as u8
                    });
                    let progress = UpdateProgress {
                        downloaded_bytes,
                        total_bytes,
                        progress_percent,
                    };
                    let _ = channel.send(progress);
                    let changed = {
                        let mut inner = lock(&progress_state.0);
                        if inner.snapshot.status != UpdateStatus::Downloading
                            || inner.snapshot.progress_percent == progress_percent
                        {
                            false
                        } else {
                            inner.snapshot.progress_percent = progress_percent;
                            true
                        }
                    };
                    if changed {
                        progress_state.emit(&progress_app);
                    }
                },
                || {},
            )
            .await;

        let mut inner = lock(&self.0);
        match result {
            Ok(package) => {
                inner.package = Some(package);
                inner.snapshot.status = UpdateStatus::Downloaded;
                inner.snapshot.progress_percent = Some(100);
            }
            Err(error) => {
                let signature_failure = is_signature_failure(&error);
                eprintln!(
                    "[codetether:desktop] update download failed (signature={}): {error}",
                    signature_failure
                );
                inner.snapshot.status = if signature_failure {
                    UpdateStatus::SignatureFailed
                } else {
                    UpdateStatus::DownloadFailed
                };
                inner.snapshot.progress_percent = None;
                inner.package = None;
            }
        }
        drop(inner);
        Ok(self.emit(app))
    }

    async fn install(&self, app: &AppHandle) -> Result<UpdateSnapshot, String> {
        let (announced, package) = {
            let mut inner = lock(&self.0);
            if !matches!(
                inner.snapshot.status,
                UpdateStatus::Downloaded | UpdateStatus::InstallFailed
            ) {
                return Err("请先下载并校验更新".to_owned());
            }
            let announced = inner
                .announced
                .clone()
                .ok_or_else(|| "更新信息已失效，请重新检查更新".to_owned())?;
            let package = inner
                .package
                .take()
                .ok_or_else(|| "已下载的更新已失效，请重新下载".to_owned())?;
            inner.snapshot.status = UpdateStatus::Installing;
            (announced, package)
        };
        self.emit(app);

        let shutdown_app = app.clone();
        let stopped = tauri::async_runtime::spawn_blocking(move || {
            crate::host_supervisor::shutdown_host_for_update(&shutdown_app)
        })
        .await;
        if !matches!(stopped, Ok(Ok(()))) {
            eprintln!("[codetether:desktop] update cancelled because Host shutdown failed");
            let restore_app = app.clone();
            let restored = tauri::async_runtime::spawn_blocking(move || {
                crate::host_supervisor::restore_host_after_update_failure(&restore_app)
            })
            .await;
            if !matches!(restored, Ok(Ok(()))) {
                eprintln!("[codetether:desktop] failed to restore Host after update cancellation");
            }
            return Ok(self.install_failed(app, package));
        }

        if let Err(error) = write_success_marker(app, &announced.version) {
            eprintln!("[codetether:desktop] could not prepare update completion marker: {error}");
            let restore_app = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                crate::host_supervisor::restore_host_after_update_failure(&restore_app)
            })
            .await;
            return Ok(self.install_failed(app, package));
        }

        let install_app = app.clone();
        let installed = tauri::async_runtime::spawn_blocking(move || {
            announced
                .install(&package)
                .map_err(|error| (error, package))
        })
        .await;
        match installed {
            Ok(Ok(())) => {
                #[cfg(target_os = "macos")]
                {
                    crate::host_supervisor::allow_restart_after_update(&install_app);
                    install_app.restart();
                }
                #[cfg(not(target_os = "macos"))]
                {
                    // On Windows the updater exits this process after launching NSIS.
                    // Reaching this branch on another platform is unsupported.
                    let _ = install_app;
                    remove_success_marker(app);
                    let mut inner = lock(&self.0);
                    inner.snapshot.status = UpdateStatus::DownloadFailed;
                    inner.snapshot.progress_percent = None;
                    drop(inner);
                    Ok(self.emit(app))
                }
            }
            Ok(Err((error, package))) => {
                eprintln!("[codetether:desktop] update installation failed: {error}");
                remove_success_marker(app);
                let restore_app = app.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    crate::host_supervisor::restore_host_after_update_failure(&restore_app)
                })
                .await;
                Ok(self.install_failed(app, package))
            }
            Err(error) => {
                eprintln!("[codetether:desktop] update installation worker failed: {error}");
                remove_success_marker(app);
                let restore_app = app.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    crate::host_supervisor::restore_host_after_update_failure(&restore_app)
                })
                .await;
                // A failed worker cannot return its package for a safe retry.
                let mut inner = lock(&self.0);
                inner.snapshot.status = UpdateStatus::DownloadFailed;
                inner.snapshot.progress_percent = None;
                drop(inner);
                Ok(self.emit(app))
            }
        }
    }

    fn install_failed(&self, app: &AppHandle, package: Vec<u8>) -> UpdateSnapshot {
        let mut inner = lock(&self.0);
        inner.package = Some(package);
        inner.snapshot.status = UpdateStatus::InstallFailed;
        drop(inner);
        self.emit(app)
    }
}

pub(crate) fn install_plugin(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    match compiled_configuration() {
        Some((_, pubkey)) => {
            builder.plugin(tauri_plugin_updater::Builder::new().pubkey(pubkey).build())
        }
        None => builder,
    }
}

pub(crate) fn initialize(app: &AppHandle) {
    app.manage(DesktopUpdate::new(app));
    if compiled_configuration().is_none() {
        return;
    }
    let check_app = app.clone();
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let state = check_app.state::<DesktopUpdate>().inner().clone();
            tauri::async_runtime::block_on(state.check(&check_app));
            thread::sleep(CHECK_INTERVAL);
        }
    });
}

pub(crate) fn finish_successful_startup(app: &AppHandle) {
    if app
        .try_state::<DesktopUpdate>()
        .is_some_and(|state| state.snapshot().updated_to.is_some())
    {
        remove_success_marker(app);
    }
}

#[tauri::command]
pub(crate) fn update_state(state: tauri::State<'_, DesktopUpdate>) -> UpdateSnapshot {
    state.snapshot()
}

#[tauri::command]
pub(crate) async fn update_check(
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdate>,
) -> Result<UpdateSnapshot, String> {
    Ok(state.inner().clone().check(&app).await)
}

#[tauri::command]
pub(crate) async fn update_download(
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdate>,
    channel: Channel<UpdateProgress>,
) -> Result<UpdateSnapshot, String> {
    state.inner().clone().download(&app, channel).await
}

#[tauri::command]
pub(crate) async fn update_install(
    app: AppHandle,
    state: tauri::State<'_, DesktopUpdate>,
) -> Result<UpdateSnapshot, String> {
    state.inner().clone().install(&app).await
}

fn compiled_configuration() -> Option<(Url, &'static str)> {
    if !cfg!(any(windows, target_os = "macos")) {
        return None;
    }
    let base = option_env!("CODETETHER_UPDATE_BASE_URL")?.trim();
    let pubkey = option_env!("CODETETHER_UPDATE_PUBKEY")?.trim();
    if pubkey.is_empty() {
        return None;
    }
    let endpoint = checked_endpoint(base, cfg!(debug_assertions))?;
    Some((endpoint, pubkey))
}

fn checked_endpoint(base: &str, debug: bool) -> Option<Url> {
    let parsed = Url::parse(base).ok()?;
    if parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let allowed_scheme = parsed.scheme() == "https"
        || (debug
            && parsed.scheme() == "http"
            && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")));
    if !allowed_scheme {
        return None;
    }
    Url::parse(&format!("{}/alpha/latest.json", base.trim_end_matches('/'))).ok()
}

fn allowed_download_url(endpoint: &Url, download_url: &Url, version: &str) -> bool {
    if download_url.origin() != endpoint.origin()
        || download_url.query().is_some()
        || download_url.fragment().is_some()
    {
        return false;
    }
    let Some(alpha_path) = endpoint.path().strip_suffix("latest.json") else {
        return false;
    };
    let expected_prefix = format!("{alpha_path}{version}/");
    download_url.path().starts_with(&expected_prefix)
}

fn truncate_notes(notes: &str) -> String {
    notes.chars().take(MAX_NOTES_CHARS).collect()
}

fn is_signature_failure(error: &UpdaterError) -> bool {
    matches!(
        error,
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_)
    )
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn marker_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(SUCCESS_MARKER))
}

fn read_success_marker(app: &AppHandle) -> Option<String> {
    let path = marker_path(app)?;
    let saved = fs::read_to_string(&path).ok()?.trim().to_owned();
    if saved == env!("CARGO_PKG_VERSION") {
        Some(saved)
    } else {
        let _ = fs::remove_file(path);
        None
    }
}

fn write_success_marker(app: &AppHandle, version: &str) -> std::io::Result<()> {
    let path = marker_path(app)
        .ok_or_else(|| std::io::Error::other("update marker directory unavailable"))?;
    fs::create_dir_all(path.parent().expect("marker has parent"))?;
    fs::write(path, version.as_bytes())
}

fn remove_success_marker(app: &AppHandle) {
    if let Some(path) = marker_path(app) {
        let _ = fs::remove_file(path);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::{MAX_NOTES_CHARS, allowed_download_url, checked_endpoint, truncate_notes};
    use tauri::Url;

    #[test]
    fn update_endpoint_is_fixed_and_release_rejects_http() {
        let endpoint = checked_endpoint("https://codetether.org/updates/", false).unwrap();
        assert_eq!(
            endpoint.as_str(),
            "https://codetether.org/updates/alpha/latest.json"
        );
        assert!(checked_endpoint("http://codetether.org/updates", false).is_none());
        assert!(checked_endpoint("http://codetether.org/updates", true).is_none());
        assert!(checked_endpoint("http://127.0.0.1:9000/updates", true).is_some());
        assert!(checked_endpoint("https://user:pass@codetether.org/updates", false).is_none());
        assert!(checked_endpoint("https://codetether.org/updates?redirect=x", false).is_none());
    }

    #[test]
    fn update_notes_are_bounded_by_characters() {
        let notes = "中".repeat(MAX_NOTES_CHARS + 20);
        assert_eq!(truncate_notes(&notes).chars().count(), MAX_NOTES_CHARS);
    }

    #[test]
    fn update_package_must_be_at_the_configured_version_path() {
        let endpoint = checked_endpoint("https://codetether.org/updates", false).unwrap();
        let valid = Url::parse("https://codetether.org/updates/alpha/0.1.0-alpha.4/CodeTether.exe")
            .unwrap();
        let wrong_host =
            Url::parse("https://other.example/updates/alpha/0.1.0-alpha.4/CodeTether.exe").unwrap();
        let wrong_version =
            Url::parse("https://codetether.org/updates/alpha/0.1.0-alpha.5/CodeTether.exe")
                .unwrap();
        assert!(allowed_download_url(&endpoint, &valid, "0.1.0-alpha.4"));
        assert!(!allowed_download_url(
            &endpoint,
            &wrong_host,
            "0.1.0-alpha.4"
        ));
        assert!(!allowed_download_url(
            &endpoint,
            &wrong_version,
            "0.1.0-alpha.4"
        ));
    }
}
