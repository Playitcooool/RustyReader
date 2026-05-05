use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};

use app_core::service::{Collection, LibraryService, ReaderView};
mod ai_stream;
mod commands;
mod export;
mod menu;
mod ocr;
mod pdf_engine;
mod state;

use ai_stream::emit_ai_task_stream;
#[cfg(test)]
use ai_stream::split_markdown_chunks;
use pdf_engine::PdfEngineCache;
use serde::Deserialize;
use state::{root_dir, service, AppState};
use tauri::{AppHandle, Manager, State};
#[derive(Deserialize)]
struct CreateCollectionInput {
    name: String,
    parent_id: Option<i64>,
}

#[derive(Deserialize)]
struct MoveCollectionInput {
    collection_id: i64,
    parent_id: Option<i64>,
}

#[derive(Deserialize)]
struct RenameCollectionInput {
    collection_id: i64,
    name: String,
}

#[derive(Deserialize)]
struct RemoveCollectionInput {
    collection_id: i64,
}

#[derive(Deserialize)]
struct RunItemTaskInput {
    item_id: i64,
    kind: String,
    prompt: Option<String>,
    stream_id: Option<String>,
}

#[derive(Deserialize)]
struct RunCollectionTaskInput {
    collection_id: i64,
    kind: String,
    scope_item_ids: Vec<i64>,
    prompt: Option<String>,
    stream_id: Option<String>,
}

#[derive(Deserialize)]
struct RunAiSessionTaskInput {
    session_id: i64,
    kind: String,
    prompt: Option<String>,
    stream_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_chunks_prefer_sentence_and_paragraph_boundaries() {
        let chunks = split_markdown_chunks(
            "# Heading\n\nSentence one. Sentence two is still compact.\n\nThis is a much longer paragraph that should remain readable while being split across multiple emitted chunks when it exceeds the maximum chunk width threshold by a clear margin. It continues with another sentence for good measure.",
        );

        assert!(chunks.len() >= 3);
        assert!(chunks[0].contains("# Heading"));
        assert!(chunks.iter().all(|chunk| !chunk.trim().is_empty()));
    }

    #[test]
    fn tauri_config_sets_a_non_empty_csp() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"]
            .as_str()
            .expect("tauri config should define csp");
        assert!(!csp.trim().is_empty());
    }
}

#[tauri::command]
fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    service(&state)
        .list_collections()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_collection(
    state: State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<Collection, String> {
    service(&state)
        .create_collection(&input.name, input.parent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn move_collection(state: State<'_, AppState>, input: MoveCollectionInput) -> Result<(), String> {
    service(&state)
        .move_collection(input.collection_id, input.parent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_collection(
    state: State<'_, AppState>,
    input: RenameCollectionInput,
) -> Result<(), String> {
    service(&state)
        .rename_collection(input.collection_id, &input.name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_collection(
    state: State<'_, AppState>,
    input: RemoveCollectionInput,
) -> Result<(), String> {
    service(&state)
        .remove_collection(input.collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_reader_view(state: State<'_, AppState>, item_id: i64) -> Result<ReaderView, String> {
    let svc = service(&state);
    let view = svc
        .get_reader_view(item_id)
        .map_err(|error| error.to_string())?;
    let repair_service = state.library_service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = repair_service.repair_item_content_if_needed(item_id);
    });
    Ok(view)
}

#[tauri::command]
fn read_primary_attachment_bytes(
    state: State<'_, AppState>,
    primary_attachment_id: i64,
) -> Result<tauri::ipc::Response, String> {
    let bytes = service(&state)
        .read_primary_attachment_bytes(primary_attachment_id)
        .map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn run_item_task(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    input: RunItemTaskInput,
) -> Result<(), String> {
    let service = state.library_service.clone();
    match input.kind.as_str() {
        "item.summarize" | "item.translate" | "item.explain_term" | "item.ask" => {
            if let Some(stream_id) = input.stream_id.as_deref() {
                emit_ai_task_stream(
                    &app_handle,
                    stream_id,
                    "paper",
                    None,
                    Some(input.item_id),
                    None,
                    None,
                    &input.kind,
                    "started",
                    None,
                    input.prompt.clone(),
                    None,
                    None,
                    None,
                );
            }
            tauri::async_runtime::spawn_blocking(move || {
                let mut streamed = String::new();
                let result = service.run_item_task_with_stream(
                    input.item_id,
                    &input.kind,
                    input.prompt.as_deref(),
                    |delta| {
                        streamed.push_str(delta);
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "paper",
                                None,
                                Some(input.item_id),
                                None,
                                None,
                                &input.kind,
                                "delta",
                                None,
                                input.prompt.clone(),
                                Some(delta.to_string()),
                                None,
                                None,
                            );
                        }
                        Ok(())
                    },
                );
                match result {
                    Ok(task) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "paper",
                                None,
                                Some(input.item_id),
                                task.collection_id,
                                None,
                                &input.kind,
                                "completed",
                                Some(task.id),
                                task.input_prompt.clone(),
                                None,
                                Some(task.output_markdown.clone()),
                                None,
                            );
                        }
                    }
                    Err(error) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "paper",
                                None,
                                Some(input.item_id),
                                None,
                                None,
                                &input.kind,
                                "failed",
                                None,
                                input.prompt.clone(),
                                None,
                                None,
                                Some(error.to_string()),
                            );
                        }
                    }
                }
            });
            Ok(())
        }
        _ => {
            if let Some(stream_id) = input.stream_id.as_deref() {
                emit_ai_task_stream(
                    &app_handle,
                    stream_id,
                    "paper",
                    None,
                    Some(input.item_id),
                    None,
                    None,
                    &input.kind,
                    "failed",
                    None,
                    input.prompt.clone(),
                    None,
                    None,
                    Some("unsupported item task".into()),
                );
            }
            Err("unsupported item task".into())
        }
    }
}

#[tauri::command]
fn run_collection_task(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    input: RunCollectionTaskInput,
) -> Result<(), String> {
    let service = state.library_service.clone();
    match input.kind.as_str() {
        "collection.review_draft"
        | "collection.bulk_summarize"
        | "collection.theme_map"
        | "collection.compare_methods"
        | "collection.ask" => {
            if let Some(stream_id) = input.stream_id.as_deref() {
                emit_ai_task_stream(
                    &app_handle,
                    stream_id,
                    "collection",
                    None,
                    None,
                    Some(input.collection_id),
                    Some(input.scope_item_ids.clone()),
                    &input.kind,
                    "started",
                    None,
                    input.prompt.clone(),
                    None,
                    None,
                    None,
                );
            }
            tauri::async_runtime::spawn_blocking(move || {
                let result = service.run_collection_task_with_stream(
                    input.collection_id,
                    &input.kind,
                    &input.scope_item_ids,
                    input.prompt.as_deref(),
                    |delta| {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "collection",
                                None,
                                None,
                                Some(input.collection_id),
                                Some(input.scope_item_ids.clone()),
                                &input.kind,
                                "delta",
                                None,
                                input.prompt.clone(),
                                Some(delta.to_string()),
                                None,
                                None,
                            );
                        }
                        Ok(())
                    },
                );
                match result {
                    Ok(task) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "collection",
                                None,
                                None,
                                Some(input.collection_id),
                                task.scope_item_ids.clone(),
                                &input.kind,
                                "completed",
                                Some(task.id),
                                task.input_prompt.clone(),
                                None,
                                Some(task.output_markdown.clone()),
                                None,
                            );
                        }
                    }
                    Err(error) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "collection",
                                None,
                                None,
                                Some(input.collection_id),
                                Some(input.scope_item_ids.clone()),
                                &input.kind,
                                "failed",
                                None,
                                input.prompt.clone(),
                                None,
                                None,
                                Some(error.to_string()),
                            );
                        }
                    }
                }
            });
            Ok(())
        }
        _ => {
            if let Some(stream_id) = input.stream_id.as_deref() {
                emit_ai_task_stream(
                    &app_handle,
                    stream_id,
                    "collection",
                    None,
                    None,
                    Some(input.collection_id),
                    Some(input.scope_item_ids.clone()),
                    &input.kind,
                    "failed",
                    None,
                    input.prompt.clone(),
                    None,
                    None,
                    Some("unsupported collection task".into()),
                );
            }
            Err("unsupported collection task".into())
        }
    }
}

#[tauri::command]
fn run_ai_session_task(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    input: RunAiSessionTaskInput,
) -> Result<(), String> {
    let service = state.library_service.clone();
    if let Some(stream_id) = input.stream_id.as_deref() {
        emit_ai_task_stream(
            &app_handle,
            stream_id,
            "session",
            Some(input.session_id),
            None,
            None,
            None,
            &input.kind,
            "started",
            None,
            input.prompt.clone(),
            None,
            None,
            None,
        );
    }
    match input.kind.as_str() {
        "session.summarize"
        | "session.explain_terms"
        | "session.theme_map"
        | "session.compare"
        | "session.review_draft"
        | "session.ask" => {
            tauri::async_runtime::spawn_blocking(move || {
                let result = service.run_ai_session_task_with_stream(
                    input.session_id,
                    &input.kind,
                    input.prompt.as_deref(),
                    |delta| {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "session",
                                Some(input.session_id),
                                None,
                                None,
                                None,
                                &input.kind,
                                "delta",
                                None,
                                input.prompt.clone(),
                                Some(delta.to_string()),
                                None,
                                None,
                            );
                        }
                        Ok(())
                    },
                );
                match result {
                    Ok(task) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "session",
                                Some(input.session_id),
                                None,
                                task.collection_id,
                                task.scope_item_ids.clone(),
                                &input.kind,
                                "completed",
                                Some(task.id),
                                task.input_prompt.clone(),
                                None,
                                Some(task.output_markdown.clone()),
                                None,
                            );
                        }
                    }
                    Err(error) => {
                        if let Some(stream_id) = input.stream_id.as_deref() {
                            emit_ai_task_stream(
                                &app_handle,
                                stream_id,
                                "session",
                                Some(input.session_id),
                                None,
                                None,
                                None,
                                &input.kind,
                                "failed",
                                None,
                                input.prompt.clone(),
                                None,
                                None,
                                Some(error.to_string()),
                            );
                        }
                    }
                }
            });
            Ok(())
        }
        _ => {
            if let Some(stream_id) = input.stream_id.as_deref() {
                emit_ai_task_stream(
                    &app_handle,
                    stream_id,
                    "session",
                    Some(input.session_id),
                    None,
                    None,
                    None,
                    &input.kind,
                    "failed",
                    None,
                    input.prompt.clone(),
                    None,
                    None,
                    Some("unsupported session task".into()),
                );
            }
            Err("unsupported session task".into())
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let library_root = root_dir(app.handle());
            fs::create_dir_all(&library_root)?;
            let library_service = Arc::new(
                LibraryService::new(&library_root)
                    .map_err(|error| tauri::Error::Anyhow(error.into()))?,
            );
            app.manage(AppState {
                library_root,
                library_service,
                pdf_cache: Arc::new(Mutex::new(PdfEngineCache::default())),
                export_authorizations: Arc::new(Mutex::new(HashMap::new())),
            });

            menu::install_menu(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_collections,
            create_collection,
            move_collection,
            rename_collection,
            remove_collection,
            commands::list_tags,
            commands::create_tag,
            commands::assign_tag,
            commands::list_items,
            commands::search_items,
            commands::import_files,
            commands::import_citations,
            commands::refresh_attachment_statuses,
            commands::relink_attachment,
            commands::update_item_metadata,
            commands::remove_item,
            commands::move_item,
            get_reader_view,
            read_primary_attachment_bytes,
            commands::create_annotation,
            commands::list_annotations,
            commands::remove_annotation,
            commands::get_ai_settings,
            commands::update_ai_settings,
            commands::translate_selection,
            commands::list_ai_sessions,
            commands::create_ai_session,
            commands::delete_ai_session,
            commands::list_ai_session_references,
            commands::add_ai_session_reference,
            commands::remove_ai_session_reference,
            run_ai_session_task,
            commands::list_ai_session_task_runs,
            commands::get_ai_session_artifact,
            commands::list_ai_session_notes,
            commands::create_ai_session_note_from_artifact,
            run_item_task,
            run_collection_task,
            commands::list_task_runs,
            commands::get_artifact,
            commands::list_notes,
            commands::create_note_from_artifact,
            commands::update_note,
            commands::export_note_markdown,
            commands::export_citation,
            export::request_export_path,
            export::write_export_file,
            ocr::ocr_pdf_page,
            pdf_engine::pdf_engine_get_document_info,
            pdf_engine::pdf_engine_get_initial_page_bundle,
            pdf_engine::pdf_engine_get_page_bundle,
            pdf_engine::pdf_engine_get_page_bundles_batch,
            pdf_engine::pdf_engine_get_page_text,
            pdf_engine::pdf_engine_get_page_texts_batch,
            pdf_engine::pdf_engine_search,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run paper-reader desktop app");
}
