use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

pub(crate) static EXPORT_AUTHORIZATION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
pub(crate) struct WriteExportFileInput {
    path: String,
    authorization_token: String,
    contents: String,
}

#[derive(Deserialize)]
pub(crate) struct RequestExportPathInput {
    default_path: String,
    filters: Option<Vec<DialogFilterInput>>,
}

#[derive(Deserialize)]
pub(crate) struct DialogFilterInput {
    name: String,
    extensions: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct AuthorizedExportPath {
    path: String,
    authorization_token: String,
}

#[tauri::command]
pub(crate) async fn request_export_path(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    input: RequestExportPathInput,
) -> Result<Option<AuthorizedExportPath>, String> {
    let mut dialog = app_handle.dialog().file().set_file_name(
        Path::new(&input.default_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("export.md")
            .to_string(),
    );
    if let Some(parent) = Path::new(&input.default_path).parent() {
        dialog = dialog.set_directory(parent);
    }
    if let Some(filters) = input.filters {
        for filter in filters {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
    }
    let Some(file_path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|error| error.to_string())?;
    let token = format!(
        "export-{}",
        EXPORT_AUTHORIZATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    state
        .export_authorizations
        .lock()
        .map_err(|_| "failed to lock export authorization state".to_string())?
        .insert(token.clone(), path.clone());
    Ok(Some(AuthorizedExportPath {
        path: path.to_string_lossy().to_string(),
        authorization_token: token,
    }))
}

pub(crate) fn consume_export_authorization(
    export_authorizations: &Mutex<HashMap<String, PathBuf>>,
    token: &str,
    requested_path: &Path,
) -> Result<(), String> {
    let mut authorized_paths = export_authorizations
        .lock()
        .map_err(|_| "failed to lock export authorization state".to_string())?;
    let Some(authorized_path) = authorized_paths.remove(token) else {
        return Err("export path is not authorized".into());
    };
    if authorized_path != requested_path {
        return Err("export path did not match the approved save location".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn write_export_file(
    state: State<'_, AppState>,
    input: WriteExportFileInput,
) -> Result<(), String> {
    let path = PathBuf::from(&input.path);
    consume_export_authorization(
        state.export_authorizations.as_ref(),
        &input.authorization_token,
        &path,
    )?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, input.contents).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_write_requires_matching_authorization() {
        let export_authorizations = Mutex::new(HashMap::from([(
            "token-1".to_string(),
            PathBuf::from("/tmp/export.md"),
        )]));

        assert!(consume_export_authorization(
            &export_authorizations,
            "token-1",
            Path::new("/tmp/export.md"),
        )
        .is_ok());
        assert!(consume_export_authorization(
            &export_authorizations,
            "token-1",
            Path::new("/tmp/export.md"),
        )
        .is_err());
    }

    #[test]
    fn export_write_rejects_unapproved_path() {
        let export_authorizations = Mutex::new(HashMap::from([(
            "token-1".to_string(),
            PathBuf::from("/tmp/export.md"),
        )]));

        let error = consume_export_authorization(
            &export_authorizations,
            "token-1",
            Path::new("/tmp/other.md"),
        )
        .expect_err("mismatched path should be rejected");
        assert!(error.contains("did not match"));
    }
}
