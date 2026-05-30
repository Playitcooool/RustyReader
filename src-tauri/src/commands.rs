use app_core::service::{
    AIArtifact, AISession, AISessionReference, AISessionReferenceKind, AISessionScope, AISettings,
    AITask, Annotation, EvidenceChunk, EvidenceCitationTarget, EvidenceQueryOptions,
    ImportBatchResult, ImportMode, LibraryItem, LibraryQueryInput, PdfHighlightColor, ResearchNote,
    Tag, TranslateSelectionResult, TranslationProvider, UpdateAISettingsInput,
};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use tauri::State;

use crate::state::{service, AppState};

#[derive(Deserialize)]
pub(crate) struct CreateAnnotationInput {
    item_id: i64,
    anchor: String,
    kind: String,
    body: String,
}

#[derive(Deserialize)]
pub(crate) struct RemoveAnnotationInput {
    annotation_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct UpdateAnnotationInput {
    annotation_id: i64,
    anchor: String,
    body: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ColorPdfTextAnchorInput {
    anchor: String,
    color: PdfHighlightColor,
}

#[derive(Deserialize)]
pub(crate) struct NormalizePdfTextBoxAnchorInput {
    anchor: String,
}

#[derive(Deserialize)]
pub(crate) struct UpdateNoteInput {
    note_id: i64,
    markdown: String,
}

#[derive(Deserialize)]
pub(crate) struct UpdateMarkdownItemInput {
    item_id: i64,
    markdown: String,
}

#[derive(Deserialize)]
pub(crate) struct CreateResearchNoteInput {
    collection_id: Option<i64>,
    session_id: Option<i64>,
    title: String,
    markdown: String,
}

#[derive(Deserialize)]
pub(crate) struct CreateTagInput {
    name: String,
}

#[derive(Deserialize)]
pub(crate) struct AssignTagInput {
    item_id: i64,
    tag_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct SearchItemsInput {
    query: String,
}

#[derive(Deserialize)]
pub(crate) struct QueryEvidenceChunksInput {
    item_ids: Vec<i64>,
    query: Option<String>,
    limit: Option<i64>,
    scope: Option<String>,
    content_kinds: Option<Vec<String>>,
    group_by_item: Option<bool>,
    rerank: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ImportFilesInput {
    collection_id: i64,
    paths: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct ImportCitationsInput {
    collection_id: i64,
    paths: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct RelinkAttachmentInput {
    attachment_id: i64,
    replacement_path: String,
}

#[derive(Deserialize)]
pub(crate) struct UpdateItemMetadataInput {
    item_id: i64,
    title: String,
    authors: String,
    publication_year: Option<i64>,
    source: String,
    doi: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct RemoveItemInput {
    item_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct MoveItemInput {
    item_id: i64,
    collection_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct UpdateAiSettingsPayload {
    active_provider: String,
    openai_model: String,
    openai_base_url: String,
    openai_api_key: Option<String>,
    clear_openai_api_key: Option<bool>,
    provider_env_openai: Option<String>,
    anthropic_model: String,
    anthropic_base_url: String,
    anthropic_api_key: Option<String>,
    clear_anthropic_api_key: Option<bool>,
    provider_env_anthropic: Option<String>,
    translation_provider: String,
    translation_openai_model: String,
    translation_anthropic_model: String,
    translation_target_lang: String,
    deepl_base_url: String,
    deepl_api_key: Option<String>,
    clear_deepl_api_key: Option<bool>,
}

#[derive(Serialize)]
pub(crate) struct AIEnvSettingsPayload {
    text: String,
}

#[derive(Deserialize)]
pub(crate) struct TranslateSelectionInput {
    text: String,
    target_lang: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct AddAiSessionReferenceInput {
    session_id: i64,
    kind: String,
    target_id: i64,
}

#[tauri::command]
pub(crate) fn create_annotation(
    state: State<'_, AppState>,
    input: CreateAnnotationInput,
) -> Result<Annotation, String> {
    service(&state)
        .create_annotation(input.item_id, input.anchor, input.kind, input.body)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_annotations(
    state: State<'_, AppState>,
    item_id: i64,
) -> Result<Vec<Annotation>, String> {
    service(&state)
        .list_annotations(item_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn remove_annotation(
    state: State<'_, AppState>,
    input: RemoveAnnotationInput,
) -> Result<(), String> {
    service(&state)
        .remove_annotation(input.annotation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_annotation(
    state: State<'_, AppState>,
    input: UpdateAnnotationInput,
) -> Result<Annotation, String> {
    service(&state)
        .update_annotation(input.annotation_id, input.anchor, input.body)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn color_pdf_text_anchor(
    state: State<'_, AppState>,
    input: ColorPdfTextAnchorInput,
) -> Result<String, String> {
    service(&state)
        .color_pdf_text_anchor(&input.anchor, input.color)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn normalize_pdf_text_box_anchor(
    state: State<'_, AppState>,
    input: NormalizePdfTextBoxAnchorInput,
) -> Result<String, String> {
    service(&state)
        .normalize_pdf_text_box_anchor(&input.anchor)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_markdown_item(
    state: State<'_, AppState>,
    input: UpdateMarkdownItemInput,
) -> Result<app_core::service::ReaderView, String> {
    service(&state)
        .update_markdown_item(input.item_id, &input.markdown)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_tags(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
) -> Result<Vec<Tag>, String> {
    service(&state)
        .list_tags(collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_tag(state: State<'_, AppState>, input: CreateTagInput) -> Result<Tag, String> {
    service(&state)
        .create_tag(&input.name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn assign_tag(state: State<'_, AppState>, input: AssignTagInput) -> Result<(), String> {
    service(&state)
        .assign_tag(input.item_id, input.tag_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_items(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
) -> Result<Vec<LibraryItem>, String> {
    service(&state)
        .list_items(collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn query_library_items(
    state: State<'_, AppState>,
    input: LibraryQueryInput,
) -> Result<Vec<LibraryItem>, String> {
    service(&state)
        .query_library_items(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn search_items(
    state: State<'_, AppState>,
    input: SearchItemsInput,
) -> Result<Vec<LibraryItem>, String> {
    service(&state)
        .search_items(&input.query)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn import_files(
    state: State<'_, AppState>,
    input: ImportFilesInput,
) -> Result<ImportBatchResult, String> {
    let paths = input
        .paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    service(&state)
        .import_files(input.collection_id, &paths, ImportMode::ManagedCopy)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_connector_settings(
    state: State<'_, AppState>,
) -> Result<crate::connector::ConnectorRuntimeSettings, String> {
    crate::connector::runtime_settings(&service(&state), &state.connector_status)
}

#[tauri::command]
pub(crate) fn regenerate_connector_token(
    state: State<'_, AppState>,
) -> Result<crate::connector::ConnectorRuntimeSettings, String> {
    service(&state)
        .regenerate_connector_token()
        .map_err(|error| error.to_string())?;
    crate::connector::runtime_settings(&service(&state), &state.connector_status)
}

#[tauri::command]
pub(crate) fn import_citations(
    state: State<'_, AppState>,
    input: ImportCitationsInput,
) -> Result<ImportBatchResult, String> {
    let paths = input
        .paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    service(&state)
        .import_citations(input.collection_id, &paths)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn refresh_attachment_statuses(state: State<'_, AppState>) -> Result<(), String> {
    service(&state)
        .refresh_attachment_statuses()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn relink_attachment(
    state: State<'_, AppState>,
    input: RelinkAttachmentInput,
) -> Result<(), String> {
    service(&state)
        .relink_attachment(input.attachment_id, PathBuf::from(input.replacement_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_item_metadata(
    state: State<'_, AppState>,
    input: UpdateItemMetadataInput,
) -> Result<(), String> {
    service(&state)
        .update_item_metadata(
            input.item_id,
            input.title,
            input.authors,
            input.publication_year,
            input.source,
            input.doi,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn remove_item(
    state: State<'_, AppState>,
    input: RemoveItemInput,
) -> Result<(), String> {
    service(&state)
        .remove_item(input.item_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn move_item(state: State<'_, AppState>, input: MoveItemInput) -> Result<(), String> {
    service(&state)
        .move_item(input.item_id, input.collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_ai_settings(state: State<'_, AppState>) -> Result<AISettings, String> {
    service(&state)
        .get_ai_settings()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_system_ai_env() -> Result<AIEnvSettingsPayload, String> {
    let keys = [
        "AI_PROVIDER",
        "ACTIVE_PROVIDER",
        "OPENAI_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_AUTH_TOKEN",
        "OPENAI_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "DEEPL_API_KEY",
        "DEEPL_BASE_URL",
    ];
    let text = keys
        .into_iter()
        .filter_map(|key| env::var(key).ok().map(|value| format!("{key}={value}")))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(AIEnvSettingsPayload { text })
}

#[tauri::command]
pub(crate) fn update_ai_settings(
    state: State<'_, AppState>,
    input: UpdateAiSettingsPayload,
) -> Result<AISettings, String> {
    let provider_env_openai = input.provider_env_openai.clone();
    let provider_env_anthropic = input.provider_env_anthropic.clone();
    service(&state)
        .update_ai_settings(UpdateAISettingsInput {
            active_provider: match input.active_provider.as_str() {
                "openai" => app_core::service::AIProvider::OpenAI,
                "anthropic" => app_core::service::AIProvider::Anthropic,
                _ => return Err("unsupported ai provider".into()),
            },
            openai_model: input.openai_model,
            openai_base_url: input.openai_base_url,
            openai_api_key: input.openai_api_key,
            clear_openai_api_key: input.clear_openai_api_key,
            anthropic_model: input.anthropic_model,
            anthropic_base_url: input.anthropic_base_url,
            anthropic_api_key: input.anthropic_api_key,
            clear_anthropic_api_key: input.clear_anthropic_api_key,
            translation_provider: match input.translation_provider.as_str() {
                "openai" => TranslationProvider::OpenAI,
                "anthropic" => TranslationProvider::Anthropic,
                "deepl" => TranslationProvider::DeepL,
                _ => return Err("unsupported translation provider".into()),
            },
            translation_openai_model: input.translation_openai_model,
            translation_anthropic_model: input.translation_anthropic_model,
            translation_target_lang: input.translation_target_lang,
            deepl_base_url: input.deepl_base_url,
            deepl_api_key: input.deepl_api_key,
            clear_deepl_api_key: input.clear_deepl_api_key,
        })
        .and_then(|_| {
            service(&state)
                .update_ai_environment_settings(provider_env_openai, provider_env_anthropic)
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn translate_selection(
    state: State<'_, AppState>,
    input: TranslateSelectionInput,
) -> Result<TranslateSelectionResult, String> {
    service(&state)
        .translate_selection(&input.text, input.target_lang.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_ai_sessions(state: State<'_, AppState>) -> Result<Vec<AISession>, String> {
    service(&state)
        .list_ai_sessions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_ai_session(state: State<'_, AppState>) -> Result<AISession, String> {
    service(&state)
        .create_ai_session()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_ai_session(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    service(&state)
        .delete_ai_session(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_ai_session_references(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<AISessionReference>, String> {
    service(&state)
        .list_ai_session_references(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_ai_session_scope(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<AISessionScope, String> {
    service(&state)
        .get_ai_session_scope(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn add_ai_session_reference(
    state: State<'_, AppState>,
    input: AddAiSessionReferenceInput,
) -> Result<AISessionReference, String> {
    let kind = AISessionReferenceKind::parse(&input.kind).map_err(|error| error.to_string())?;
    service(&state)
        .add_ai_session_reference(input.session_id, kind, input.target_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn remove_ai_session_reference(
    state: State<'_, AppState>,
    reference_id: i64,
) -> Result<(), String> {
    service(&state)
        .remove_ai_session_reference(reference_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_ai_session_task_runs(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<AITask>, String> {
    service(&state)
        .list_ai_session_task_runs(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn query_evidence_chunks(
    state: State<'_, AppState>,
    input: QueryEvidenceChunksInput,
) -> Result<Vec<EvidenceChunk>, String> {
    service(&state)
        .query_evidence_chunks(
            &input.item_ids,
            input.query.as_deref(),
            input.limit,
            EvidenceQueryOptions {
                scope: input.scope,
                content_kinds: input.content_kinds.unwrap_or_default(),
                group_by_item: input.group_by_item.unwrap_or(false),
                rerank: input.rerank,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_evidence_chunk(
    state: State<'_, AppState>,
    evidence_id: i64,
) -> Result<Option<EvidenceChunk>, String> {
    service(&state)
        .get_evidence_chunk(evidence_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn locate_evidence_chunk(
    state: State<'_, AppState>,
    evidence_id: i64,
) -> Result<Option<EvidenceCitationTarget>, String> {
    service(&state)
        .locate_evidence_chunk(evidence_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_ai_session_artifact(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Option<AIArtifact>, String> {
    service(&state)
        .get_ai_session_artifact(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_ai_session_notes(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<ResearchNote>, String> {
    service(&state)
        .list_ai_session_notes(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_ai_session_note_from_artifact(
    state: State<'_, AppState>,
    artifact_id: i64,
) -> Result<ResearchNote, String> {
    service(&state)
        .create_note_from_artifact(artifact_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_research_note(
    state: State<'_, AppState>,
    input: CreateResearchNoteInput,
) -> Result<ResearchNote, String> {
    service(&state)
        .create_research_note(
            input.collection_id,
            input.session_id,
            &input.title,
            &input.markdown,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_task_runs(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    collection_id: Option<i64>,
) -> Result<Vec<AITask>, String> {
    service(&state)
        .list_task_runs(item_id, collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_artifact(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    collection_id: Option<i64>,
) -> Result<Option<AIArtifact>, String> {
    service(&state)
        .get_latest_artifact(item_id, collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_notes(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
) -> Result<Vec<ResearchNote>, String> {
    service(&state)
        .list_notes(collection_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn create_note_from_artifact(
    state: State<'_, AppState>,
    artifact_id: i64,
) -> Result<ResearchNote, String> {
    service(&state)
        .create_note_from_artifact(artifact_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_note(
    state: State<'_, AppState>,
    input: UpdateNoteInput,
) -> Result<(), String> {
    service(&state)
        .update_note(input.note_id, input.markdown)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn export_note_markdown(
    state: State<'_, AppState>,
    note_id: i64,
) -> Result<String, String> {
    service(&state)
        .export_note_markdown(note_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn export_citation(
    state: State<'_, AppState>,
    item_id: i64,
    format: Option<String>,
) -> Result<String, String> {
    service(&state)
        .export_citation(item_id, format.as_deref().unwrap_or("apa7"))
        .map_err(|error| error.to_string())
}
