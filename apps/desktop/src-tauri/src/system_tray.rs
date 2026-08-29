use std::{
    fs::{self, OpenOptions},
    io::ErrorKind,
    path::PathBuf,
};

use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;

use crate::host_supervisor::{request_app_quit, show_main_window};

const TRAY_ID: &str = "codetether-main-tray";
const OPEN_MENU_ID: &str = "codetether-tray-open";
const QUIT_MENU_ID: &str = "codetether-tray-quit";
const BACKGROUND_EDUCATION_MARKER: &str = "background-runtime-education-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrayMenuAction {
    Show,
    Quit,
    None,
}

pub fn create(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "the configured CodeTether application icon is unavailable".to_owned())?;
    let open = MenuItem::with_id(app, OPEN_MENU_ID, "打开 CodeTether", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出 CodeTether", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu =
        Menu::with_items(app, &[&open, &separator, &quit]).map_err(|error| error.to_string())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("CodeTether")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
            TrayMenuAction::Show => {
                if let Err(error) = show_main_window(app) {
                    eprintln!(
                        "[codetether:desktop] could not restore the main window from the tray menu: {error}"
                    );
                }
            }
            TrayMenuAction::Quit => request_app_quit(app, 0),
            TrayMenuAction::None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if should_restore_from_tray_event(&event)
                && let Err(error) = show_main_window(tray.app_handle())
            {
                eprintln!(
                    "[codetether:desktop] could not restore the main window from the tray icon: {error}"
                );
            }
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn tray_menu_action(id: &str) -> TrayMenuAction {
    match id {
        OPEN_MENU_ID => TrayMenuAction::Show,
        QUIT_MENU_ID => TrayMenuAction::Quit,
        _ => TrayMenuAction::None,
    }
}

fn should_restore_from_tray_event(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

pub fn remove(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}

pub fn background_education_was_shown(app: &AppHandle) -> bool {
    background_education_marker_path(app).is_ok_and(|path| path.is_file())
}

pub fn persist_and_show_background_education(app: &AppHandle) {
    match persist_background_education_marker(app) {
        Ok(true) => {
            if let Err(error) = app
                .notification()
                .builder()
                .title("CodeTether 仍在后台运行")
                .body("任务和审批会继续运行，可从系统托盘重新打开。")
                .show()
            {
                eprintln!(
                    "[codetether:desktop] could not show the background-runtime education notification: {error}"
                );
            }
        }
        Ok(false) => {}
        Err(error) => eprintln!(
            "[codetether:desktop] could not persist the background-runtime education preference: {error}"
        ),
    }
}

fn persist_background_education_marker(app: &AppHandle) -> Result<bool, String> {
    let path = background_education_marker_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "Desktop preference path has no parent directory".to_owned())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn background_education_marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(data_directory) = std::env::var_os("CODETETHER_DATA_DIR") {
        let data_directory = PathBuf::from(data_directory);
        if data_directory.is_absolute() {
            return Ok(data_directory
                .join("desktop")
                .join(BACKGROUND_EDUCATION_MARKER));
        }
    }
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(BACKGROUND_EDUCATION_MARKER))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{PhysicalPosition, Position, Rect, Size};

    #[test]
    fn tray_surface_stays_minimal_and_product_scoped() {
        assert_ne!(OPEN_MENU_ID, QUIT_MENU_ID);
        assert!(TRAY_ID.starts_with("codetether-"));
        assert_eq!(
            BACKGROUND_EDUCATION_MARKER,
            "background-runtime-education-v1"
        );
    }

    #[test]
    fn background_education_marker_is_a_bounded_desktop_preference() {
        let data_directory = PathBuf::from(if cfg!(windows) {
            r"C:\CodeTether-test-data"
        } else {
            "/tmp/codetether-test-data"
        });
        let marker = data_directory
            .join("desktop")
            .join(BACKGROUND_EDUCATION_MARKER);
        assert!(marker.starts_with(&data_directory));
        assert_eq!(marker.file_name().unwrap(), BACKGROUND_EDUCATION_MARKER);
    }

    #[test]
    fn tray_menu_exposes_only_show_and_explicit_quit() {
        assert_eq!(tray_menu_action(OPEN_MENU_ID), TrayMenuAction::Show);
        assert_eq!(tray_menu_action(QUIT_MENU_ID), TrayMenuAction::Quit);
        assert_eq!(tray_menu_action("unknown"), TrayMenuAction::None);
    }

    #[test]
    fn only_a_completed_left_click_restores_the_window() {
        let event = |button, button_state| TrayIconEvent::Click {
            id: TRAY_ID.into(),
            position: PhysicalPosition::new(10.0, 10.0),
            rect: Rect {
                position: Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: Size::Physical(tauri::PhysicalSize::new(16, 16)),
            },
            button,
            button_state,
        };
        assert!(should_restore_from_tray_event(&event(
            MouseButton::Left,
            MouseButtonState::Up
        )));
        assert!(!should_restore_from_tray_event(&event(
            MouseButton::Left,
            MouseButtonState::Down
        )));
        assert!(!should_restore_from_tray_event(&event(
            MouseButton::Right,
            MouseButtonState::Up
        )));
    }
}
