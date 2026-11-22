//! Persist only the main window's geometry. The official window-state plugin
//! restores partly visible/undersized rectangles and serializes visibility
//! even when that flag is disabled, so this bounded record keeps startup hidden.

use std::{
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Dwm::{DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongW, GetWindowPlacement, SW_SHOWMAXIMIZED, ShowWindow, WINDOWPLACEMENT,
    WS_EX_TOOLWINDOW,
};

const MAIN_WINDOW: &str = "main";
const INSTALLED_FILENAME: &str = "window-geometry-v1.json";
const DEVELOPMENT_FILENAME: &str = "window-geometry-development-v1.json";
const DIAGNOSTIC_FILENAME: &str = "window-geometry-diagnostic-v1.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Geometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[derive(Clone, Copy, Debug)]
struct Screen {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

impl From<&Monitor> for Screen {
    fn from(monitor: &Monitor) -> Self {
        let position = monitor.position();
        let size = monitor.size();
        Self {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            scale: monitor.scale_factor(),
        }
    }
}

struct WindowGeometryState {
    path: PathBuf,
    normal: Mutex<Option<Geometry>>,
    maximize_on_first_show: AtomicBool,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(isolated) = option_env!("CODETETHER_W0F_DATA_DIR") {
        return Ok(PathBuf::from(isolated).join(DIAGNOSTIC_FILENAME));
    }
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let filename = if cfg!(debug_assertions) {
        DEVELOPMENT_FILENAME
    } else {
        INSTALLED_FILENAME
    };
    Ok(directory.join(filename))
}

fn fits_screen(
    geometry: Geometry,
    screens: &[Screen],
    minimum: (f64, f64),
    frame: (u32, u32),
) -> bool {
    screens.iter().any(|screen| {
        let scale = screen.scale;
        if !scale.is_finite() || scale <= 0.0 {
            return false;
        }
        let minimum_width = (minimum.0 * scale).ceil();
        let minimum_height = (minimum.1 * scale).ceil();
        let left = i64::from(geometry.x);
        let top = i64::from(geometry.y);
        // The saved size is Tauri's inner size, but the saved position is the
        // outer window's top-left corner. Include the native frame when
        // checking whether the restored window fits the monitor.
        let right = left + i64::from(geometry.width) + i64::from(frame.0);
        let bottom = top + i64::from(geometry.height) + i64::from(frame.1);
        let screen_left = i64::from(screen.x);
        let screen_top = i64::from(screen.y);
        geometry.width > 0
            && geometry.height > 0
            && f64::from(geometry.width) >= minimum_width
            && f64::from(geometry.height) >= minimum_height
            && left >= screen_left
            && top >= screen_top
            && right <= screen_left + i64::from(screen.width)
            && bottom <= screen_top + i64::from(screen.height)
    })
}

fn minimum_size(app: &AppHandle) -> (f64, f64) {
    app.config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW)
        .map(|config| {
            (
                config.min_width.unwrap_or(0.0),
                config.min_height.unwrap_or(0.0),
            )
        })
        .unwrap_or((0.0, 0.0))
}

fn current_geometry(window: &WebviewWindow, maximized: bool) -> Result<Geometry, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    Ok(Geometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
    })
}

fn current_frame(window: &WebviewWindow) -> Result<(u32, u32), String> {
    let outer = window.outer_size().map_err(|error| error.to_string())?;
    let inner = window.inner_size().map_err(|error| error.to_string())?;
    Ok((
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    ))
}

#[cfg(windows)]
fn workspace_position_to_screen(
    normal: windows_sys::Win32::Foundation::RECT,
    monitor: windows_sys::Win32::Graphics::Gdi::MONITORINFO,
) -> Option<(i32, i32)> {
    let x = normal
        .left
        .checked_add(monitor.rcWork.left.checked_sub(monitor.rcMonitor.left)?)?;
    let y = normal
        .top
        .checked_add(monitor.rcWork.top.checked_sub(monitor.rcMonitor.top)?)?;
    Some((x, y))
}

#[cfg(windows)]
fn set_dwm_transitions_disabled(
    hwnd: windows_sys::Win32::Foundation::HWND,
    disabled: bool,
) -> bool {
    let value = i32::from(disabled);
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED as u32,
            (&value as *const i32).cast(),
            std::mem::size_of_val(&value) as u32,
        )
    };
    result >= 0
}

#[cfg(windows)]
fn maximized_normal_geometry(window: &WebviewWindow) -> Option<Geometry> {
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    let hwnd = window.hwnd().ok()?;
    if unsafe { GetWindowPlacement(hwnd.0, &mut placement) } == 0
        || (placement.showCmd != SW_SHOWMAXIMIZED as u32 && !window.is_maximized().ok()?)
    {
        return None;
    }
    // Tauri's size APIs use the inner rectangle. WINDOWPLACEMENT holds the
    // last normal outer rectangle, including the native frame.
    let outer = window.outer_size().ok()?;
    let inner = window.inner_size().ok()?;
    let normal = placement.rcNormalPosition;
    let (x, y) = if unsafe { GetWindowLongW(hwnd.0, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW != 0 {
        (normal.left, normal.top)
    } else {
        let monitor = unsafe { MonitorFromWindow(hwnd.0, MONITOR_DEFAULTTONEAREST) };
        if monitor.is_null() {
            return None;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        workspace_position_to_screen(normal, info)?
    };
    let width = i64::from(normal.right)
        - i64::from(normal.left)
        - i64::from(outer.width.saturating_sub(inner.width));
    let height = i64::from(normal.bottom)
        - i64::from(normal.top)
        - i64::from(outer.height.saturating_sub(inner.height));
    Some(Geometry {
        x,
        y,
        width: u32::try_from(width).ok()?,
        height: u32::try_from(height).ok()?,
        maximized: true,
    })
}

/// Called while the Tauri-configured main window is still hidden.
pub(crate) fn initialize(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "the configured main window is unavailable".to_owned())?;
    let path = state_path(app)?;
    let saved = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Geometry>(&bytes).ok());
    let screens = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(Screen::from)
        .collect::<Vec<_>>();
    let frame = current_frame(&window)?;
    let accepted =
        saved.filter(|geometry| fits_screen(*geometry, &screens, minimum_size(app), frame));
    let mut restored = None;
    if let Some(geometry) = accepted {
        let restore_result = window
            .set_position(PhysicalPosition::new(geometry.x, geometry.y))
            .and_then(|_| window.set_size(PhysicalSize::new(geometry.width, geometry.height)));
        if let Err(error) = restore_result {
            eprintln!("[codetether:desktop] could not restore saved window geometry: {error}");
            // A failed native restore keeps the configured default placement.
            let _ = window.center();
        } else {
            restored = Some(geometry);
        }
    }
    let normal = restored.or_else(|| current_geometry(&window, false).ok());
    app.manage(WindowGeometryState {
        path,
        normal: Mutex::new(normal),
        // Tao's hidden-window maximize briefly reveals the window. Defer the
        // first maximized reveal until the Host-ready show.
        maximize_on_first_show: AtomicBool::new(
            restored.is_some_and(|geometry| geometry.maximized),
        ),
    });
    Ok(())
}

/// Reveal at the saved size or maximized state only after the Host is ready.
pub(crate) fn show_after_ready(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let Some(state) = app.try_state::<WindowGeometryState>() else {
        return window.show().map_err(|error| error.to_string());
    };
    if state.maximize_on_first_show.load(Ordering::Acquire) {
        let result = (|| -> Result<(), String> {
            #[cfg(windows)]
            {
                let hwnd = window.hwnd().map_err(|error| error.to_string())?;
                // One Win32 reveal makes the first visible frame maximized. Tao
                // observes WM_SIZE; show() then reconciles its visible flag. The
                // DWM transition must not expose an interpolated normal frame.
                let transitions_disabled = set_dwm_transitions_disabled(hwnd.0, true);
                if !transitions_disabled {
                    eprintln!("[codetether:desktop] could not suppress startup maximize animation");
                }
                unsafe { ShowWindow(hwnd.0, SW_SHOWMAXIMIZED) };
                let result = window.show().map_err(|error| error.to_string());
                if transitions_disabled {
                    let _ = set_dwm_transitions_disabled(hwnd.0, false);
                }
                result?;
            }
            #[cfg(not(windows))]
            {
                window.show().map_err(|error| error.to_string())?;
                if let Err(error) = window.maximize() {
                    eprintln!(
                        "[codetether:desktop] could not restore saved maximized state: {error}"
                    );
                    if let Some(geometry) = state
                        .normal
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner())
                        .as_mut()
                    {
                        geometry.maximized = false;
                    }
                }
            }
            Ok(())
        })();
        // A failed handle lookup or show must not suppress future observations.
        state.maximize_on_first_show.store(false, Ordering::Release);
        return result;
    }
    window.show().map_err(|error| error.to_string())
}

/// Keep the normal rectangle when the window is maximized or minimized.
pub(crate) fn observe(app: &AppHandle) {
    let (Some(state), Some(window)) = (
        app.try_state::<WindowGeometryState>(),
        app.get_webview_window(MAIN_WINDOW),
    ) else {
        return;
    };
    if state.maximize_on_first_show.load(Ordering::Acquire) {
        return;
    }
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    #[cfg(windows)]
    if let Some(geometry) = maximized_normal_geometry(&window) {
        *state
            .normal
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(geometry);
        return;
    }
    let maximized = match window.is_maximized() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut normal = state
        .normal
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if maximized {
        if let Some(geometry) = normal.as_mut() {
            geometry.maximized = true;
        }
    } else if let Ok(geometry) = current_geometry(&window, false) {
        *normal = Some(geometry);
    }
}

/// Explicitly flush before tray Quit or updater install, both of which can
/// terminate the process without Tauri's normal Exit callback.
pub(crate) fn save(app: &AppHandle) {
    observe(app);
    let Some(state) = app.try_state::<WindowGeometryState>() else {
        return;
    };
    let geometry = *state
        .normal
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let Some(geometry) = geometry else { return };
    let result = serde_json::to_vec(&geometry)
        .map_err(std::io::Error::other)
        .and_then(|bytes| {
            let parent = state
                .path
                .parent()
                .ok_or_else(|| std::io::Error::other("window-state path has no parent"))?;
            fs::create_dir_all(parent)?;
            fs::write(&state.path, bytes)
        });
    if let Err(error) = result {
        eprintln!("[codetether:desktop] could not save window geometry: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Screen = Screen {
        x: 0,
        y: 0,
        width: 3840,
        height: 2160,
        scale: 1.5,
    };
    const VALID: Geometry = Geometry {
        x: 304,
        y: 34,
        width: 2850,
        height: 1875,
        maximized: false,
    };
    const FRAME: (u32, u32) = (22, 56);

    #[test]
    fn last_normal_rectangle_fits_current_monitor() {
        assert!(fits_screen(VALID, &[SCREEN], (1100.0, 700.0), FRAME));
        assert!(fits_screen(
            Geometry {
                maximized: true,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
    }

    #[test]
    fn native_frame_must_also_fit_inside_the_screen() {
        assert!(!fits_screen(
            Geometry {
                x: SCREEN.width as i32 - VALID.width as i32,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
        assert!(!fits_screen(
            Geometry {
                y: SCREEN.height as i32 - VALID.height as i32,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
    }

    #[cfg(windows)]
    #[test]
    fn placement_workspace_coordinates_include_a_top_or_left_taskbar() {
        use windows_sys::Win32::Foundation::RECT;

        let normal = RECT {
            left: 80,
            top: 100,
            right: 1000,
            bottom: 800,
        };
        let monitor = MONITORINFO {
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            },
            rcWork: RECT {
                left: 40,
                top: 50,
                right: 1920,
                bottom: 1080,
            },
            ..Default::default()
        };
        assert_eq!(
            workspace_position_to_screen(normal, monitor),
            Some((120, 150))
        );
    }

    #[test]
    fn off_screen_or_removed_monitor_position_uses_default() {
        assert!(!fits_screen(
            Geometry { x: 3900, ..VALID },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
        assert!(!fits_screen(VALID, &[], (1100.0, 700.0), FRAME));
    }

    #[test]
    fn a_size_below_the_minimum_uses_default() {
        assert!(!fits_screen(
            Geometry {
                width: 1649,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
        assert!(!fits_screen(
            Geometry {
                height: 1049,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
    }

    #[test]
    fn a_window_larger_than_the_screen_uses_default() {
        assert!(!fits_screen(
            Geometry {
                width: 3841,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
        assert!(!fits_screen(
            Geometry {
                height: 2161,
                ..VALID
            },
            &[SCREEN],
            (1100.0, 700.0),
            FRAME
        ));
    }

    #[test]
    fn saved_record_contains_only_geometry() {
        assert_eq!(
            serde_json::to_string(&VALID).unwrap(),
            r#"{"x":304,"y":34,"width":2850,"height":1875,"maximized":false}"#
        );
        assert!(
            serde_json::from_str::<Geometry>(
                r#"{"x":304,"y":34,"width":2850,"height":1875,"maximized":false,"visible":true}"#
            )
            .is_err()
        );
    }

    #[test]
    fn development_and_diagnostic_files_cannot_reuse_installed_filename() {
        assert_ne!(DEVELOPMENT_FILENAME, INSTALLED_FILENAME);
        assert_ne!(DIAGNOSTIC_FILENAME, INSTALLED_FILENAME);
    }
}
