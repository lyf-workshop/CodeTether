use tauri::WebviewWindow;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[tauri::command]
pub async fn pick_project_directory(window: WebviewWindow) -> Result<Option<String>, String> {
    let selection = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("选择项目文件夹")
        .blocking_pick_folder();

    selected_path_string(selection)
}

fn selected_path_string(selection: Option<FilePath>) -> Result<Option<String>, String> {
    selection
        .map(|path| {
            path.into_path()
                .map_err(|error| error.to_string())?
                .into_os_string()
                .into_string()
                .map_err(|_| "Selected directory path is not valid Unicode.".to_owned())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn selected_directory_preserves_unicode_and_spaces() {
        let path = PathBuf::from(r"C:\Users\lyfff\My Projects\项目测试\我的 Agent 项目");
        assert_eq!(
            selected_path_string(Some(FilePath::Path(path.clone()))),
            Ok(Some(path.into_os_string().into_string().unwrap())),
        );
    }

    #[test]
    fn cancelled_directory_selection_stays_empty() {
        assert_eq!(selected_path_string(None), Ok(None));
    }
}
