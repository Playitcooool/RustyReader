use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use app_core::service::LibraryService;
use tauri::{AppHandle, Manager};

use crate::pdf_engine::PdfEngineCache;

pub(crate) struct AppState {
    pub(crate) library_root: PathBuf,
    pub(crate) library_service: Arc<LibraryService>,
    pub(crate) pdf_cache: Arc<Mutex<PdfEngineCache>>,
    pub(crate) export_authorizations: Arc<Mutex<HashMap<String, PathBuf>>>,
}

pub(crate) fn service(state: &AppState) -> Arc<LibraryService> {
    state.library_service.clone()
}

pub(crate) fn service_for_root(library_root: &Path) -> Result<LibraryService, String> {
    LibraryService::new(library_root).map_err(|error| error.to_string())
}

pub(crate) fn root_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("paper-reader-dev"))
}
