use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{BufRead, BufReader, Cursor, Read, Seek},
    mem::ManuallyDrop,
    ops::{Deref, DerefMut},
    panic,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use html_escape::encode_safe;
use lopdf::{Dictionary, Document as PdfDocument, Object};
use regex::Regex;
use reqwest::blocking::Client;
use roxmltree::Document;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ImportMode {
    ManagedCopy,
    LinkedFile,
}

impl ImportMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::ManagedCopy => "managed_copy",
            Self::LinkedFile => "linked_file",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorSettings {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedItem {
    pub id: i64,
    pub title: String,
    pub primary_attachment_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
    pub id: i64,
    pub title: String,
    pub collection_id: i64,
    pub primary_attachment_id: i64,
    pub attachment_format: String,
    pub attachment_status: String,
    pub authors: String,
    pub publication_year: Option<i64>,
    pub source: String,
    pub doi: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: i64,
    pub item_id: i64,
    pub anchor: String,
    pub kind: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceChunk {
    pub id: i64,
    pub item_id: i64,
    pub item_title: String,
    pub chunk_index: i64,
    pub page_number: Option<i64>,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub section_title: Option<String>,
    pub heading_path_json: Option<String>,
    pub content_kind: String,
    pub metadata_json: Option<String>,
    pub retrieval_weight: f64,
    pub score: Option<f64>,
    pub anchor_json: String,
    pub text: String,
    pub source_kind: String,
    pub extractor_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceCitationTarget {
    pub evidence_id: i64,
    pub item_id: i64,
    pub item_title: String,
    pub page_number: Option<i64>,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub text_prefix: String,
    pub section_title: Option<String>,
    pub content_kind: String,
    pub source_kind: String,
}

#[derive(Debug, Clone, Default)]
pub struct EvidenceQueryOptions {
    pub scope: Option<String>,
    pub content_kinds: Vec<String>,
    pub group_by_item: bool,
    pub rerank: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AITask {
    pub id: i64,
    pub item_id: Option<i64>,
    pub collection_id: Option<i64>,
    pub session_id: Option<i64>,
    pub scope_item_ids: Option<Vec<i64>>,
    pub input_prompt: Option<String>,
    pub kind: String,
    pub status: String,
    pub output_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIArtifact {
    pub id: i64,
    pub task_id: i64,
    pub item_id: Option<i64>,
    pub collection_id: Option<i64>,
    pub session_id: Option<i64>,
    pub scope_item_ids: Option<Vec<i64>>,
    pub kind: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISession {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AISessionReferenceKind {
    Item,
    Collection,
}

impl AISessionReferenceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Item => "item",
            Self::Collection => "collection",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "item" => Ok(Self::Item),
            "collection" => Ok(Self::Collection),
            _ => Err(anyhow!("unsupported session reference kind")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISessionReference {
    pub id: i64,
    pub session_id: i64,
    pub kind: AISessionReferenceKind,
    pub target_id: i64,
    pub sort_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISessionScope {
    pub session_id: i64,
    pub item_ids: Vec<i64>,
    pub has_collection_reference: bool,
    pub primary_collection_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AIProvider {
    OpenAI,
    Anthropic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TranslationProvider {
    OpenAI,
    Anthropic,
    DeepL,
}

impl TranslationProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::OpenAI => "openai",
            Self::Anthropic => "anthropic",
            Self::DeepL => "deepl",
        }
    }
}

impl AIProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::OpenAI => "openai",
            Self::Anthropic => "anthropic",
        }
    }

    fn default_base_url(self) -> &'static str {
        match self {
            Self::OpenAI => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISettings {
    pub active_provider: AIProvider,
    pub openai_model: String,
    pub openai_base_url: String,
    pub has_openai_api_key: bool,
    pub provider_env_openai: String,
    pub anthropic_model: String,
    pub anthropic_base_url: String,
    pub has_anthropic_api_key: bool,
    pub provider_env_anthropic: String,
    pub translation_provider: TranslationProvider,
    pub translation_openai_model: String,
    pub translation_anthropic_model: String,
    pub translation_target_lang: String,
    pub deepl_base_url: String,
    pub has_deepl_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAISettingsInput {
    pub active_provider: AIProvider,
    pub openai_model: String,
    pub openai_base_url: String,
    pub openai_api_key: Option<String>,
    pub clear_openai_api_key: Option<bool>,
    pub anthropic_model: String,
    pub anthropic_base_url: String,
    pub anthropic_api_key: Option<String>,
    pub clear_anthropic_api_key: Option<bool>,
    pub translation_provider: TranslationProvider,
    pub translation_openai_model: String,
    pub translation_anthropic_model: String,
    pub translation_target_lang: String,
    pub deepl_base_url: String,
    pub deepl_api_key: Option<String>,
    pub clear_deepl_api_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateSelectionResult {
    pub translated_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchNote {
    pub id: i64,
    pub collection_id: Option<i64>,
    pub session_id: Option<i64>,
    pub title: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReaderView {
    pub item_id: i64,
    pub title: String,
    pub reader_kind: String,
    pub attachment_format: String,
    pub primary_attachment_id: Option<i64>,
    pub primary_attachment_path: Option<String>,
    pub page_count: Option<i64>,
    pub content_status: String,
    pub content_notice: Option<String>,
    pub normalized_html: String,
    pub plain_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPathResult {
    pub path: String,
    pub status: String,
    pub message: String,
    pub item: Option<ImportedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBatchResult {
    pub imported: Vec<ImportedItem>,
    pub duplicates: Vec<ImportPathResult>,
    pub failed: Vec<ImportPathResult>,
    pub results: Vec<ImportPathResult>,
}

pub struct LibraryService {
    db_path: PathBuf,
    files_dir: PathBuf,
    ai_transport: Arc<dyn AiTransport>,
    connection_pool: Arc<Mutex<Vec<Connection>>>,
}

struct PendingImport {
    label: String,
    filename: String,
    source_path: PathBuf,
    bytes: std::result::Result<Vec<u8>, String>,
    mode: ImportMode,
}

struct PooledConnection {
    conn: ManuallyDrop<Connection>,
    pool: Arc<Mutex<Vec<Connection>>>,
}

const SQLITE_CONNECTION_POOL_LIMIT: usize = 8;

impl Deref for PooledConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.conn
    }
}

impl DerefMut for PooledConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.conn
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        // SAFETY: `PooledConnection` owns `conn`, and `drop` runs once.
        let conn = unsafe { ManuallyDrop::take(&mut self.conn) };
        let Ok(mut pool) = self.pool.lock() else {
            return;
        };
        if pool.len() < SQLITE_CONNECTION_POOL_LIMIT {
            pool.push(conn);
        }
    }
}

pub trait AiTransport: Send + Sync {
    fn stream_completion(
        &self,
        request: AiCompletionRequest,
        on_delta: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<String>;

    fn complete(&self, request: AiCompletionRequest) -> Result<String> {
        self.stream_completion(request, &mut |_| Ok(()))
    }
}

#[derive(Clone)]
struct HttpAiTransport {
    client: Client,
}

#[derive(Debug, Clone)]
pub struct AiCompletionRequest {
    pub provider: AIProvider,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub prompt: String,
}

#[derive(Debug, Clone)]
struct StoredAISettings {
    active_provider: AIProvider,
    openai_model: String,
    openai_base_url: String,
    openai_api_key: String,
    provider_env_openai: String,
    anthropic_model: String,
    anthropic_base_url: String,
    anthropic_api_key: String,
    provider_env_anthropic: String,
    translation_provider: TranslationProvider,
    translation_openai_model: String,
    translation_anthropic_model: String,
    translation_target_lang: String,
    deepl_base_url: String,
    deepl_api_key: String,
}

struct InferredMetadata {
    title: Option<String>,
    authors: String,
    publication_year: Option<i64>,
    source: String,
    doi: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum ProviderRequestPurpose {
    Default,
    Translation,
}

impl ProviderRequestPurpose {
    fn openai_model(self, settings: &StoredAISettings) -> &str {
        match self {
            Self::Default => settings.openai_model.trim(),
            Self::Translation => {
                let model = settings.translation_openai_model.trim();
                if model.is_empty() {
                    settings.openai_model.trim()
                } else {
                    model
                }
            }
        }
    }

    fn anthropic_model(self, settings: &StoredAISettings) -> &str {
        match self {
            Self::Default => settings.anthropic_model.trim(),
            Self::Translation => {
                let model = settings.translation_anthropic_model.trim();
                if model.is_empty() {
                    settings.anthropic_model.trim()
                } else {
                    model
                }
            }
        }
    }
}

struct ExtractedDocument {
    plain_text: String,
    normalized_html: String,
    chunks: Vec<ExtractedChunkDraft>,
    page_count: Option<i64>,
    content_status: String,
    content_notice: Option<String>,
    extractor_version: i64,
    metadata: InferredMetadata,
}

#[derive(Debug, Clone)]
struct ExtractedChunkDraft {
    page_number: Option<i64>,
    page_start: Option<i64>,
    page_end: Option<i64>,
    section_title: Option<String>,
    heading_path_json: Option<String>,
    content_kind: String,
    metadata_json: Option<String>,
    retrieval_weight: f64,
    anchor_json: String,
    text: String,
    source_kind: String,
}

#[derive(Debug, Clone)]
struct ContentBlock {
    text: String,
    heading_level: Option<usize>,
}

impl ExtractedDocument {
    fn should_index(&self) -> bool {
        !self.plain_text.trim().is_empty() && self.content_status != "unavailable"
    }
}

const EXTRACTOR_VERSION: i64 = 1;
const ITEM_TASK_TEXT_LIMIT: usize = 18_000;
const COLLECTION_ITEM_TEXT_LIMIT: usize = 4_000;
const COLLECTION_TOTAL_TEXT_LIMIT: usize = 40_000;
const EVIDENCE_QUERY_LIMIT: i64 = 16;
const EVIDENCE_CHUNK_TARGET_CHARS: usize = 1_200;
const EVIDENCE_CHUNK_MAX_CHARS: usize = 1_800;
const DEFAULT_AI_SESSION_TITLE: &str = "New Chat";
const DEEPL_TEXT_LIMIT_BYTES: usize = 128 * 1024;

impl HttpAiTransport {
    fn new() -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .context("create HTTP AI client")?;
        Ok(Self { client })
    }
}

impl AiTransport for HttpAiTransport {
    fn stream_completion(
        &self,
        request: AiCompletionRequest,
        on_delta: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<String> {
        match request.provider {
            AIProvider::OpenAI => self.complete_openai(request, on_delta),
            AIProvider::Anthropic => self.complete_anthropic(request, on_delta),
        }
    }
}

impl HttpAiTransport {
    fn complete_openai(
        &self,
        request: AiCompletionRequest,
        on_delta: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<String> {
        let url = format!("{}/chat/completions", normalize_base_url(&request.base_url));
        let response = self
            .client
            .post(url)
            .bearer_auth(request.api_key)
            .json(&serde_json::json!({
                "model": request.model,
                "messages": [{ "role": "user", "content": request.prompt }],
                "temperature": 0.2,
                "stream": true,
            }))
            .send()?
            .error_for_status()?;
        let mut full_text = String::new();
        self.stream_sse(response, |_, data| {
            if data == "[DONE]" {
                return Ok(false);
            }
            let payload: serde_json::Value = serde_json::from_str(data)?;
            if let Some(error) = payload.get("error") {
                return Err(anyhow!(
                    "{}",
                    error
                        .get("message")
                        .and_then(|value| value.as_str())
                        .unwrap_or("OpenAI streaming request failed")
                ));
            }
            let delta = payload
                .get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(extract_openai_content)
                .unwrap_or_default();
            if !delta.is_empty() {
                on_delta(&delta)?;
                full_text.push_str(&delta);
            }
            Ok(true)
        })?;
        let trimmed = full_text.trim().to_string();
        if trimmed.is_empty() {
            return Err(anyhow!("OpenAI response did not include assistant content"));
        }
        Ok(trimmed)
    }

    fn complete_anthropic(
        &self,
        request: AiCompletionRequest,
        on_delta: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<String> {
        let url = format!("{}/messages", normalize_base_url(&request.base_url));
        let response = self
            .client
            .post(url)
            .header("x-api-key", request.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": request.model,
                "max_tokens": 2048,
                "messages": [{ "role": "user", "content": request.prompt }],
                "stream": true,
            }))
            .send()?
            .error_for_status()?;
        let mut full_text = String::new();
        self.stream_sse(response, |event_name, data| {
            let payload: serde_json::Value = serde_json::from_str(data)?;
            if payload.get("type").and_then(|value| value.as_str()) == Some("error")
                || event_name == Some("error")
            {
                return Err(anyhow!(
                    "{}",
                    payload
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(|value| value.as_str())
                        .or_else(|| payload.get("message").and_then(|value| value.as_str()))
                        .unwrap_or("Anthropic streaming request failed")
                ));
            }
            if payload.get("type").and_then(|value| value.as_str()) == Some("content_block_delta") {
                if let Some(delta) = payload
                    .get("delta")
                    .and_then(|delta| delta.get("text"))
                    .and_then(|value| value.as_str())
                {
                    on_delta(delta)?;
                    full_text.push_str(delta);
                }
            }
            Ok(payload.get("type").and_then(|value| value.as_str()) != Some("message_stop"))
        })?;
        let trimmed = full_text.trim().to_string();
        if trimmed.is_empty() {
            return Err(anyhow!("Anthropic response did not include text content"));
        }
        Ok(trimmed)
    }

    fn stream_sse(
        &self,
        response: reqwest::blocking::Response,
        mut on_event: impl FnMut(Option<&str>, &str) -> Result<bool>,
    ) -> Result<()> {
        let mut reader = BufReader::new(response);
        let mut line = String::new();
        let mut event_name: Option<String> = None;
        let mut data_lines: Vec<String> = Vec::new();

        loop {
            line.clear();
            if reader.read_line(&mut line)? == 0 {
                if !data_lines.is_empty() {
                    let data = data_lines.join("\n");
                    if !on_event(event_name.as_deref(), &data)? {
                        return Ok(());
                    }
                }
                return Ok(());
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                if data_lines.is_empty() {
                    event_name = None;
                    continue;
                }
                let data = data_lines.join("\n");
                data_lines.clear();
                let should_continue = on_event(event_name.as_deref(), &data)?;
                event_name = None;
                if !should_continue {
                    return Ok(());
                }
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("event:") {
                event_name = Some(rest.trim_start().to_string());
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("data:") {
                data_lines.push(rest.trim_start().to_string());
            }
        }
    }
}

impl LibraryService {
    pub fn new(root: &Path) -> Result<Self> {
        Self::new_with_transport(root, Arc::new(HttpAiTransport::new()?))
    }

    pub fn new_with_transport(root: &Path, ai_transport: Arc<dyn AiTransport>) -> Result<Self> {
        Self::new_with_dependencies(root, ai_transport)
    }

    fn new_with_dependencies(root: &Path, ai_transport: Arc<dyn AiTransport>) -> Result<Self> {
        fs::create_dir_all(root)?;
        let files_dir = root.join("library-files");
        fs::create_dir_all(&files_dir)?;
        let db_path = root.join("library.db");
        let service = Self {
            db_path,
            files_dir,
            ai_transport,
            connection_pool: Arc::new(Mutex::new(Vec::new())),
        };
        service.migrate()?;
        service.apply_saved_ai_environment()?;
        Ok(service)
    }

    pub fn create_collection(&self, name: &str, parent_id: Option<i64>) -> Result<Collection> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO collections(name, parent_id) VALUES (?1, ?2)",
            params![name, parent_id],
        )?;
        Ok(Collection {
            id: conn.last_insert_rowid(),
            name: name.to_owned(),
            parent_id,
        })
    }

    pub fn rename_collection(&self, collection_id: i64, name: &str) -> Result<()> {
        let conn = self.connect()?;
        let updated = conn.execute(
            "UPDATE collections SET name = ?1 WHERE id = ?2",
            params![name, collection_id],
        )?;
        if updated == 0 {
            return Err(anyhow!("collection does not exist"));
        }
        Ok(())
    }

    pub fn remove_collection(&self, collection_id: i64) -> Result<()> {
        let mut conn = self.connect()?;
        let collection_ids = collection_subtree_ids_conn(&conn, collection_id)?;
        if collection_ids.is_empty() {
            return Err(anyhow!("collection does not exist"));
        }
        let item_ids = item_ids_for_collection_ids_conn(&conn, &collection_ids)?;
        let managed_paths = managed_attachment_paths_for_item_ids_conn(&conn, &item_ids)?;
        let tx = conn.transaction()?;
        let mut affected_session_ids = session_reference_session_ids_for_targets(
            &tx,
            AISessionReferenceKind::Collection.as_str(),
            &collection_ids,
        )?;
        affected_session_ids.extend(session_reference_session_ids_for_targets(
            &tx,
            AISessionReferenceKind::Item.as_str(),
            &item_ids,
        )?);
        affected_session_ids.sort_unstable();
        affected_session_ids.dedup();

        delete_session_references_for_targets(
            &tx,
            AISessionReferenceKind::Collection.as_str(),
            &collection_ids,
        )?;
        delete_session_references_for_targets(
            &tx,
            AISessionReferenceKind::Item.as_str(),
            &item_ids,
        )?;
        delete_by_column_in_clause(&tx, "research_notes", "collection_id", &collection_ids)?;
        delete_by_either_column_in_clause(
            &tx,
            "ai_artifacts",
            "item_id",
            &item_ids,
            "collection_id",
            &collection_ids,
        )?;
        delete_by_either_column_in_clause(
            &tx,
            "ai_tasks",
            "item_id",
            &item_ids,
            "collection_id",
            &collection_ids,
        )?;
        delete_by_column_in_clause(&tx, "search_index", "item_id", &item_ids)?;
        prune_scope_item_ids_for_removed_items(&tx, &item_ids)?;
        delete_by_column_in_clause(&tx, "items", "id", &item_ids)?;
        delete_by_column_in_clause(&tx, "collections", "id", &collection_ids)?;
        for session_id in affected_session_ids {
            normalize_session_reference_sort_indexes_conn(&tx, session_id)?;
        }
        tx.commit()?;

        for path in managed_paths {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    pub fn move_collection(&self, collection_id: i64, parent_id: Option<i64>) -> Result<()> {
        if parent_id == Some(collection_id) {
            return Err(anyhow!("a collection cannot be moved into itself"));
        }

        let conn = self.connect()?;
        let exists = conn
            .query_row(
                "SELECT id FROM collections WHERE id = ?1",
                [collection_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(anyhow!("collection does not exist"));
        }

        if let Some(parent_id) = parent_id {
            let parent_exists = conn
                .query_row(
                    "SELECT id FROM collections WHERE id = ?1",
                    [parent_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            if parent_exists.is_none() {
                return Err(anyhow!("parent collection does not exist"));
            }

            let mut current_parent = Some(parent_id);
            while let Some(current_id) = current_parent {
                if current_id == collection_id {
                    return Err(anyhow!(
                        "a collection cannot be moved into one of its descendants"
                    ));
                }
                current_parent = conn
                    .query_row(
                        "SELECT parent_id FROM collections WHERE id = ?1",
                        [current_id],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .optional()?
                    .flatten();
            }
        }

        conn.execute(
            "UPDATE collections SET parent_id = ?1 WHERE id = ?2",
            params![parent_id, collection_id],
        )?;
        Ok(())
    }

    pub fn list_collections(&self) -> Result<Vec<Collection>> {
        let conn = self.connect()?;
        let mut statement =
            conn.prepare("SELECT id, name, parent_id FROM collections ORDER BY name ASC")?;
        let rows = statement.query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn collection_exists(&self, collection_id: i64) -> Result<bool> {
        let conn = self.connect()?;
        let exists = conn
            .query_row(
                "SELECT id FROM collections WHERE id = ?1",
                [collection_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        Ok(exists)
    }

    pub fn list_tags(&self, collection_id: Option<i64>) -> Result<Vec<Tag>> {
        let conn = self.connect()?;
        let query = if collection_id.is_some() {
            "
            SELECT t.id, t.name, COUNT(DISTINCT it.item_id) AS item_count
            FROM tags t
            JOIN item_tags it ON it.tag_id = t.id
            JOIN items i ON i.id = it.item_id
            WHERE i.collection_id = ?1
            GROUP BY t.id, t.name
            ORDER BY t.name ASC
            "
        } else {
            "
            SELECT t.id, t.name, COUNT(DISTINCT it.item_id) AS item_count
            FROM tags t
            LEFT JOIN item_tags it ON it.tag_id = t.id
            GROUP BY t.id, t.name
            ORDER BY t.name ASC
            "
        };

        let mut statement = conn.prepare(query)?;
        if let Some(collection_id) = collection_id {
            let rows = statement.query_map([collection_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    item_count: row.get(2)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(Into::into)
        } else {
            let rows = statement.query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    item_count: row.get(2)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(Into::into)
        }
    }

    pub fn create_tag(&self, name: &str) -> Result<Tag> {
        let conn = self.connect()?;
        let existing = conn
            .query_row(
                "SELECT id, name FROM tags WHERE lower(name) = lower(?1)",
                [name],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((id, existing_name)) = existing {
            return Ok(Tag {
                id,
                name: existing_name,
                item_count: 0,
            });
        }

        conn.execute("INSERT INTO tags(name) VALUES (?1)", [name])?;
        Ok(Tag {
            id: conn.last_insert_rowid(),
            name: name.to_owned(),
            item_count: 0,
        })
    }

    pub fn assign_tag(&self, item_id: i64, tag_id: i64) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag_id],
        )?;
        Ok(())
    }

    pub fn import_files(
        &self,
        collection_id: i64,
        paths: &[PathBuf],
        mode: ImportMode,
    ) -> Result<ImportBatchResult> {
        if !self.collection_exists(collection_id)? {
            return Err(anyhow!("collection does not exist"));
        }

        let mut inputs = Vec::new();
        for path in paths {
            let source_bytes = match fs::read(path)
                .with_context(|| format!("failed to read {}", path.display()))
            {
                Ok(bytes) => Some(bytes),
                Err(error) => {
                    inputs.push(PendingImport {
                        label: path.to_string_lossy().to_string(),
                        filename: path
                            .file_name()
                            .map(|value| value.to_string_lossy().to_string())
                            .unwrap_or_else(|| path.to_string_lossy().to_string()),
                        source_path: path.clone(),
                        bytes: Err(error.to_string()),
                        mode,
                    });
                    None
                }
            };
            if let Some(bytes) = source_bytes {
                inputs.push(PendingImport {
                    label: path.to_string_lossy().to_string(),
                    filename: path
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string_lossy().to_string()),
                    source_path: path.clone(),
                    bytes: Ok(bytes),
                    mode,
                });
            }
        }

        self.import_pending_files(collection_id, inputs)
    }

    pub fn import_file_bytes(
        &self,
        collection_id: i64,
        filename: &str,
        bytes: Vec<u8>,
        result_path: &str,
    ) -> Result<ImportBatchResult> {
        if !self.collection_exists(collection_id)? {
            return Err(anyhow!("collection does not exist"));
        }
        let filename = filename.trim();
        if filename.is_empty() {
            return Err(anyhow!("filename must not be empty"));
        }
        if bytes.is_empty() {
            return Err(anyhow!("content must not be empty"));
        }

        self.import_pending_files(
            collection_id,
            vec![PendingImport {
                label: result_path.to_owned(),
                filename: filename.to_owned(),
                source_path: PathBuf::from(filename),
                bytes: Ok(bytes),
                mode: ImportMode::ManagedCopy,
            }],
        )
    }

    fn import_pending_files(
        &self,
        collection_id: i64,
        inputs: Vec<PendingImport>,
    ) -> Result<ImportBatchResult> {
        let mut imported = Vec::new();
        let mut duplicates = Vec::new();
        let mut failed = Vec::new();
        let mut results = Vec::new();
        let mut conn = self.connect()?;

        for input in inputs {
            let path_label = input.label;
            let format = infer_attachment_format(&input.filename);
            if format == "unknown" {
                let result = ImportPathResult {
                    path: path_label,
                    status: "failed".into(),
                    message: "Unsupported attachment format.".into(),
                    item: None,
                };
                failed.push(result.clone());
                results.push(result);
                continue;
            }

            let source_bytes = match input.bytes {
                Ok(bytes) => bytes,
                Err(message) => {
                    let result = ImportPathResult {
                        path: path_label,
                        status: "failed".into(),
                        message,
                        item: None,
                    };
                    failed.push(result.clone());
                    results.push(result);
                    continue;
                }
            };
            let fingerprint = digest_bytes(&source_bytes);
            let existing = conn
                .query_row(
                    "SELECT attachments.item_id, attachments.id, items.title FROM attachments
                     JOIN items ON items.id = attachments.item_id
                     WHERE fingerprint = ?1 LIMIT 1",
                    params![fingerprint],
                    |row| {
                        Ok(ImportedItem {
                            id: row.get(0)?,
                            primary_attachment_id: row.get(1)?,
                            title: row.get(2)?,
                        })
                    },
                )
                .optional()?;

            if let Some(item) = existing {
                let result = ImportPathResult {
                    path: path_label,
                    status: "duplicate".into(),
                    message: format!("Duplicate of existing library item {}.", item.title),
                    item: Some(item),
                };
                duplicates.push(result.clone());
                results.push(result);
                continue;
            }

            let extracted = match extract_document(&input.source_path, &source_bytes, format) {
                Ok(extracted) => extracted,
                Err(error) => {
                    let result = ImportPathResult {
                        path: path_label,
                        status: "failed".into(),
                        message: error.to_string(),
                        item: None,
                    };
                    failed.push(result.clone());
                    results.push(result);
                    continue;
                }
            };
            let title = extracted.metadata.title.clone().unwrap_or_else(|| {
                Path::new(&input.filename)
                    .file_stem()
                    .map(|value| value.to_string_lossy().to_string())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Untitled".into())
            });

            let storage_path = match input.mode {
                ImportMode::ManagedCopy => {
                    let ext = Path::new(&input.filename)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("bin");
                    let target = self.files_dir.join(format!("{fingerprint}.{ext}"));
                    fs::write(&target, &source_bytes)?;
                    target
                }
                ImportMode::LinkedFile => input.source_path.clone(),
            };
            let attachment_status = if storage_path.exists() {
                "ready"
            } else {
                "missing"
            };

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO items(collection_id, title, attachment_status, authors, publication_year, source, doi)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    collection_id,
                    title,
                    attachment_status,
                    extracted.metadata.authors,
                    extracted.metadata.publication_year,
                    extracted.metadata.source,
                    extracted.metadata.doi
                ],
            )?;
            let item_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO attachments(item_id, path, import_mode, status, fingerprint, is_primary)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![
                    item_id,
                    storage_path.to_string_lossy().to_string(),
                    input.mode.as_str(),
                    attachment_status,
                    fingerprint
                ],
            )?;
            let attachment_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO extracted_content(item_id, plain_text, normalized_html, page_count, content_status, content_notice, extractor_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    item_id,
                    extracted.plain_text,
                    extracted.normalized_html,
                    extracted.page_count,
                    extracted.content_status,
                    extracted.content_notice,
                    extracted.extractor_version
                ],
            )?;
            if extracted.should_index() {
                tx.execute(
                    "INSERT INTO search_index(item_id, title, plain_text) VALUES (?1, ?2, ?3)",
                    params![item_id, title, extracted.plain_text],
                )?;
            }
            rebuild_evidence_chunks_conn(
                &tx,
                item_id,
                &title,
                &extracted.chunks,
                extracted.extractor_version,
            )?;
            tx.commit()?;

            let item = ImportedItem {
                id: item_id,
                title,
                primary_attachment_id: attachment_id,
            };
            imported.push(item.clone());
            results.push(ImportPathResult {
                path: path_label,
                status: "imported".into(),
                message: "Imported successfully.".into(),
                item: Some(item),
            });
        }

        Ok(ImportBatchResult {
            imported,
            duplicates,
            failed,
            results,
        })
    }

    pub fn import_markdown_item(
        &self,
        collection_id: i64,
        title: &str,
        markdown: &str,
        source_url: Option<&str>,
    ) -> Result<ImportBatchResult> {
        if !self.collection_exists(collection_id)? {
            return Err(anyhow!("collection does not exist"));
        }
        let title = title.trim();
        if title.is_empty() {
            return Err(anyhow!("title must not be empty"));
        }
        if markdown.trim().is_empty() {
            return Err(anyhow!("markdown must not be empty"));
        }

        let path_label = source_url.unwrap_or(title).to_string();
        let source_bytes = markdown.as_bytes();
        let fingerprint = digest_bytes(source_bytes);
        let mut conn = self.connect()?;
        let existing = conn
            .query_row(
                "SELECT attachments.item_id, attachments.id, items.title FROM attachments
                 JOIN items ON items.id = attachments.item_id
                 WHERE fingerprint = ?1 LIMIT 1",
                params![fingerprint],
                |row| {
                    Ok(ImportedItem {
                        id: row.get(0)?,
                        primary_attachment_id: row.get(1)?,
                        title: row.get(2)?,
                    })
                },
            )
            .optional()?;

        if let Some(item) = existing {
            let result = ImportPathResult {
                path: path_label,
                status: "duplicate".into(),
                message: format!("Duplicate of existing library item {}.", item.title),
                item: Some(item),
            };
            return Ok(ImportBatchResult {
                imported: vec![],
                duplicates: vec![result.clone()],
                failed: vec![],
                results: vec![result],
            });
        }

        let storage_path = self.files_dir.join(format!("{fingerprint}.md"));
        fs::write(&storage_path, source_bytes)?;
        let plain_text = markdown_to_plain_text(markdown);
        let normalized_html = markdown_to_safe_html(title, markdown);
        let source = source_url
            .and_then(source_label_from_url)
            .unwrap_or_else(|| source_url.unwrap_or("Imported Web").to_string());

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO items(collection_id, title, attachment_status, authors, publication_year, source, doi)
             VALUES (?1, ?2, 'ready', 'Imported Web', NULL, ?3, NULL)",
            params![collection_id, title, source],
        )?;
        let item_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO attachments(item_id, path, import_mode, status, fingerprint, is_primary)
             VALUES (?1, ?2, 'managed_copy', 'ready', ?3, 1)",
            params![
                item_id,
                storage_path.to_string_lossy().to_string(),
                fingerprint
            ],
        )?;
        let attachment_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO extracted_content(item_id, plain_text, normalized_html, page_count, content_status, content_notice, extractor_version)
             VALUES (?1, ?2, ?3, NULL, 'ready', NULL, ?4)",
            params![item_id, plain_text, normalized_html, EXTRACTOR_VERSION],
        )?;
        tx.execute(
            "INSERT INTO search_index(item_id, title, plain_text) VALUES (?1, ?2, ?3)",
            params![item_id, title, plain_text],
        )?;
        let chunks = build_structured_chunks(&markdown_content_blocks(markdown), "markdown");
        rebuild_evidence_chunks_conn(&tx, item_id, title, &chunks, EXTRACTOR_VERSION)?;
        tx.commit()?;

        let item = ImportedItem {
            id: item_id,
            title: title.to_string(),
            primary_attachment_id: attachment_id,
        };
        let result = ImportPathResult {
            path: path_label,
            status: "imported".into(),
            message: "Imported Markdown successfully.".into(),
            item: Some(item.clone()),
        };
        Ok(ImportBatchResult {
            imported: vec![item],
            duplicates: vec![],
            failed: vec![],
            results: vec![result],
        })
    }

    pub fn import_citations(
        &self,
        collection_id: i64,
        paths: &[PathBuf],
    ) -> Result<ImportBatchResult> {
        let mut imported = Vec::new();
        let duplicates = Vec::new();
        let failed = Vec::new();
        let mut results = Vec::new();
        let mut conn = self.connect()?;

        for path in paths {
            let title = path
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Untitled Citation".into())
                .replace('-', " ");
            let normalized_title = title
                .split_whitespace()
                .map(|chunk| {
                    let mut chars = chunk.chars();
                    match chars.next() {
                        Some(first) => {
                            format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase())
                        }
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            let metadata = infer_metadata(&normalized_title);
            let placeholder_path = path.to_string_lossy().to_string();
            let fingerprint = digest_bytes(placeholder_path.as_bytes());
            let plain_text = format!(
                "{normalized_title} was imported from a citation record and is ready for metadata-first triage."
            );
            let normalized_html = wrap_as_article(&normalized_title, &plain_text);

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO items(collection_id, title, attachment_status, authors, publication_year, source, doi)
                 VALUES (?1, ?2, 'citation_only', ?3, ?4, ?5, ?6)",
                params![
                    collection_id,
                    normalized_title,
                    metadata.authors,
                    metadata.publication_year,
                    metadata.source,
                    metadata.doi
                ],
            )?;
            let item_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO attachments(item_id, path, import_mode, status, fingerprint, is_primary)
                 VALUES (?1, ?2, 'linked_file', 'citation_only', ?3, 1)",
                params![item_id, placeholder_path, fingerprint],
            )?;
            let attachment_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO extracted_content(item_id, plain_text, normalized_html, page_count, content_status, content_notice, extractor_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    item_id,
                    plain_text,
                    normalized_html,
                    Option::<i64>::None,
                    "partial",
                    Some("Citation-only entry. Attach a source file to enable reading.".to_string()),
                    EXTRACTOR_VERSION
                ],
            )?;
            tx.execute(
                "INSERT INTO search_index(item_id, title, plain_text) VALUES (?1, ?2, ?3)",
                params![item_id, normalized_title, plain_text],
            )?;
            tx.commit()?;

            imported.push(ImportedItem {
                id: item_id,
                title: normalized_title,
                primary_attachment_id: attachment_id,
            });
            results.push(ImportPathResult {
                path: path.to_string_lossy().to_string(),
                status: "imported".into(),
                message: "Citation imported successfully.".into(),
                item: imported.last().cloned(),
            });
        }

        Ok(ImportBatchResult {
            imported,
            duplicates,
            failed,
            results,
        })
    }

    pub fn list_items(&self, collection_id: Option<i64>) -> Result<Vec<LibraryItem>> {
        let conn = self.connect()?;
        let mut query = "
            SELECT i.id, i.title, i.collection_id, a.id, a.path, a.status, i.authors, i.publication_year, i.source, i.doi
            FROM items i
            JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
        "
        .to_owned();

        if collection_id.is_some() {
            query.push_str(" WHERE i.collection_id = ?1");
        }
        query.push_str(" ORDER BY i.id DESC");

        let mut statement = conn.prepare(&query)?;
        let rows = if let Some(collection_id) = collection_id {
            statement.query_map(params![collection_id], map_library_item)?
        } else {
            statement.query_map([], map_library_item)?
        };
        let base_items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        hydrate_item_tags(&conn, base_items)
    }

    pub fn update_item_metadata(
        &self,
        item_id: i64,
        title: String,
        authors: String,
        publication_year: Option<i64>,
        source: String,
        doi: Option<String>,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "
            UPDATE items
            SET title = ?1, authors = ?2, publication_year = ?3, source = ?4, doi = ?5
            WHERE id = ?6
            ",
            params![title, authors, publication_year, source, doi, item_id],
        )?;
        conn.execute(
            "UPDATE search_index SET title = ?1 WHERE item_id = ?2",
            params![title, item_id],
        )?;
        conn.execute(
            "UPDATE evidence_chunk_index SET title = ?1 WHERE item_id = ?2",
            params![title, item_id],
        )?;
        Ok(())
    }

    pub fn remove_item(&self, item_id: i64) -> Result<()> {
        let mut conn = self.connect()?;
        let attachments = {
            let mut statement = conn.prepare(
                "SELECT path, import_mode FROM attachments WHERE item_id = ?1 ORDER BY id ASC",
            )?;
            let rows = statement.query_map([item_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        if attachments.is_empty() {
            return Err(anyhow!("item does not exist"));
        }

        let tx = conn.transaction()?;
        let affected_session_ids = session_reference_session_ids_for_target(
            &tx,
            AISessionReferenceKind::Item.as_str(),
            item_id,
        )?;
        tx.execute("DELETE FROM ai_artifacts WHERE item_id = ?1", [item_id])?;
        tx.execute("DELETE FROM ai_tasks WHERE item_id = ?1", [item_id])?;
        tx.execute(
            "DELETE FROM ai_session_references WHERE kind = ?1 AND target_id = ?2",
            params![AISessionReferenceKind::Item.as_str(), item_id],
        )?;
        for session_id in affected_session_ids {
            normalize_session_reference_sort_indexes_conn(&tx, session_id)?;
        }
        tx.execute("DELETE FROM search_index WHERE item_id = ?1", [item_id])?;
        tx.execute(
            "DELETE FROM evidence_chunk_index WHERE item_id = ?1",
            [item_id],
        )?;
        tx.execute("DELETE FROM evidence_chunks WHERE item_id = ?1", [item_id])?;
        prune_scope_item_ids_for_removed_items(&tx, &[item_id])?;
        tx.execute("DELETE FROM items WHERE id = ?1", [item_id])?;
        tx.commit()?;

        for (path, import_mode) in attachments {
            if import_mode == ImportMode::ManagedCopy.as_str() {
                match fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }

        Ok(())
    }

    pub fn move_item(&self, item_id: i64, collection_id: i64) -> Result<()> {
        let conn = self.connect()?;
        let item_exists = conn
            .query_row("SELECT id FROM items WHERE id = ?1", [item_id], |row| {
                row.get::<_, i64>(0)
            })
            .optional()?;
        if item_exists.is_none() {
            return Err(anyhow!("item does not exist"));
        }

        let collection_exists = conn
            .query_row(
                "SELECT id FROM collections WHERE id = ?1",
                [collection_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if collection_exists.is_none() {
            return Err(anyhow!("collection does not exist"));
        }

        conn.execute(
            "UPDATE items SET collection_id = ?1 WHERE id = ?2",
            params![collection_id, item_id],
        )?;
        conn.execute(
            "UPDATE ai_tasks SET collection_id = ?1 WHERE item_id = ?2",
            params![collection_id, item_id],
        )?;
        conn.execute(
            "UPDATE ai_artifacts SET collection_id = ?1 WHERE item_id = ?2",
            params![collection_id, item_id],
        )?;
        Ok(())
    }

    pub fn search_items(&self, query: &str) -> Result<Vec<LibraryItem>> {
        let conn = self.connect()?;
        let like_query = format!("%{}%", query.to_lowercase());
        let mut statement = conn.prepare(
            "
            SELECT DISTINCT i.id, i.title, i.collection_id, a.id, a.path, a.status, i.authors, i.publication_year, i.source, i.doi
            FROM items i
            JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
            LEFT JOIN search_index s ON s.item_id = i.id
            LEFT JOIN item_tags it ON it.item_id = i.id
            LEFT JOIN tags t ON t.id = it.tag_id
            WHERE lower(COALESCE(s.title, '')) LIKE ?1
               OR lower(COALESCE(s.plain_text, '')) LIKE ?1
               OR lower(i.authors) LIKE ?1
               OR lower(i.source) LIKE ?1
               OR lower(COALESCE(i.doi, '')) LIKE ?1
               OR COALESCE(CAST(i.publication_year AS TEXT), '') LIKE ?1
               OR lower(t.name) LIKE ?1
            ORDER BY i.id DESC
            ",
        )?;
        let rows = statement.query_map([like_query], map_library_item)?;
        let base_items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        hydrate_item_tags(&conn, base_items)
    }

    pub fn create_annotation(
        &self,
        item_id: i64,
        anchor: String,
        kind: String,
        body: String,
    ) -> Result<Annotation> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO annotations(item_id, anchor, kind, body) VALUES (?1, ?2, ?3, ?4)",
            params![item_id, anchor, kind, body],
        )?;

        Ok(Annotation {
            id: conn.last_insert_rowid(),
            item_id,
            anchor,
            kind,
            body,
        })
    }

    pub fn list_annotations(&self, item_id: i64) -> Result<Vec<Annotation>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, item_id, anchor, kind, body FROM annotations WHERE item_id = ?1 ORDER BY id ASC",
        )?;
        let rows = statement.query_map([item_id], |row| {
            Ok(Annotation {
                id: row.get(0)?,
                item_id: row.get(1)?,
                anchor: row.get(2)?,
                kind: row.get(3)?,
                body: row.get(4)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn query_evidence_chunks(
        &self,
        item_ids: &[i64],
        query: Option<&str>,
        limit: Option<i64>,
        options: EvidenceQueryOptions,
    ) -> Result<Vec<EvidenceChunk>> {
        let conn = self.connect()?;
        query_evidence_chunks_conn(
            &conn,
            item_ids,
            query,
            limit.unwrap_or(EVIDENCE_QUERY_LIMIT),
            &options,
        )
    }

    pub fn get_evidence_chunk(&self, evidence_id: i64) -> Result<Option<EvidenceChunk>> {
        let conn = self.connect()?;
        conn.query_row(
            "
            SELECT c.id, c.item_id, i.title, c.chunk_index, c.page_number, c.page_start, c.page_end,
                   c.section_title, c.heading_path_json, c.content_kind, c.metadata_json, c.retrieval_weight,
                   NULL, c.anchor_json, c.text, c.source_kind, c.extractor_version
            FROM evidence_chunks c
            JOIN items i ON i.id = c.item_id
            WHERE c.id = ?1
            ",
            [evidence_id],
            map_evidence_chunk,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn locate_evidence_chunk(
        &self,
        evidence_id: i64,
    ) -> Result<Option<EvidenceCitationTarget>> {
        let chunk = match self.get_evidence_chunk(evidence_id)? {
            Some(chunk) => chunk,
            None => return Ok(None),
        };
        Ok(Some(EvidenceCitationTarget {
            evidence_id: chunk.id,
            item_id: chunk.item_id,
            item_title: chunk.item_title,
            page_number: chunk.page_start.or(chunk.page_number),
            page_start: chunk.page_start.or(chunk.page_number),
            page_end: chunk.page_end.or(chunk.page_start).or(chunk.page_number),
            text_prefix: evidence_text_prefix(&chunk.anchor_json, &chunk.text),
            section_title: chunk.section_title,
            content_kind: chunk.content_kind,
            source_kind: chunk.source_kind,
        }))
    }

    pub fn remove_annotation(&self, annotation_id: i64) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM annotations WHERE id = ?1", [annotation_id])?;
        Ok(())
    }

    pub fn update_annotation(
        &self,
        annotation_id: i64,
        anchor: String,
        body: Option<String>,
    ) -> Result<Annotation> {
        let conn = self.connect()?;
        let existing = conn
            .query_row(
                "SELECT id, item_id, anchor, kind, body FROM annotations WHERE id = ?1",
                [annotation_id],
                |row| {
                    Ok(Annotation {
                        id: row.get(0)?,
                        item_id: row.get(1)?,
                        anchor: row.get(2)?,
                        kind: row.get(3)?,
                        body: row.get(4)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| anyhow!("annotation does not exist"))?;
        let next_body = body.unwrap_or(existing.body);
        conn.execute(
            "UPDATE annotations SET anchor = ?1, body = ?2 WHERE id = ?3",
            params![anchor, next_body, annotation_id],
        )?;
        Ok(Annotation {
            anchor,
            body: next_body,
            ..existing
        })
    }

    pub fn get_ai_settings(&self) -> Result<AISettings> {
        let conn = self.connect()?;
        let stored = self.load_ai_settings(&conn)?;
        Ok(to_public_ai_settings(&stored))
    }

    pub fn update_ai_settings(&self, input: UpdateAISettingsInput) -> Result<AISettings> {
        let conn = self.connect()?;
        let current = self.load_ai_settings(&conn)?;
        let next = StoredAISettings {
            active_provider: input.active_provider,
            openai_model: input.openai_model.trim().to_string(),
            openai_base_url: input.openai_base_url.trim().to_string(),
            openai_api_key: if input.clear_openai_api_key.unwrap_or(false) {
                String::new()
            } else if let Some(key) = input
                .openai_api_key
                .filter(|value| !value.trim().is_empty())
            {
                key
            } else {
                current.openai_api_key
            },
            anthropic_model: input.anthropic_model.trim().to_string(),
            anthropic_base_url: input.anthropic_base_url.trim().to_string(),
            anthropic_api_key: if input.clear_anthropic_api_key.unwrap_or(false) {
                String::new()
            } else if let Some(key) = input
                .anthropic_api_key
                .filter(|value| !value.trim().is_empty())
            {
                key
            } else {
                current.anthropic_api_key
            },
            provider_env_openai: current.provider_env_openai,
            provider_env_anthropic: current.provider_env_anthropic,
            translation_provider: input.translation_provider,
            translation_openai_model: input.translation_openai_model.trim().to_string(),
            translation_anthropic_model: input.translation_anthropic_model.trim().to_string(),
            translation_target_lang: input.translation_target_lang.trim().to_string(),
            deepl_base_url: input.deepl_base_url.trim().to_string(),
            deepl_api_key: if input.clear_deepl_api_key.unwrap_or(false) {
                String::new()
            } else if let Some(key) = input.deepl_api_key.filter(|value| !value.trim().is_empty()) {
                key
            } else {
                current.deepl_api_key
            },
        };
        self.save_ai_settings(&conn, &next)?;
        apply_ai_environment(&next);
        Ok(to_public_ai_settings(&next))
    }

    pub fn update_ai_environment_settings(
        &self,
        provider_env_openai: Option<String>,
        provider_env_anthropic: Option<String>,
    ) -> Result<AISettings> {
        let conn = self.connect()?;
        let current = self.load_ai_settings(&conn)?;
        let next = StoredAISettings {
            provider_env_openai: provider_env_openai.unwrap_or(current.provider_env_openai),
            provider_env_anthropic: provider_env_anthropic
                .unwrap_or(current.provider_env_anthropic),
            ..current
        };
        self.save_ai_settings(&conn, &next)?;
        apply_ai_environment(&next);
        Ok(to_public_ai_settings(&next))
    }

    pub fn translate_selection(
        &self,
        text: &str,
        target_lang: Option<&str>,
    ) -> Result<TranslateSelectionResult> {
        let selection = text.trim();
        if selection.is_empty() {
            return Err(anyhow!("Select text before translating."));
        }
        if selection.len() > DEEPL_TEXT_LIMIT_BYTES {
            return Err(anyhow!(
                "Selection is too long to translate. Keep it under 128 KiB."
            ));
        }
        let conn = self.connect()?;
        let settings = self.load_ai_settings(&conn)?;
        let target = target_lang
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                let stored = settings.translation_target_lang.trim();
                if stored.is_empty() {
                    "ZH-HANS"
                } else {
                    stored
                }
            });
        let translated_text = match settings.translation_provider {
            TranslationProvider::OpenAI | TranslationProvider::Anthropic => {
                let provider = match settings.translation_provider {
                    TranslationProvider::OpenAI => AIProvider::OpenAI,
                    TranslationProvider::Anthropic => AIProvider::Anthropic,
                    TranslationProvider::DeepL => unreachable!(),
                };
                let request = self.build_specific_provider_request(
                    &settings,
                    provider,
                    translation_prompt(selection, target),
                    ProviderRequestPurpose::Translation,
                )?;
                self.ai_transport.complete(request)?
            }
            TranslationProvider::DeepL => {
                self.translate_with_deepl(&settings, selection, target)?
            }
        };
        Ok(TranslateSelectionResult { translated_text })
    }

    pub fn get_reader_view(&self, item_id: i64) -> Result<ReaderView> {
        let conn = self.connect()?;
        conn.query_row(
            "
            SELECT i.id, i.title, a.id, a.path, e.normalized_html, e.plain_text, e.page_count, e.content_status, e.content_notice
            FROM items i
            LEFT JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
            JOIN extracted_content e ON e.item_id = i.id
            WHERE i.id = ?1
            ",
            [item_id],
            |row| {
                let attachment_path: Option<String> = row.get(3)?;
                let attachment_format = attachment_path
                    .as_deref()
                    .map(infer_attachment_format)
                    .unwrap_or("unknown")
                    .to_string();
                let reader_kind = if attachment_format == "pdf" {
                    "pdf".to_string()
                } else {
                    "normalized".to_string()
                };
                Ok(ReaderView {
                    item_id: row.get(0)?,
                    title: row.get(1)?,
                    reader_kind,
                    attachment_format,
                    primary_attachment_id: row.get(2)?,
                    primary_attachment_path: attachment_path,
                    page_count: row.get(6)?,
                    content_status: row.get(7)?,
                    content_notice: row.get(8)?,
                    normalized_html: row.get(4)?,
                    plain_text: row.get(5)?,
                })
            },
        )
        .map_err(Into::into)
    }

    pub fn update_markdown_item(&self, item_id: i64, markdown: &str) -> Result<ReaderView> {
        if markdown.trim().is_empty() {
            return Err(anyhow!("markdown must not be empty"));
        }

        let mut conn = self.connect()?;
        let (title, attachment_id, attachment_path): (String, i64, String) = conn.query_row(
            "
                SELECT i.title, a.id, a.path
                FROM items i
                JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
                WHERE i.id = ?1
                ",
            [item_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let attachment_format = infer_attachment_format(&attachment_path);
        if attachment_format != "md" && attachment_format != "markdown" {
            return Err(anyhow!("only Markdown attachments can be edited"));
        }

        let fingerprint = digest_bytes(markdown.as_bytes());
        let duplicate_attachment_id = conn
            .query_row(
                "SELECT id FROM attachments WHERE fingerprint = ?1 AND id != ?2 LIMIT 1",
                params![fingerprint, attachment_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if duplicate_attachment_id.is_some() {
            return Err(anyhow!("duplicate Markdown content already exists"));
        }

        let path = Path::new(&attachment_path);
        fs::write(path, markdown.as_bytes())?;
        let plain_text = markdown_to_plain_text(markdown);
        let normalized_html = markdown_to_safe_html(&title, markdown);
        let chunks = build_structured_chunks(&markdown_content_blocks(markdown), "markdown");

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE attachments SET fingerprint = ?1, status = 'ready' WHERE id = ?2",
            params![fingerprint, attachment_id],
        )?;
        tx.execute(
            "UPDATE items SET attachment_status = 'ready' WHERE id = ?1",
            [item_id],
        )?;
        tx.execute(
            "
            UPDATE extracted_content
            SET plain_text = ?2,
                normalized_html = ?3,
                page_count = NULL,
                content_status = 'ready',
                content_notice = NULL,
                extractor_version = ?4
            WHERE item_id = ?1
            ",
            params![item_id, plain_text, normalized_html, EXTRACTOR_VERSION],
        )?;
        tx.execute("DELETE FROM search_index WHERE item_id = ?1", [item_id])?;
        tx.execute(
            "INSERT INTO search_index(item_id, title, plain_text) VALUES (?1, ?2, ?3)",
            params![item_id, title, plain_text],
        )?;
        rebuild_evidence_chunks_conn(&tx, item_id, &title, &chunks, EXTRACTOR_VERSION)?;
        tx.commit()?;

        self.get_reader_view(item_id)
    }

    pub fn repair_item_content_if_needed(&self, item_id: i64) -> Result<bool> {
        let mut conn = self.connect()?;
        let row = conn
            .query_row(
                "
                SELECT i.title, a.path, COALESCE(e.extractor_version, 0)
                FROM items i
                LEFT JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
                JOIN extracted_content e ON e.item_id = i.id
                WHERE i.id = ?1
                ",
                [item_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((item_title, attachment_path, extractor_version)) = row else {
            return Ok(false);
        };
        let Some(attachment_path) = attachment_path else {
            return Ok(false);
        };
        if infer_attachment_format(&attachment_path) != "pdf" {
            return Ok(false);
        }
        if extractor_version >= EXTRACTOR_VERSION {
            return Ok(false);
        }

        let bytes = match fs::read(Path::new(&attachment_path)) {
            Ok(bytes) => bytes,
            Err(_) => return Ok(false),
        };

        // Best-effort PDF extraction; even if content is unavailable, we still want to bump
        // extractor_version so old libraries self-heal without repeated work.
        let mut extracted = extract_pdf(Path::new(&attachment_path), &bytes)?;
        extracted.extractor_version = EXTRACTOR_VERSION;

        // Keep the item title stable (users may have edited it), but refresh the extracted HTML/text.
        let paragraphs = if extracted.plain_text.trim().is_empty() {
            Vec::new()
        } else {
            extracted
                .plain_text
                .split("\n\n")
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        extracted.normalized_html = article_from_paragraphs(&item_title, &paragraphs);

        let tx = conn.transaction()?;
        tx.execute(
            "
            UPDATE extracted_content
            SET plain_text = ?2,
                normalized_html = ?3,
                page_count = ?4,
                content_status = ?5,
                content_notice = ?6,
                extractor_version = ?7
            WHERE item_id = ?1
            ",
            params![
                item_id,
                extracted.plain_text,
                extracted.normalized_html,
                extracted.page_count,
                extracted.content_status,
                extracted.content_notice,
                extracted.extractor_version
            ],
        )?;
        tx.execute("DELETE FROM search_index WHERE item_id = ?1", [item_id])?;
        if extracted.should_index() {
            tx.execute(
                "INSERT INTO search_index(item_id, title, plain_text) VALUES (?1, ?2, ?3)",
                params![item_id, item_title, extracted.plain_text],
            )?;
        }
        rebuild_evidence_chunks_conn(
            &tx,
            item_id,
            &item_title,
            &extracted.chunks,
            extracted.extractor_version,
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn repair_library_content_if_needed(&self) -> Result<usize> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "
            SELECT i.id, a.path, COALESCE(e.extractor_version, 0)
            FROM items i
            LEFT JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
            JOIN extracted_content e ON e.item_id = i.id
            ORDER BY i.id ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        let mut item_ids = Vec::new();
        for row in rows {
            let (item_id, attachment_path, extractor_version) = row?;
            let Some(attachment_path) = attachment_path else {
                continue;
            };
            if extractor_version >= EXTRACTOR_VERSION {
                continue;
            }
            if infer_attachment_format(&attachment_path) != "pdf" {
                continue;
            }
            item_ids.push(item_id);
        }

        let mut repaired = 0usize;
        for item_id in item_ids {
            if self.repair_item_content_if_needed(item_id)? {
                repaired += 1;
            }
        }
        Ok(repaired)
    }

    pub fn read_primary_attachment_bytes(&self, primary_attachment_id: i64) -> Result<Vec<u8>> {
        let conn = self.connect()?;
        let attachment = conn
            .query_row(
                "
                SELECT path, is_primary
                FROM attachments
                WHERE id = ?1
                ",
                [primary_attachment_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;

        let Some((path, is_primary)) = attachment else {
            return Err(anyhow!("primary attachment was not found"));
        };

        if is_primary != 1 {
            return Err(anyhow!(
                "requested attachment is not the primary attachment"
            ));
        }

        let attachment_format = infer_attachment_format(&path);
        if attachment_format != "pdf" && attachment_format != "md" {
            return Err(anyhow!("primary attachment is not a PDF or Markdown file"));
        }

        let attachment_path = PathBuf::from(&path);
        if !attachment_path.exists() {
            return Err(anyhow!("primary attachment file is missing"));
        }

        fs::read(&attachment_path).map_err(|_| anyhow!("failed to read primary attachment bytes"))
    }

    fn build_provider_request(
        &self,
        settings: &StoredAISettings,
        prompt: String,
    ) -> Result<AiCompletionRequest> {
        self.build_specific_provider_request(
            settings,
            settings.active_provider,
            prompt,
            ProviderRequestPurpose::Default,
        )
    }

    fn build_specific_provider_request(
        &self,
        settings: &StoredAISettings,
        provider: AIProvider,
        prompt: String,
        purpose: ProviderRequestPurpose,
    ) -> Result<AiCompletionRequest> {
        match provider {
            AIProvider::OpenAI => {
                let model = purpose.openai_model(settings);
                let api_key = settings.openai_api_key.trim();
                if model.is_empty() || api_key.is_empty() {
                    return Err(anyhow!(
                        "OpenAI is missing a saved API key or model. Open Settings and complete the active provider configuration."
                    ));
                }
                Ok(AiCompletionRequest {
                    provider: AIProvider::OpenAI,
                    model: model.to_string(),
                    base_url: defaulted_base_url(AIProvider::OpenAI, &settings.openai_base_url),
                    api_key: api_key.to_string(),
                    prompt,
                })
            }
            AIProvider::Anthropic => {
                let model = purpose.anthropic_model(settings);
                let api_key = settings.anthropic_api_key.trim();
                if model.is_empty() || api_key.is_empty() {
                    return Err(anyhow!(
                        "Anthropic is missing a saved API key or model. Open Settings and complete the active provider configuration."
                    ));
                }
                Ok(AiCompletionRequest {
                    provider: AIProvider::Anthropic,
                    model: model.to_string(),
                    base_url: defaulted_base_url(
                        AIProvider::Anthropic,
                        &settings.anthropic_base_url,
                    ),
                    api_key: api_key.to_string(),
                    prompt,
                })
            }
        }
    }

    fn translate_with_deepl(
        &self,
        settings: &StoredAISettings,
        text: &str,
        target_lang: &str,
    ) -> Result<String> {
        let api_key = settings.deepl_api_key.trim();
        if api_key.is_empty() {
            return Err(anyhow!(
                "DeepL is missing a saved API key. Open Settings and complete the translation provider configuration."
            ));
        }
        let base_url = if settings.deepl_base_url.trim().is_empty() {
            "https://api-free.deepl.com"
        } else {
            settings.deepl_base_url.trim()
        };
        let url = format!("{}/v2/translate", normalize_base_url(base_url));
        let client = Client::builder().timeout(Duration::from_secs(60)).build()?;
        let response: serde_json::Value = client
            .post(url)
            .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
            .json(&serde_json::json!({
                "text": [text],
                "target_lang": target_lang,
            }))
            .send()?
            .error_for_status()?
            .json()?;
        let translated = response
            .get("translations")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if translated.is_empty() {
            return Err(anyhow!("DeepL response did not include translated text"));
        }
        Ok(translated)
    }

    pub fn run_item_task_with_stream(
        &self,
        item_id: i64,
        kind: &str,
        prompt: Option<&str>,
        mut on_delta: impl FnMut(&str) -> Result<()>,
    ) -> Result<AITask> {
        let mut conn = self.connect()?;
        let settings = self.load_ai_settings(&conn)?;
        let (collection_id, title) = conn.query_row(
            "
            SELECT i.collection_id, i.title
            FROM items i
            WHERE i.id = ?1
            ",
            [item_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?;
        let collection_name: String = conn.query_row(
            "SELECT name FROM collections WHERE id = ?1",
            [collection_id],
            |row| row.get(0),
        )?;
        let prompt_text = prompt.map(str::trim).filter(|value| !value.is_empty());
        let mut chunks = query_evidence_chunks_conn(
            &conn,
            &[item_id],
            if kind == "item.ask" {
                prompt_text
            } else {
                None
            },
            EVIDENCE_QUERY_LIMIT,
            &EvidenceQueryOptions::default(),
        )?;
        if chunks.is_empty() && kind == "item.ask" && prompt_text.is_some() {
            chunks = query_evidence_chunks_conn(
                &conn,
                &[item_id],
                None,
                EVIDENCE_QUERY_LIMIT,
                &EvidenceQueryOptions::default(),
            )?;
        }
        let evidence = evidence_context(&chunks);
        let prompt_body =
            build_item_prompt(kind, &title, &collection_name, &evidence, prompt_text)?;
        let request = self.build_provider_request(&settings, prompt_body)?;
        let output = self
            .ai_transport
            .stream_completion(request, &mut on_delta)?;
        let output = strip_internal_prompt_metadata(&output);
        let output = append_evidence_references_for_chunks(&output, &chunks);

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO ai_tasks(item_id, collection_id, session_id, kind, status, output_markdown, input_prompt)
             VALUES (?1, ?2, NULL, ?3, 'succeeded', ?4, ?5)",
            params![item_id, collection_id, kind, output, prompt_text],
        )?;
        let task_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO ai_artifacts(task_id, item_id, collection_id, session_id, kind, markdown)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
            params![task_id, item_id, collection_id, kind, output],
        )?;
        tx.commit()?;

        Ok(AITask {
            id: task_id,
            item_id: Some(item_id),
            collection_id: Some(collection_id),
            session_id: None,
            scope_item_ids: None,
            input_prompt: prompt_text.map(str::to_owned),
            kind: kind.into(),
            status: "succeeded".into(),
            output_markdown: output,
        })
    }

    pub fn run_item_task(&self, item_id: i64, kind: &str, prompt: Option<&str>) -> Result<AITask> {
        self.run_item_task_with_stream(item_id, kind, prompt, |_| Ok(()))
    }

    pub fn run_item_summary(&self, item_id: i64) -> Result<AITask> {
        self.run_item_task(item_id, "item.summarize", None)
    }

    pub fn create_note_from_artifact(&self, artifact_id: i64) -> Result<ResearchNote> {
        let conn = self.connect()?;
        let (collection_id, session_id, collection_name, markdown): (
            Option<i64>,
            Option<i64>,
            String,
            String,
        ) = conn.query_row(
            "
            SELECT a.collection_id, a.session_id, COALESCE(c.name, 'Research Session'), a.markdown
            FROM ai_artifacts a
            LEFT JOIN collections c ON c.id = a.collection_id
            WHERE a.id = ?1
            ",
            [artifact_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let title = extract_markdown_heading(&markdown)
            .unwrap_or_else(|| format!("{collection_name} Note"));
        conn.execute(
            "INSERT INTO research_notes(collection_id, session_id, title, markdown) VALUES (?1, ?2, ?3, ?4)",
            params![collection_id, session_id, title, markdown],
        )?;

        Ok(ResearchNote {
            id: conn.last_insert_rowid(),
            collection_id,
            session_id,
            title,
            markdown,
        })
    }

    pub fn create_research_note(
        &self,
        collection_id: Option<i64>,
        session_id: Option<i64>,
        title: &str,
        markdown: &str,
    ) -> Result<ResearchNote> {
        let title = title.trim();
        let markdown = markdown.trim();
        if title.is_empty() || markdown.is_empty() {
            return Err(anyhow!("note title and markdown must not be empty"));
        }
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO research_notes(collection_id, session_id, title, markdown) VALUES (?1, ?2, ?3, ?4)",
            params![collection_id, session_id, title, markdown],
        )?;
        Ok(ResearchNote {
            id: conn.last_insert_rowid(),
            collection_id,
            session_id,
            title: title.to_string(),
            markdown: markdown.to_string(),
        })
    }

    pub fn run_collection_task_with_stream(
        &self,
        collection_id: i64,
        kind: &str,
        scope_item_ids: &[i64],
        prompt: Option<&str>,
        mut on_delta: impl FnMut(&str) -> Result<()>,
    ) -> Result<AITask> {
        if scope_item_ids.is_empty() {
            return Err(anyhow!("collection has no readable items"));
        }
        let mut conn = self.connect()?;
        let settings = self.load_ai_settings(&conn)?;
        let collection_name: String = conn.query_row(
            "SELECT name FROM collections WHERE id = ?1",
            [collection_id],
            |row| row.get(0),
        )?;
        let prompt_text = prompt.map(str::trim).filter(|value| !value.is_empty());
        let chunks = query_collection_prompt_chunks(&conn, kind, scope_item_ids, prompt_text)?;
        let prompt_body = build_collection_prompt(
            &conn,
            collection_id,
            &collection_name,
            kind,
            scope_item_ids,
            prompt_text,
        )?;
        let request = self.build_provider_request(&settings, prompt_body)?;
        let markdown = self
            .ai_transport
            .stream_completion(request, &mut on_delta)?;
        let markdown = strip_internal_prompt_metadata(&markdown);
        let markdown = append_evidence_references_for_chunks(&markdown, &chunks);

        let tx = conn.transaction()?;
        let scope_json = serde_json::to_string(scope_item_ids)?;
        tx.execute(
            "INSERT INTO ai_tasks(collection_id, session_id, kind, status, output_markdown, scope_item_ids, input_prompt)
             VALUES (?1, NULL, ?2, 'succeeded', ?3, ?4, ?5)",
            params![collection_id, kind, markdown, scope_json, prompt_text],
        )?;
        let task_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO ai_artifacts(task_id, collection_id, session_id, kind, markdown, scope_item_ids)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![task_id, collection_id, kind, markdown, scope_json],
        )?;
        tx.commit()?;

        Ok(AITask {
            id: task_id,
            item_id: None,
            collection_id: Some(collection_id),
            session_id: None,
            scope_item_ids: Some(scope_item_ids.to_vec()),
            input_prompt: prompt_text.map(str::to_owned),
            kind: kind.into(),
            status: "succeeded".into(),
            output_markdown: markdown,
        })
    }

    pub fn run_collection_task(
        &self,
        collection_id: i64,
        kind: &str,
        scope_item_ids: &[i64],
        prompt: Option<&str>,
    ) -> Result<AITask> {
        self.run_collection_task_with_stream(
            collection_id,
            kind,
            scope_item_ids,
            prompt,
            |_| Ok(()),
        )
    }

    pub fn run_collection_review_draft(&self, collection_id: i64) -> Result<AITask> {
        let item_ids = self
            .list_items(Some(collection_id))?
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        self.run_collection_task(collection_id, "collection.review_draft", &item_ids, None)
    }

    pub fn list_ai_sessions(&self) -> Result<Vec<AISession>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM ai_sessions ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = statement.query_map([], map_ai_session)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn create_ai_session(&self) -> Result<AISession> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO ai_sessions(title) VALUES (?1)",
            [DEFAULT_AI_SESSION_TITLE],
        )?;
        let session_id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, title, created_at, updated_at FROM ai_sessions WHERE id = ?1",
            [session_id],
            map_ai_session,
        )
        .map_err(Into::into)
    }

    pub fn delete_ai_session(&self, session_id: i64) -> Result<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM ai_artifacts WHERE session_id = ?1",
            [session_id],
        )?;
        tx.execute("DELETE FROM ai_tasks WHERE session_id = ?1", [session_id])?;
        tx.execute(
            "DELETE FROM research_notes WHERE session_id = ?1",
            [session_id],
        )?;
        tx.execute(
            "DELETE FROM ai_session_references WHERE session_id = ?1",
            [session_id],
        )?;
        tx.execute("DELETE FROM ai_sessions WHERE id = ?1", [session_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_ai_session_references(&self, session_id: i64) -> Result<Vec<AISessionReference>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, session_id, kind, target_id, sort_index
             FROM ai_session_references
             WHERE session_id = ?1
             ORDER BY sort_index ASC, id ASC",
        )?;
        let rows = statement.query_map([session_id], map_ai_session_reference)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn add_ai_session_reference(
        &self,
        session_id: i64,
        kind: AISessionReferenceKind,
        target_id: i64,
    ) -> Result<AISessionReference> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id FROM ai_sessions WHERE id = ?1",
            [session_id],
            |row| row.get::<_, i64>(0),
        )
        .context("session does not exist")?;
        match kind {
            AISessionReferenceKind::Item => {
                conn.query_row("SELECT id FROM items WHERE id = ?1", [target_id], |row| {
                    row.get::<_, i64>(0)
                })
                .context("item does not exist")?;
            }
            AISessionReferenceKind::Collection => {
                conn.query_row(
                    "SELECT id FROM collections WHERE id = ?1",
                    [target_id],
                    |row| row.get::<_, i64>(0),
                )
                .context("collection does not exist")?;
            }
        }
        let already = conn
            .query_row(
                "SELECT id FROM ai_session_references WHERE session_id = ?1 AND kind = ?2 AND target_id = ?3",
                params![session_id, kind.as_str(), target_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if let Some(reference_id) = already {
            return conn
                .query_row(
                    "SELECT id, session_id, kind, target_id, sort_index FROM ai_session_references WHERE id = ?1",
                    [reference_id],
                    map_ai_session_reference,
                )
                .map_err(Into::into);
        }
        let sort_index: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM ai_session_references WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO ai_session_references(session_id, kind, target_id, sort_index) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, kind.as_str(), target_id, sort_index],
        )?;
        touch_ai_session(&conn, session_id, None)?;
        conn.query_row(
            "SELECT id, session_id, kind, target_id, sort_index FROM ai_session_references WHERE id = ?1",
            [conn.last_insert_rowid()],
            map_ai_session_reference,
        )
        .map_err(Into::into)
    }

    pub fn remove_ai_session_reference(&self, reference_id: i64) -> Result<()> {
        let conn = self.connect()?;
        let session_id = conn
            .query_row(
                "SELECT session_id FROM ai_session_references WHERE id = ?1",
                [reference_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(session_id) = session_id else {
            return Ok(());
        };
        conn.execute(
            "DELETE FROM ai_session_references WHERE id = ?1",
            [reference_id],
        )?;
        conn.execute(
            "
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY sort_index ASC, id ASC) - 1 AS next_sort_index
                FROM ai_session_references
                WHERE session_id = ?1
            )
            UPDATE ai_session_references
            SET sort_index = (SELECT next_sort_index FROM ranked WHERE ranked.id = ai_session_references.id)
            WHERE session_id = ?1
            ",
            [session_id],
        )?;
        touch_ai_session(&conn, session_id, None)?;
        Ok(())
    }

    pub fn get_ai_session_scope(&self, session_id: i64) -> Result<AISessionScope> {
        let conn = self.connect()?;
        let references = list_session_references_conn(&conn, session_id)?;
        let expanded = expand_session_references(&conn, &references)?;
        Ok(AISessionScope {
            session_id,
            item_ids: expanded.item_ids,
            has_collection_reference: expanded.has_collection_reference,
            primary_collection_id: expanded.primary_collection_id,
        })
    }

    pub fn run_ai_session_task_with_stream(
        &self,
        session_id: i64,
        kind: &str,
        prompt: Option<&str>,
        mut on_delta: impl FnMut(&str) -> Result<()>,
    ) -> Result<AITask> {
        let mut conn = self.connect()?;
        let settings = self.load_ai_settings(&conn)?;
        let references = list_session_references_conn(&conn, session_id)?;
        let expanded = expand_session_references(&conn, &references)?;
        if expanded.item_ids.is_empty() {
            return Err(anyhow!("session has no readable items"));
        }
        if kind == "session.compare" && expanded.item_ids.len() < 2 {
            return Err(anyhow!("compare requires at least 2 unique papers"));
        }
        let prompt_text = prompt.map(str::trim).filter(|value| !value.is_empty());
        let chunks = query_session_prompt_chunks(&conn, kind, &expanded.item_ids, prompt_text)?;
        let prompt_body = build_session_prompt(&conn, kind, &expanded, prompt_text)?;
        let request = self.build_provider_request(&settings, prompt_body)?;
        let markdown = self
            .ai_transport
            .stream_completion(request, &mut on_delta)?;
        let markdown = strip_internal_prompt_metadata(&markdown);
        let markdown = append_evidence_references_for_chunks(&markdown, &chunks);
        let display_title = derive_session_title(kind, prompt_text);
        let session_title = conn.query_row(
            "SELECT title FROM ai_sessions WHERE id = ?1",
            [session_id],
            |row| row.get::<_, String>(0),
        )?;
        let primary_collection_id = expanded.primary_collection_id;
        let scope_json = serde_json::to_string(&expanded.item_ids)?;

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO ai_tasks(item_id, collection_id, session_id, kind, status, output_markdown, scope_item_ids, input_prompt)
             VALUES (NULL, ?1, ?2, ?3, 'succeeded', ?4, ?5, ?6)",
            params![primary_collection_id, session_id, kind, markdown, scope_json, prompt_text],
        )?;
        let task_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO ai_artifacts(task_id, item_id, collection_id, session_id, kind, markdown, scope_item_ids)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)",
            params![task_id, primary_collection_id, session_id, kind, markdown, scope_json],
        )?;
        let next_title = if session_title == DEFAULT_AI_SESSION_TITLE {
            display_title
        } else {
            None
        };
        touch_ai_session(&tx, session_id, next_title.as_deref())?;
        tx.commit()?;

        Ok(AITask {
            id: task_id,
            item_id: None,
            collection_id: primary_collection_id,
            session_id: Some(session_id),
            scope_item_ids: Some(expanded.item_ids),
            input_prompt: prompt_text.map(str::to_owned),
            kind: kind.into(),
            status: "succeeded".into(),
            output_markdown: markdown,
        })
    }

    pub fn run_ai_session_task(
        &self,
        session_id: i64,
        kind: &str,
        prompt: Option<&str>,
    ) -> Result<AITask> {
        self.run_ai_session_task_with_stream(session_id, kind, prompt, |_| Ok(()))
    }

    pub fn list_ai_session_task_runs(&self, session_id: i64) -> Result<Vec<AITask>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, item_id, collection_id, session_id, scope_item_ids, input_prompt, kind, status, output_markdown
             FROM ai_tasks WHERE session_id = ?1 ORDER BY id DESC",
        )?;
        let rows = statement.query_map([session_id], map_ai_task)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get_ai_session_artifact(&self, session_id: i64) -> Result<Option<AIArtifact>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, task_id, item_id, collection_id, session_id, scope_item_ids, kind, markdown
             FROM ai_artifacts WHERE session_id = ?1 ORDER BY id DESC LIMIT 1",
        )?;
        statement
            .query_row([session_id], map_ai_artifact)
            .optional()
            .map_err(Into::into)
    }

    pub fn list_ai_session_notes(&self, session_id: i64) -> Result<Vec<ResearchNote>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, collection_id, session_id, title, markdown
             FROM research_notes WHERE session_id = ?1 ORDER BY id DESC",
        )?;
        let rows = statement.query_map([session_id], map_research_note)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn list_notes(&self, collection_id: Option<i64>) -> Result<Vec<ResearchNote>> {
        let conn = self.connect()?;
        let mut query =
            "SELECT id, collection_id, session_id, title, markdown FROM research_notes".to_string();
        if collection_id.is_some() {
            query.push_str(" WHERE collection_id = ?1");
        }
        query.push_str(" ORDER BY id DESC");

        let mut statement = conn.prepare(&query)?;
        let rows = if let Some(collection_id) = collection_id {
            statement.query_map([collection_id], map_research_note)?
        } else {
            statement.query_map([], map_research_note)?
        };
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn update_note(&self, note_id: i64, markdown: String) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE research_notes SET markdown = ?1 WHERE id = ?2",
            params![markdown, note_id],
        )?;
        Ok(())
    }

    pub fn export_note_markdown(&self, note_id: i64) -> Result<String> {
        let conn = self.connect()?;
        let markdown: String = conn.query_row(
            "SELECT markdown FROM research_notes WHERE id = ?1",
            [note_id],
            |row| row.get(0),
        )?;
        append_evidence_references(&conn, &markdown)
    }

    pub fn export_citation(&self, item_id: i64, format: &str) -> Result<String> {
        let conn = self.connect()?;
        let (title, authors, publication_year, source, doi): (
            String,
            String,
            Option<i64>,
            String,
            Option<String>,
        ) = conn.query_row(
            "
            SELECT i.title, i.authors, i.publication_year, i.source, i.doi
            FROM items i
            WHERE i.id = ?1
            ",
            [item_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
        let citation = match format {
            "bibtex" => format!(
                "@article{{paper-reader-{item_id},\n  title = {{{title}}},\n  author = {{{authors}}},\n  journal = {{{source}}},\n  doi = {{{}}},\n  year = {{{}}}\n}}",
                doi.unwrap_or_default(),
                publication_year.unwrap_or(2026)
            ),
            "ris" => format!(
                "TY  - JOUR\nTI  - {title}\nAU  - {authors}\nJO  - {source}\nPY  - {}\nDO  - {}\nER  -",
                publication_year.unwrap_or(2026),
                doi.unwrap_or_default()
            ),
            _ => format!(
                "APA 7 · {authors}. ({}). {title}. {source}.",
                publication_year.unwrap_or(item_id)
            ),
        };
        Ok(citation)
    }

    pub fn list_task_runs(
        &self,
        item_id: Option<i64>,
        collection_id: Option<i64>,
    ) -> Result<Vec<AITask>> {
        let conn = self.connect()?;
        let mut query =
            "SELECT id, item_id, collection_id, session_id, scope_item_ids, input_prompt, kind, status, output_markdown FROM ai_tasks"
                .to_string();
        match (item_id, collection_id) {
            (Some(_), Some(_)) => query.push_str(" WHERE item_id = ?1 AND collection_id = ?2"),
            (Some(_), None) => query.push_str(" WHERE item_id = ?1"),
            (None, Some(_)) => query.push_str(" WHERE collection_id = ?1 AND item_id IS NULL"),
            (None, None) => {}
        }
        query.push_str(" ORDER BY id DESC");

        let mut statement = conn.prepare(&query)?;
        let rows = match (item_id, collection_id) {
            (Some(item_id), Some(collection_id)) => {
                statement.query_map(params![item_id, collection_id], map_ai_task)?
            }
            (Some(item_id), None) => statement.query_map(params![item_id], map_ai_task)?,
            (None, Some(collection_id)) => {
                statement.query_map(params![collection_id], map_ai_task)?
            }
            (None, None) => statement.query_map([], map_ai_task)?,
        };
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get_latest_artifact(
        &self,
        item_id: Option<i64>,
        collection_id: Option<i64>,
    ) -> Result<Option<AIArtifact>> {
        let conn = self.connect()?;
        let query = match (item_id, collection_id) {
            (Some(_), Some(_)) => {
                "SELECT id, task_id, item_id, collection_id, session_id, scope_item_ids, kind, markdown
                 FROM ai_artifacts WHERE item_id = ?1 AND collection_id = ?2 ORDER BY id DESC LIMIT 1"
            }
            (Some(_), None) => {
                "SELECT id, task_id, item_id, collection_id, session_id, scope_item_ids, kind, markdown
                 FROM ai_artifacts WHERE item_id = ?1 ORDER BY id DESC LIMIT 1"
            }
            (None, Some(_)) => {
                "SELECT id, task_id, item_id, collection_id, session_id, scope_item_ids, kind, markdown
                 FROM ai_artifacts WHERE collection_id = ?1 AND item_id IS NULL ORDER BY id DESC LIMIT 1"
            }
            (None, None) => {
                "SELECT id, task_id, item_id, collection_id, session_id, scope_item_ids, kind, markdown
                 FROM ai_artifacts ORDER BY id DESC LIMIT 1"
            }
        };
        let mut statement = conn.prepare(query)?;
        let artifact = match (item_id, collection_id) {
            (Some(item_id), Some(collection_id)) => statement
                .query_row(params![item_id, collection_id], map_ai_artifact)
                .optional()?,
            (Some(item_id), None) => statement
                .query_row(params![item_id], map_ai_artifact)
                .optional()?,
            (None, Some(collection_id)) => statement
                .query_row(params![collection_id], map_ai_artifact)
                .optional()?,
            (None, None) => statement.query_row([], map_ai_artifact).optional()?,
        };
        Ok(artifact)
    }

    pub fn refresh_attachment_statuses(&self) -> Result<()> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            "SELECT id, item_id, path, import_mode, status FROM attachments ORDER BY id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;

        for row in rows {
            let (attachment_id, item_id, path, import_mode, current_status) = row?;
            let status = if Path::new(&path).exists() {
                "ready"
            } else if import_mode == "linked_file" {
                "missing"
            } else {
                "needs_attention"
            };
            if status == current_status {
                continue;
            }
            conn.execute(
                "UPDATE attachments SET status = ?1 WHERE id = ?2",
                params![status, attachment_id],
            )?;
            conn.execute(
                "UPDATE items SET attachment_status = ?1 WHERE id = ?2",
                params![status, item_id],
            )?;
        }
        Ok(())
    }

    pub fn get_connector_settings(&self) -> Result<ConnectorSettings> {
        let conn = self.connect()?;
        ensure_connector_settings_row(&conn)
    }

    pub fn regenerate_connector_token(&self) -> Result<ConnectorSettings> {
        let conn = self.connect()?;
        let token = generate_connector_token();
        conn.execute(
            "UPDATE connector_settings SET token = ?1 WHERE id = 1",
            [token.as_str()],
        )?;
        Ok(ConnectorSettings { token })
    }

    pub fn relink_attachment(&self, attachment_id: i64, replacement: PathBuf) -> Result<()> {
        if !replacement.exists() {
            return Err(anyhow!("replacement file does not exist"));
        }

        let conn = self.connect()?;
        let item_id: i64 = conn.query_row(
            "SELECT item_id FROM attachments WHERE id = ?1",
            [attachment_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE attachments SET path = ?1, status = 'ready' WHERE id = ?2",
            params![replacement.to_string_lossy().to_string(), attachment_id],
        )?;
        conn.execute(
            "UPDATE items SET attachment_status = 'ready' WHERE id = ?1",
            [item_id],
        )?;
        Ok(())
    }

    fn connect(&self) -> Result<PooledConnection> {
        let conn = match self
            .connection_pool
            .lock()
            .map_err(|_| anyhow!("database connection pool lock poisoned"))?
            .pop()
        {
            Some(conn) => conn,
            None => self.open_connection()?,
        };
        Ok(PooledConnection {
            conn: ManuallyDrop::new(conn),
            pool: self.connection_pool.clone(),
        })
    }

    fn open_connection(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        // Background repair tasks can overlap with UI reads; tolerate short-lived locks.
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    fn load_ai_settings(&self, conn: &Connection) -> Result<StoredAISettings> {
        load_ai_settings_row(conn)
    }

    fn save_ai_settings(&self, conn: &Connection, settings: &StoredAISettings) -> Result<()> {
        save_ai_settings_row(conn, settings)?;
        Ok(())
    }

    fn apply_saved_ai_environment(&self) -> Result<()> {
        let conn = self.connect()?;
        let settings = self.load_ai_settings(&conn)?;
        apply_ai_environment(&settings);
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS collections(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER NULL REFERENCES collections(id)
            );

            CREATE TABLE IF NOT EXISTS tags(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS items(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL REFERENCES collections(id),
                title TEXT NOT NULL,
                attachment_status TEXT NOT NULL DEFAULT 'ready',
                authors TEXT NOT NULL DEFAULT '',
                publication_year INTEGER NULL,
                source TEXT NOT NULL DEFAULT '',
                doi TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS item_tags(
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (item_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS attachments(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                path TEXT NOT NULL,
                import_mode TEXT NOT NULL,
                status TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE,
                is_primary INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS extracted_content(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                plain_text TEXT NOT NULL,
                normalized_html TEXT NOT NULL,
                page_count INTEGER NULL,
                content_status TEXT NOT NULL DEFAULT 'unavailable',
                content_notice TEXT NULL,
                extractor_version INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS annotations(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                anchor TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evidence_chunks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                page_number INTEGER NULL,
                page_start INTEGER NULL,
                page_end INTEGER NULL,
                section_title TEXT NULL,
                heading_path_json TEXT NULL,
                content_kind TEXT NOT NULL DEFAULT 'body',
                metadata_json TEXT NULL,
                retrieval_weight REAL NOT NULL DEFAULT 1.0,
                anchor_json TEXT NOT NULL,
                text TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                extractor_version INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evidence_embeddings(
                chunk_id INTEGER NOT NULL REFERENCES evidence_chunks(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                vector_blob BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (chunk_id, model_id)
            );

            CREATE TABLE IF NOT EXISTS ai_tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NULL REFERENCES items(id),
                collection_id INTEGER NULL REFERENCES collections(id),
                session_id INTEGER NULL REFERENCES ai_sessions(id),
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                output_markdown TEXT NOT NULL,
                scope_item_ids TEXT NULL
                ,input_prompt TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_artifacts(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
                item_id INTEGER NULL REFERENCES items(id),
                collection_id INTEGER NULL REFERENCES collections(id),
                session_id INTEGER NULL REFERENCES ai_sessions(id),
                kind TEXT NOT NULL,
                markdown TEXT NOT NULL,
                scope_item_ids TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_sessions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ai_session_references(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                target_id INTEGER NOT NULL,
                sort_index INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS research_notes(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NULL REFERENCES collections(id),
                session_id INTEGER NULL REFERENCES ai_sessions(id),
                title TEXT NOT NULL,
                markdown TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_settings(
                id INTEGER PRIMARY KEY CHECK (id = 1),
                active_provider TEXT NOT NULL DEFAULT 'openai',
                openai_model TEXT NOT NULL DEFAULT '',
                openai_base_url TEXT NOT NULL DEFAULT '',
                openai_api_key TEXT NOT NULL DEFAULT '',
                anthropic_model TEXT NOT NULL DEFAULT '',
                anthropic_base_url TEXT NOT NULL DEFAULT '',
                anthropic_api_key TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS connector_settings(
                id INTEGER PRIMARY KEY CHECK (id = 1),
                token TEXT NOT NULL DEFAULT ''
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                item_id UNINDEXED,
                title,
                plain_text
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunk_index USING fts5(
                chunk_id UNINDEXED,
                item_id UNINDEXED,
                title,
                text
            );

            CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id);
            CREATE INDEX IF NOT EXISTS idx_items_collection_id ON items(collection_id);
            CREATE INDEX IF NOT EXISTS idx_attachments_item_primary ON attachments(item_id, is_primary);
            CREATE INDEX IF NOT EXISTS idx_item_tags_tag_id ON item_tags(tag_id);
            CREATE INDEX IF NOT EXISTS idx_extracted_content_item_id ON extracted_content(item_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_item_id ON annotations(item_id);
            CREATE INDEX IF NOT EXISTS idx_evidence_chunks_item_id ON evidence_chunks(item_id, chunk_index);
            CREATE INDEX IF NOT EXISTS idx_evidence_chunks_content_kind ON evidence_chunks(content_kind);
            CREATE INDEX IF NOT EXISTS idx_evidence_embeddings_hash ON evidence_embeddings(model_id, text_hash);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_session_id ON ai_tasks(session_id);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_item_collection ON ai_tasks(item_id, collection_id);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_collection_item ON ai_tasks(collection_id, item_id);
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_session_id ON ai_artifacts(session_id);
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_item_collection ON ai_artifacts(item_id, collection_id);
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_collection_item ON ai_artifacts(collection_id, item_id);
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_task_id ON ai_artifacts(task_id);
            CREATE INDEX IF NOT EXISTS idx_ai_session_references_session_sort ON ai_session_references(session_id, sort_index);
            CREATE INDEX IF NOT EXISTS idx_ai_session_references_target ON ai_session_references(kind, target_id);
            CREATE INDEX IF NOT EXISTS idx_research_notes_collection_id ON research_notes(collection_id);
            CREATE INDEX IF NOT EXISTS idx_research_notes_session_id ON research_notes(session_id);
            ",
        )?;
        ensure_column(&conn, "items", "authors", "TEXT NOT NULL DEFAULT ''")?;
        ensure_column(&conn, "items", "publication_year", "INTEGER NULL")?;
        ensure_column(&conn, "items", "source", "TEXT NOT NULL DEFAULT ''")?;
        ensure_column(&conn, "items", "doi", "TEXT NULL")?;
        ensure_column(&conn, "extracted_content", "page_count", "INTEGER NULL")?;
        ensure_column(
            &conn,
            "extracted_content",
            "content_status",
            "TEXT NOT NULL DEFAULT 'unavailable'",
        )?;
        ensure_column(&conn, "extracted_content", "content_notice", "TEXT NULL")?;
        ensure_column(
            &conn,
            "extracted_content",
            "extractor_version",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(&conn, "ai_tasks", "scope_item_ids", "TEXT NULL")?;
        ensure_column(&conn, "ai_tasks", "input_prompt", "TEXT NULL")?;
        ensure_column(&conn, "ai_tasks", "session_id", "INTEGER NULL")?;
        ensure_column(&conn, "evidence_chunks", "page_start", "INTEGER NULL")?;
        ensure_column(&conn, "evidence_chunks", "page_end", "INTEGER NULL")?;
        ensure_column(&conn, "evidence_chunks", "section_title", "TEXT NULL")?;
        ensure_column(&conn, "evidence_chunks", "heading_path_json", "TEXT NULL")?;
        ensure_column(
            &conn,
            "evidence_chunks",
            "content_kind",
            "TEXT NOT NULL DEFAULT 'body'",
        )?;
        ensure_column(&conn, "evidence_chunks", "metadata_json", "TEXT NULL")?;
        ensure_column(
            &conn,
            "evidence_chunks",
            "retrieval_weight",
            "REAL NOT NULL DEFAULT 1.0",
        )?;
        conn.execute(
            "UPDATE evidence_chunks
             SET page_start = COALESCE(page_start, page_number),
                 page_end = COALESCE(page_end, page_number),
                 content_kind = COALESCE(NULLIF(content_kind, ''), 'body'),
                 retrieval_weight = COALESCE(retrieval_weight, 1.0)",
            [],
        )?;
        ensure_column(&conn, "ai_artifacts", "scope_item_ids", "TEXT NULL")?;
        ensure_column(&conn, "ai_artifacts", "session_id", "INTEGER NULL")?;
        ensure_column(&conn, "research_notes", "session_id", "INTEGER NULL")?;
        ensure_column(
            &conn,
            "ai_settings",
            "translation_provider",
            "TEXT NOT NULL DEFAULT 'openai'",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "translation_openai_model",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "translation_anthropic_model",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "translation_target_lang",
            "TEXT NOT NULL DEFAULT 'ZH-HANS'",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "deepl_base_url",
            "TEXT NOT NULL DEFAULT 'https://api-free.deepl.com'",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "deepl_api_key",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "provider_env_openai",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &conn,
            "ai_settings",
            "provider_env_anthropic",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        conn.execute("INSERT OR IGNORE INTO ai_settings(id) VALUES (1)", [])?;
        conn.execute(
            "INSERT OR IGNORE INTO connector_settings(id) VALUES (1)",
            [],
        )?;
        ensure_connector_settings_row(&conn)?;
        ensure_existing_evidence_chunks_conn(&conn)?;
        Ok(())
    }
}

fn ensure_connector_settings_row(conn: &Connection) -> Result<ConnectorSettings> {
    let token = conn
        .query_row(
            "SELECT token FROM connector_settings WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    if token.trim().is_empty() {
        let token = generate_connector_token();
        conn.execute(
            "INSERT INTO connector_settings(id, token) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET token = excluded.token",
            [token.as_str()],
        )?;
        return Ok(ConnectorSettings { token });
    }
    Ok(ConnectorSettings { token })
}

fn rebuild_evidence_chunks_conn(
    conn: &Connection,
    item_id: i64,
    title: &str,
    chunks: &[ExtractedChunkDraft],
    extractor_version: i64,
) -> Result<()> {
    conn.execute(
        "DELETE FROM evidence_chunk_index WHERE item_id = ?1",
        [item_id],
    )?;
    conn.execute("DELETE FROM evidence_chunks WHERE item_id = ?1", [item_id])?;
    for (index, chunk) in chunks
        .iter()
        .filter(|chunk| !chunk.text.trim().is_empty())
        .enumerate()
    {
        conn.execute(
            "INSERT INTO evidence_chunks(
                item_id, chunk_index, page_number, page_start, page_end, section_title, heading_path_json,
                content_kind, metadata_json, retrieval_weight, anchor_json, text, source_kind, extractor_version
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                item_id,
                index as i64,
                chunk.page_number,
                chunk.page_start,
                chunk.page_end,
                chunk.section_title,
                chunk.heading_path_json,
                chunk.content_kind,
                chunk.metadata_json,
                chunk.retrieval_weight,
                chunk.anchor_json,
                chunk.text,
                chunk.source_kind,
                extractor_version
            ],
        )?;
        let chunk_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO evidence_chunk_index(chunk_id, item_id, title, text) VALUES (?1, ?2, ?3, ?4)",
            params![chunk_id, item_id, title, chunk.text],
        )?;
    }
    Ok(())
}

fn ensure_existing_evidence_chunks_conn(conn: &Connection) -> Result<()> {
    let missing = conn.query_row(
        "
        SELECT COUNT(*)
        FROM extracted_content e
        JOIN items i ON i.id = e.item_id
        LEFT JOIN evidence_chunks c ON c.item_id = e.item_id
        WHERE c.id IS NULL AND trim(e.plain_text) != ''
        ",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if missing == 0 {
        return Ok(());
    }
    let mut statement = conn.prepare(
        "
        SELECT i.id, i.title, COALESCE(a.path, ''), e.plain_text, COALESCE(e.extractor_version, ?1)
        FROM items i
        JOIN extracted_content e ON e.item_id = i.id
        LEFT JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
        WHERE trim(e.plain_text) != ''
        ORDER BY i.id ASC
        ",
    )?;
    let rows = statement.query_map([EXTRACTOR_VERSION], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (item_id, title, path, plain_text, extractor_version) = row?;
        let has_chunks = conn
            .query_row(
                "SELECT id FROM evidence_chunks WHERE item_id = ?1 LIMIT 1",
                [item_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if has_chunks {
            continue;
        }
        let source_kind = match infer_attachment_format(&path) {
            "pdf" => "pdf",
            "docx" => "docx",
            "epub" => "epub",
            "md" => "markdown",
            _ => "text",
        };
        let chunks = build_paragraph_chunks(&plain_text, None, source_kind);
        rebuild_evidence_chunks_conn(conn, item_id, &title, &chunks, extractor_version)?;
    }
    Ok(())
}

fn query_evidence_chunks_conn(
    conn: &Connection,
    item_ids: &[i64],
    query: Option<&str>,
    limit: i64,
    options: &EvidenceQueryOptions,
) -> Result<Vec<EvidenceChunk>> {
    if item_ids.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 64);
    let placeholders = std::iter::repeat("?")
        .take(item_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query_text = query
        .map(fts_query)
        .filter(|value| !value.trim().is_empty());
    let rank_expression = if options.rerank.as_deref() == Some("none") {
        "bm25(evidence_chunk_index)"
    } else {
        "(bm25(evidence_chunk_index) / c.retrieval_weight)"
    };
    let scoped_grouping =
        matches!(options.scope.as_deref(), Some("collection")) && item_ids.len() > 1;
    if options.group_by_item || scoped_grouping {
        return query_evidence_chunks_grouped_conn(conn, item_ids, query, limit, options);
    }
    let mut args: Vec<rusqlite::types::Value> = item_ids.iter().copied().map(Into::into).collect();
    let content_filter = content_kind_filter_sql(options, &mut args);
    let sql = if let Some(query_text) = query_text {
        args.push(query_text.into());
        args.push(limit.into());
        format!(
            "
            SELECT c.id, c.item_id, i.title, c.chunk_index, c.page_number, c.page_start, c.page_end,
                   c.section_title, c.heading_path_json, c.content_kind, c.metadata_json, c.retrieval_weight,
                   bm25(evidence_chunk_index), c.anchor_json, c.text, c.source_kind, c.extractor_version
            FROM evidence_chunk_index idx
            JOIN evidence_chunks c ON c.id = idx.chunk_id
            JOIN items i ON i.id = c.item_id
            WHERE c.item_id IN ({placeholders}) {content_filter} AND evidence_chunk_index MATCH ?
            ORDER BY {rank_expression}, c.item_id ASC, c.chunk_index ASC
            LIMIT ?
            "
        )
    } else {
        args.push(limit.into());
        format!(
            "
            SELECT c.id, c.item_id, i.title, c.chunk_index, c.page_number, c.page_start, c.page_end,
                   c.section_title, c.heading_path_json, c.content_kind, c.metadata_json, c.retrieval_weight,
                   NULL, c.anchor_json, c.text, c.source_kind, c.extractor_version
            FROM evidence_chunks c
            JOIN items i ON i.id = c.item_id
            WHERE c.item_id IN ({placeholders}) {content_filter}
            ORDER BY c.item_id ASC, c.chunk_index ASC
            LIMIT ?
            "
        )
    };
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(args), map_evidence_chunk)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn query_evidence_chunks_grouped_conn(
    conn: &Connection,
    item_ids: &[i64],
    query_text: Option<&str>,
    limit: i64,
    options: &EvidenceQueryOptions,
) -> Result<Vec<EvidenceChunk>> {
    let per_item_limit = ((limit as usize / item_ids.len().max(1)) + 1).clamp(1, 8) as i64;
    let mut per_item = Vec::new();
    for item_id in item_ids {
        let mut item_options = options.clone();
        item_options.group_by_item = false;
        per_item.push(query_evidence_chunks_conn(
            conn,
            &[*item_id],
            query_text,
            per_item_limit,
            &item_options,
        )?);
    }
    let mut merged = Vec::new();
    for index in 0..per_item_limit as usize {
        for chunks in &per_item {
            if let Some(chunk) = chunks.get(index) {
                merged.push(chunk.clone());
                if merged.len() >= limit as usize {
                    return Ok(merged);
                }
            }
        }
    }
    Ok(merged)
}

fn content_kind_filter_sql(
    options: &EvidenceQueryOptions,
    args: &mut Vec<rusqlite::types::Value>,
) -> String {
    let kinds = options
        .content_kinds
        .iter()
        .map(|kind| kind.trim())
        .filter(|kind| !kind.is_empty())
        .collect::<Vec<_>>();
    if kinds.is_empty() {
        return String::new();
    }
    let placeholders = std::iter::repeat("?")
        .take(kinds.len())
        .collect::<Vec<_>>()
        .join(",");
    for kind in kinds {
        args.push(kind.to_string().into());
    }
    format!("AND c.content_kind IN ({placeholders})")
}

fn map_evidence_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvidenceChunk> {
    Ok(EvidenceChunk {
        id: row.get(0)?,
        item_id: row.get(1)?,
        item_title: row.get(2)?,
        chunk_index: row.get(3)?,
        page_number: row.get(4)?,
        page_start: row.get(5)?,
        page_end: row.get(6)?,
        section_title: row.get(7)?,
        heading_path_json: row.get(8)?,
        content_kind: row.get(9)?,
        metadata_json: row.get(10)?,
        retrieval_weight: row.get(11)?,
        score: row.get(12)?,
        anchor_json: row.get(13)?,
        text: row.get(14)?,
        source_kind: row.get(15)?,
        extractor_version: row.get(16)?,
    })
}

fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| term.trim_matches(|ch: char| !ch.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn build_pdf_chunks(page_text: &[String]) -> Vec<ExtractedChunkDraft> {
    page_text
        .iter()
        .enumerate()
        .flat_map(|(page_index0, text)| {
            build_paragraph_chunks(text, Some(page_index0 as i64 + 1), "pdf")
        })
        .collect()
}

fn build_paragraph_chunks(
    text: &str,
    page_number: Option<i64>,
    source_kind: &str,
) -> Vec<ExtractedChunkDraft> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in text
        .split("\n\n")
        .map(normalize_whitespace)
        .filter(|value| !value.is_empty())
    {
        if !current.is_empty()
            && current.chars().count() + paragraph.chars().count() > EVIDENCE_CHUNK_MAX_CHARS
        {
            chunks.push(extracted_chunk(page_number, source_kind, &current));
            current.clear();
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(&paragraph);
        if current.chars().count() >= EVIDENCE_CHUNK_TARGET_CHARS {
            chunks.push(extracted_chunk(page_number, source_kind, &current));
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        chunks.push(extracted_chunk(page_number, source_kind, &current));
    }
    chunks
}

fn extracted_chunk(page_number: Option<i64>, source_kind: &str, text: &str) -> ExtractedChunkDraft {
    ExtractedChunkDraft {
        page_number,
        page_start: page_number,
        page_end: page_number,
        section_title: None,
        heading_path_json: None,
        content_kind: infer_content_kind(text).to_string(),
        metadata_json: None,
        retrieval_weight: infer_retrieval_weight(text),
        anchor_json: serde_json::json!({
            "kind": "evidence_chunk",
            "page_number": page_number,
            "page_start": page_number,
            "page_end": page_number,
            "text_prefix": truncate_chars(text, 160),
        })
        .to_string(),
        text: text.to_string(),
        source_kind: source_kind.to_string(),
    }
}

fn build_structured_chunks(blocks: &[ContentBlock], source_kind: &str) -> Vec<ExtractedChunkDraft> {
    let mut chunks = Vec::new();
    let mut heading_path: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_heading_path: Vec<String> = Vec::new();
    let mut current_section_title: Option<String> = None;

    let flush = |chunks: &mut Vec<ExtractedChunkDraft>,
                 current: &mut String,
                 current_heading_path: &[String],
                 current_section_title: &Option<String>| {
        if current.trim().is_empty() {
            return;
        }
        chunks.push(extracted_structured_chunk(
            source_kind,
            current,
            current_heading_path,
            current_section_title.clone(),
        ));
        current.clear();
    };

    for block in blocks {
        let text = normalize_whitespace(&block.text);
        if text.is_empty() {
            continue;
        }
        if let Some(level) = block.heading_level {
            flush(
                &mut chunks,
                &mut current,
                &current_heading_path,
                &current_section_title,
            );
            let level = level.clamp(1, 6);
            if heading_path.len() >= level {
                heading_path.truncate(level - 1);
            }
            heading_path.push(text);
            continue;
        }
        if !current.is_empty()
            && current.chars().count() + text.chars().count() > EVIDENCE_CHUNK_MAX_CHARS
        {
            flush(
                &mut chunks,
                &mut current,
                &current_heading_path,
                &current_section_title,
            );
        }
        if current.is_empty() {
            current_heading_path = heading_path.clone();
            current_section_title = heading_path.last().cloned();
        } else {
            current.push_str("\n\n");
        }
        current.push_str(&text);
        if current.chars().count() >= EVIDENCE_CHUNK_TARGET_CHARS {
            flush(
                &mut chunks,
                &mut current,
                &current_heading_path,
                &current_section_title,
            );
        }
    }
    flush(
        &mut chunks,
        &mut current,
        &current_heading_path,
        &current_section_title,
    );
    chunks
}

fn extracted_structured_chunk(
    source_kind: &str,
    text: &str,
    heading_path: &[String],
    section_title: Option<String>,
) -> ExtractedChunkDraft {
    let heading_path_json = if heading_path.is_empty() {
        None
    } else {
        Some(serde_json::to_string(heading_path).unwrap_or_else(|_| "[]".into()))
    };
    let content_kind = infer_content_kind(text).to_string();
    ExtractedChunkDraft {
        page_number: None,
        page_start: None,
        page_end: None,
        section_title,
        heading_path_json: heading_path_json.clone(),
        content_kind: content_kind.clone(),
        metadata_json: None,
        retrieval_weight: infer_retrieval_weight(text),
        anchor_json: serde_json::json!({
            "kind": "evidence_chunk",
            "page_number": null,
            "page_start": null,
            "page_end": null,
            "section_title": heading_path.last(),
            "heading_path": heading_path,
            "text_prefix": truncate_chars(text, 160),
        })
        .to_string(),
        text: text.to_string(),
        source_kind: source_kind.to_string(),
    }
}

fn infer_content_kind(text: &str) -> &'static str {
    let trimmed = text.trim_start().to_lowercase();
    if trimmed.starts_with("figure ") || trimmed.starts_with("fig. ") || trimmed.starts_with("fig ")
    {
        "figure_caption"
    } else if trimmed.starts_with("table ") {
        "table_caption"
    } else {
        "body"
    }
}

fn infer_retrieval_weight(text: &str) -> f64 {
    match infer_content_kind(text) {
        "figure_caption" | "table_caption" => 1.15,
        _ => 1.0,
    }
}

fn evidence_text_prefix(anchor_json: &str, text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(anchor_json)
        .ok()
        .and_then(|value| {
            value
                .get("text_prefix")
                .and_then(|prefix| prefix.as_str())
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| truncate_chars(text, 160))
}

fn generate_connector_token() -> String {
    let mut bytes = [0_u8; 32];
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let digest = Sha256::digest(nanos.to_string().as_bytes());
        bytes.copy_from_slice(&digest[..32]);
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn to_public_ai_settings(settings: &StoredAISettings) -> AISettings {
    AISettings {
        active_provider: settings.active_provider,
        openai_model: settings.openai_model.clone(),
        openai_base_url: settings.openai_base_url.clone(),
        has_openai_api_key: !settings.openai_api_key.trim().is_empty(),
        provider_env_openai: settings.provider_env_openai.clone(),
        anthropic_model: settings.anthropic_model.clone(),
        anthropic_base_url: settings.anthropic_base_url.clone(),
        has_anthropic_api_key: !settings.anthropic_api_key.trim().is_empty(),
        provider_env_anthropic: settings.provider_env_anthropic.clone(),
        translation_provider: settings.translation_provider,
        translation_openai_model: settings.translation_openai_model.clone(),
        translation_anthropic_model: settings.translation_anthropic_model.clone(),
        translation_target_lang: settings.translation_target_lang.clone(),
        deepl_base_url: settings.deepl_base_url.clone(),
        has_deepl_api_key: !settings.deepl_api_key.trim().is_empty(),
    }
}

fn load_ai_settings_row(conn: &Connection) -> Result<StoredAISettings> {
    conn.query_row(
        "SELECT active_provider, openai_model, openai_base_url, openai_api_key, anthropic_model, anthropic_base_url, anthropic_api_key, translation_provider, translation_openai_model, translation_anthropic_model, translation_target_lang, deepl_base_url, deepl_api_key, provider_env_openai, provider_env_anthropic FROM ai_settings WHERE id = 1",
        [],
        |row| {
            let active_provider: String = row.get(0)?;
            Ok(StoredAISettings {
                active_provider: match parse_ai_provider(&active_provider) {
                    Ok(provider) => provider,
                    Err(error) => {
                        return Err(rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())),
                        ))
                    }
                },
                openai_model: row.get(1)?,
                openai_base_url: row.get(2)?,
                openai_api_key: row.get(3)?,
                anthropic_model: row.get(4)?,
                anthropic_base_url: row.get(5)?,
                anthropic_api_key: row.get(6)?,
                translation_provider: parse_translation_provider(row.get::<_, String>(7)?.as_str()).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        7,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())),
                    )
                })?,
                translation_openai_model: row.get(8)?,
                translation_anthropic_model: row.get(9)?,
                translation_target_lang: row.get(10)?,
                deepl_base_url: row.get(11)?,
                deepl_api_key: row.get(12)?,
                provider_env_openai: row.get(13)?,
                provider_env_anthropic: row.get(14)?,
            })
        },
    )
    .map_err(Into::into)
}

fn save_ai_settings_row(conn: &Connection, settings: &StoredAISettings) -> Result<()> {
    conn.execute(
        "UPDATE ai_settings
         SET active_provider = ?1,
             openai_model = ?2,
             openai_base_url = ?3,
             openai_api_key = ?4,
             anthropic_model = ?5,
             anthropic_base_url = ?6,
             anthropic_api_key = ?7,
             translation_provider = ?8,
             translation_openai_model = ?9,
             translation_anthropic_model = ?10,
             translation_target_lang = ?11,
             deepl_base_url = ?12,
             deepl_api_key = ?13,
             provider_env_openai = ?14,
             provider_env_anthropic = ?15
         WHERE id = 1",
        params![
            settings.active_provider.as_str(),
            settings.openai_model,
            settings.openai_base_url,
            settings.openai_api_key,
            settings.anthropic_model,
            settings.anthropic_base_url,
            settings.anthropic_api_key,
            settings.translation_provider.as_str(),
            settings.translation_openai_model,
            settings.translation_anthropic_model,
            settings.translation_target_lang,
            settings.deepl_base_url,
            settings.deepl_api_key,
            settings.provider_env_openai,
            settings.provider_env_anthropic,
        ],
    )?;
    Ok(())
}

fn apply_ai_environment(settings: &StoredAISettings) {
    for text in [
        settings.provider_env_openai.as_str(),
        settings.provider_env_anthropic.as_str(),
    ] {
        apply_env_text(text);
    }
}

fn apply_env_text(text: &str) {
    for (key, value) in parse_env_text(text) {
        env::set_var(key, value);
    }
}

fn parse_env_text(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let line = line.strip_prefix("export ").unwrap_or(line).trim();
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            if key.is_empty()
                || !key
                    .chars()
                    .all(|character| character == '_' || character.is_ascii_alphanumeric())
            {
                return None;
            }
            let value = trim_env_value(value.trim()).to_string();
            Some((key.to_string(), value))
        })
        .collect()
}

fn trim_env_value(value: &str) -> &str {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'\'' && last == b'\'') || (first == b'"' && last == b'"') {
            return &value[1..value.len() - 1];
        }
    }
    value
}

fn parse_translation_provider(value: &str) -> Result<TranslationProvider> {
    match value {
        "openai" => Ok(TranslationProvider::OpenAI),
        "anthropic" => Ok(TranslationProvider::Anthropic),
        "deepl" => Ok(TranslationProvider::DeepL),
        _ => Err(anyhow!("unsupported translation provider: {value}")),
    }
}

fn translation_prompt(text: &str, target_lang: &str) -> String {
    format!(
        "Translate the following selection to {target_lang}. Output only the translated text. Do not use markdown, explanations, quotation marks, labels, prefixes, or suffixes. Preserve the original line breaks.\n\n{text}"
    )
}

fn parse_ai_provider(value: &str) -> Result<AIProvider> {
    match value {
        "openai" => Ok(AIProvider::OpenAI),
        "anthropic" => Ok(AIProvider::Anthropic),
        _ => Err(anyhow!("unsupported ai provider: {value}")),
    }
}

fn normalize_base_url(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn defaulted_base_url(provider: AIProvider, value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        provider.default_base_url().to_string()
    } else {
        normalize_base_url(trimmed)
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[derive(Debug)]
struct SessionPromptExpansion {
    item_ids: Vec<i64>,
    has_collection_reference: bool,
    primary_collection_id: Option<i64>,
}

fn list_session_references_conn(
    conn: &Connection,
    session_id: i64,
) -> Result<Vec<AISessionReference>> {
    let mut statement = conn.prepare(
        "SELECT id, session_id, kind, target_id, sort_index
         FROM ai_session_references
         WHERE session_id = ?1
         ORDER BY sort_index ASC, id ASC",
    )?;
    let rows = statement.query_map([session_id], map_ai_session_reference)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn session_reference_session_ids_for_target(
    conn: &Connection,
    kind: &str,
    target_id: i64,
) -> Result<Vec<i64>> {
    let mut statement = conn.prepare(
        "
        SELECT DISTINCT session_id
        FROM ai_session_references
        WHERE kind = ?1 AND target_id = ?2
        ORDER BY session_id ASC
        ",
    )?;
    let rows = statement.query_map(params![kind, target_id], |row| row.get::<_, i64>(0))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn normalize_session_reference_sort_indexes_conn(conn: &Connection, session_id: i64) -> Result<()> {
    conn.execute(
        "
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY sort_index ASC, id ASC) - 1 AS next_sort_index
            FROM ai_session_references
            WHERE session_id = ?1
        )
        UPDATE ai_session_references
        SET sort_index = (SELECT next_sort_index FROM ranked WHERE ranked.id = ai_session_references.id)
        WHERE session_id = ?1
        ",
        [session_id],
    )?;
    Ok(())
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn collection_subtree_ids_conn(conn: &Connection, root_id: i64) -> Result<Vec<i64>> {
    let exists = conn
        .query_row(
            "SELECT id FROM collections WHERE id = ?1",
            [root_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if exists.is_none() {
        return Ok(Vec::new());
    }

    let mut ids = Vec::new();
    let mut stack = vec![root_id];
    while let Some(collection_id) = stack.pop() {
        ids.push(collection_id);
        let mut statement = conn
            .prepare("SELECT id FROM collections WHERE parent_id = ?1 ORDER BY name ASC, id ASC")?;
        let rows = statement.query_map([collection_id], |row| row.get::<_, i64>(0))?;
        let children = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        for child_id in children.into_iter().rev() {
            stack.push(child_id);
        }
    }

    Ok(ids)
}

fn item_ids_for_collection_ids_conn(conn: &Connection, collection_ids: &[i64]) -> Result<Vec<i64>> {
    if collection_ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT id FROM items WHERE collection_id IN ({}) ORDER BY id ASC",
        placeholders(collection_ids.len())
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(collection_ids.iter().copied()), |row| {
        row.get::<_, i64>(0)
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn managed_attachment_paths_for_item_ids_conn(
    conn: &Connection,
    item_ids: &[i64],
) -> Result<Vec<String>> {
    if item_ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT path FROM attachments WHERE import_mode = ?1 AND item_id IN ({}) ORDER BY id ASC",
        placeholders(item_ids.len())
    );
    let mut params = vec![ImportMode::ManagedCopy.as_str().to_string()];
    params.extend(item_ids.iter().map(ToString::to_string));
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(params.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn session_reference_session_ids_for_targets(
    conn: &Connection,
    kind: &str,
    target_ids: &[i64],
) -> Result<Vec<i64>> {
    if target_ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "
        SELECT DISTINCT session_id
        FROM ai_session_references
        WHERE kind = ?1 AND target_id IN ({})
        ORDER BY session_id ASC
        ",
        placeholders(target_ids.len())
    );
    let mut values = vec![kind.to_string()];
    values.extend(target_ids.iter().map(ToString::to_string));
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| row.get::<_, i64>(0))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn delete_session_references_for_targets(
    conn: &Connection,
    kind: &str,
    target_ids: &[i64],
) -> Result<()> {
    if target_ids.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "DELETE FROM ai_session_references WHERE kind = ?1 AND target_id IN ({})",
        placeholders(target_ids.len())
    );
    let mut values = vec![kind.to_string()];
    values.extend(target_ids.iter().map(ToString::to_string));
    conn.execute(&sql, params_from_iter(values.iter()))?;
    Ok(())
}

fn delete_by_column_in_clause(
    conn: &Connection,
    table: &str,
    column: &str,
    ids: &[i64],
) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "DELETE FROM {table} WHERE {column} IN ({})",
        placeholders(ids.len())
    );
    conn.execute(&sql, params_from_iter(ids.iter().copied()))?;
    Ok(())
}

fn delete_by_either_column_in_clause(
    conn: &Connection,
    table: &str,
    left_column: &str,
    left_ids: &[i64],
    right_column: &str,
    right_ids: &[i64],
) -> Result<()> {
    if left_ids.is_empty() && right_ids.is_empty() {
        return Ok(());
    }

    let mut clauses = Vec::new();
    let mut values = Vec::new();
    if !left_ids.is_empty() {
        clauses.push(format!(
            "{left_column} IN ({})",
            placeholders(left_ids.len())
        ));
        values.extend(left_ids.iter().copied());
    }
    if !right_ids.is_empty() {
        clauses.push(format!(
            "{right_column} IN ({})",
            placeholders(right_ids.len())
        ));
        values.extend(right_ids.iter().copied());
    }

    let sql = format!("DELETE FROM {table} WHERE {}", clauses.join(" OR "));
    conn.execute(&sql, params_from_iter(values))?;
    Ok(())
}

fn prune_scope_item_ids_for_removed_items(
    conn: &Connection,
    removed_item_ids: &[i64],
) -> Result<()> {
    if removed_item_ids.is_empty() {
        return Ok(());
    }

    let removed = removed_item_ids.iter().copied().collect::<HashSet<_>>();
    prune_scope_item_ids_column(conn, "ai_tasks", &removed)?;
    prune_scope_item_ids_column(conn, "ai_artifacts", &removed)?;
    Ok(())
}

fn prune_scope_item_ids_column(
    conn: &Connection,
    table: &str,
    removed_item_ids: &HashSet<i64>,
) -> Result<()> {
    let sql = format!("SELECT id, scope_item_ids FROM {table} WHERE scope_item_ids IS NOT NULL");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut updates = Vec::new();
    for row in rows {
        let (id, raw_scope) = row?;
        if !scope_item_ids_may_contain_removed_id(&raw_scope, removed_item_ids) {
            continue;
        }
        let scope_item_ids: Vec<i64> = serde_json::from_str(&raw_scope)?;
        let next_scope_item_ids = scope_item_ids
            .iter()
            .copied()
            .filter(|item_id| !removed_item_ids.contains(item_id))
            .collect::<Vec<_>>();
        if next_scope_item_ids.len() == scope_item_ids.len() {
            continue;
        }
        let next_scope_raw = if next_scope_item_ids.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&next_scope_item_ids)?)
        };
        updates.push((id, next_scope_raw));
    }

    let update_sql = format!("UPDATE {table} SET scope_item_ids = ?1 WHERE id = ?2");
    for (id, raw_scope) in updates {
        conn.execute(&update_sql, params![raw_scope, id])?;
    }
    Ok(())
}

fn scope_item_ids_may_contain_removed_id(raw_scope: &str, removed_item_ids: &HashSet<i64>) -> bool {
    removed_item_ids.iter().any(|removed| {
        let needle = removed.to_string();
        raw_scope
            .split(|ch: char| !ch.is_ascii_digit() && ch != '-')
            .any(|part| part == needle)
    })
}

fn expand_session_reference_item_ids(
    references: &[AISessionReference],
    collections: &[Collection],
    items: &[LibraryItem],
) -> Vec<i64> {
    let mut children_by_parent_id = HashMap::<i64, Vec<&Collection>>::new();
    for collection in collections {
        let Some(parent_id) = collection.parent_id else {
            continue;
        };
        children_by_parent_id
            .entry(parent_id)
            .or_default()
            .push(collection);
    }
    for children in children_by_parent_id.values_mut() {
        children.sort_by(|left, right| left.name.cmp(&right.name));
    }

    let items_by_id = items
        .iter()
        .map(|item| (item.id, item))
        .collect::<HashMap<_, _>>();
    let mut items_by_collection_id = HashMap::<i64, Vec<&LibraryItem>>::new();
    for item in items {
        items_by_collection_id
            .entry(item.collection_id)
            .or_default()
            .push(item);
    }
    for collection_items in items_by_collection_id.values_mut() {
        collection_items.sort_by(|left, right| right.id.cmp(&left.id));
    }

    let mut item_ids = Vec::new();
    let mut seen = HashSet::new();

    for reference in references
        .iter()
        .filter(|reference| reference.kind == AISessionReferenceKind::Item)
    {
        if items_by_id.contains_key(&reference.target_id) && seen.insert(reference.target_id) {
            item_ids.push(reference.target_id);
        }
    }

    for reference in references
        .iter()
        .filter(|reference| reference.kind == AISessionReferenceKind::Collection)
    {
        let mut collection_ids = vec![reference.target_id];
        let mut stack = children_by_parent_id
            .get(&reference.target_id)
            .map(|children| children.iter().rev().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        while let Some(collection) = stack.pop() {
            collection_ids.push(collection.id);
            if let Some(children) = children_by_parent_id.get(&collection.id) {
                for child in children.iter().rev() {
                    stack.push(child);
                }
            }
        }

        for collection_id in collection_ids {
            for item in items_by_collection_id
                .get(&collection_id)
                .into_iter()
                .flatten()
            {
                if seen.insert(item.id) {
                    item_ids.push(item.id);
                }
            }
        }
    }

    item_ids
}

fn expand_session_references(
    conn: &Connection,
    references: &[AISessionReference],
) -> Result<SessionPromptExpansion> {
    let mut collection_statement =
        conn.prepare("SELECT id, name, parent_id FROM collections ORDER BY name ASC")?;
    let collection_rows = collection_statement.query_map([], map_collection)?;
    let collections = collection_rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare(
        "
        SELECT i.id, i.title, i.collection_id, a.id, a.path, a.status, i.authors, i.publication_year, i.source, i.doi
        FROM items i
        JOIN attachments a ON a.item_id = i.id AND a.is_primary = 1
        ORDER BY i.id DESC
        ",
    )?;
    let rows = statement.query_map([], map_library_item)?;
    let items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let item_ids = expand_session_reference_item_ids(references, &collections, &items);
    let collection_by_item_id = items
        .iter()
        .map(|item| (item.id, item.collection_id))
        .collect::<HashMap<_, _>>();
    let primary_collection_id = item_ids
        .first()
        .and_then(|item_id| collection_by_item_id.get(item_id).copied());
    let has_collection_reference = references
        .iter()
        .any(|reference| reference.kind == AISessionReferenceKind::Collection);

    Ok(SessionPromptExpansion {
        item_ids,
        has_collection_reference,
        primary_collection_id,
    })
}

fn derive_session_title(kind: &str, prompt: Option<&str>) -> Option<String> {
    if let Some(prompt) = prompt {
        let trimmed = prompt.trim();
        if !trimmed.is_empty() {
            return Some(truncate_chars(trimmed, 60));
        }
    }
    let label = match kind {
        "session.summarize" => "Summarize",
        "session.explain_terms" => "Explain Terms",
        "session.theme_map" => "Theme Map",
        "session.compare" => "Compare",
        "session.review_draft" => "Review Draft",
        "session.ask" => "Ask",
        _ => return None,
    };
    Some(label.to_string())
}

fn strip_internal_prompt_metadata(markdown: &str) -> String {
    let lines = markdown.lines().collect::<Vec<_>>();
    let first_content = lines.iter().position(|line| !line.trim().is_empty());
    let Some(first_content) = first_content else {
        return markdown.to_string();
    };
    let has_internal_header = lines.iter().skip(first_content).take(8).any(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with("Target title:") || trimmed.starts_with("Task kind:")
    });
    if !has_internal_header {
        return markdown.to_string();
    }

    let mut cleaned = Vec::with_capacity(lines.len());
    let mut in_opening_metadata = true;
    for (index, line) in lines.iter().enumerate() {
        if index < first_content {
            continue;
        }
        let trimmed = line.trim_start();
        let is_internal_line = trimmed.starts_with("Target title:")
            || trimmed.starts_with("Task kind:")
            || trimmed.starts_with("Collection:");
        if in_opening_metadata && (is_internal_line || trimmed.is_empty()) {
            continue;
        }
        in_opening_metadata = false;
        cleaned.push(*line);
    }

    cleaned.join("\n").trim_start().to_string()
}

fn touch_ai_session(conn: &Connection, session_id: i64, title: Option<&str>) -> Result<()> {
    if let Some(title) = title {
        conn.execute(
            "UPDATE ai_sessions SET title = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![title, session_id],
        )?;
    } else {
        conn.execute(
            "UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [session_id],
        )?;
    }
    Ok(())
}

fn build_session_prompt(
    conn: &Connection,
    kind: &str,
    expansion: &SessionPromptExpansion,
    prompt: Option<&str>,
) -> Result<String> {
    let chunks = query_session_prompt_chunks(conn, kind, &expansion.item_ids, prompt)?;
    if !chunks.is_empty() {
        let evidence = evidence_context(&chunks);
        let task_instructions = match kind {
            "session.summarize" => "# Summary Set\n\n## Paper Capsules\n- ...\n\n## Synthesis\n...",
            "session.explain_terms" => {
                "# Terminology Notes\n\n## Terms\n- term: explanation\n\n## Cross-Paper Usage\n..."
            }
            "session.theme_map" => "# Theme Map\n\n## Themes\n- ...\n\n## Theme Clusters\n...",
            "session.compare" => {
                "# Comparison\n\n## Comparison Matrix\n- ...\n\n## Method Notes\n..."
            }
            "session.review_draft" => literature_review_template("session"),
            "session.ask" => "...",
            _ => return Err(anyhow!("unsupported session task kind")),
        };
        let prompt_suffix = if kind == "session.ask" {
            format!(
                "\nUser question:\n{}",
                prompt.unwrap_or("No question provided.")
            )
        } else {
            String::new()
        };
        let task_kind_context = if kind == "session.ask" {
            String::new()
        } else {
            format!("Task kind: {kind}\n")
        };
        return Ok(format!(
            "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nDo not include internal metadata such as target title, collection, or task kind in the answer.\nPreserve the heading and section style shown below.\nUse only the evidence chunks below. Ground key claims, comparisons, and synthesis with inline evidence in the same sentence or bullet.\nDo not create a standalone Evidence, Evidence Map, Sources, or References section. Do not show raw evidence ids such as [E23] in the final answer; cite the paper location in natural language, such as paper title, section/chapter, page, or paragraph block.\n{}\n\n{}{}\n\nEvidence chunks:\n\n{}\n{}",
            review_draft_rules(kind),
            task_kind_context,
            task_instructions,
            evidence,
            prompt_suffix
        ));
    }
    if expansion.item_ids.len() == 1 && !expansion.has_collection_reference {
        let item_id = expansion.item_ids[0];
        let (collection_id, title, excerpt) = conn.query_row(
            "
            SELECT i.collection_id, i.title, e.plain_text
            FROM items i
            JOIN extracted_content e ON e.item_id = i.id
            WHERE i.id = ?1
            ",
            [item_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?;
        let collection_name: String = conn.query_row(
            "SELECT name FROM collections WHERE id = ?1",
            [collection_id],
            |row| row.get(0),
        )?;
        let excerpt = truncate_chars(&excerpt, ITEM_TASK_TEXT_LIMIT);
        return build_single_session_prompt(kind, &title, &collection_name, &excerpt, prompt);
    }

    let mut remaining = COLLECTION_TOTAL_TEXT_LIMIT;
    let mut sections = Vec::new();
    for item_id in &expansion.item_ids {
        let row = conn
            .query_row(
                "
                SELECT i.title, c.name, e.plain_text
                FROM items i
                JOIN collections c ON c.id = i.collection_id
                JOIN extracted_content e ON e.item_id = i.id
                WHERE i.id = ?1
                ",
                [item_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((title, collection_name, plain_text)) = row else {
            continue;
        };
        if remaining == 0 {
            break;
        }
        let clipped = truncate_chars(&plain_text, COLLECTION_ITEM_TEXT_LIMIT.min(remaining));
        if clipped.trim().is_empty() {
            continue;
        }
        remaining = remaining.saturating_sub(clipped.chars().count());
        sections.push(format!(
            "## {title}\nCollection: {collection_name}\n\n{clipped}"
        ));
    }
    if sections.is_empty() {
        return Err(anyhow!("session has no readable items"));
    }
    let task_instructions = match kind {
        "session.summarize" => "# Summary Set\n\n## Paper Capsules\n- ...\n\n## Synthesis\n...",
        "session.explain_terms" => {
            "# Terminology Notes\n\n## Terms\n- term: explanation\n\n## Cross-Paper Usage\n..."
        }
        "session.theme_map" => "# Theme Map\n\n## Themes\n- ...\n\n## Theme Clusters\n...",
        "session.compare" => "# Comparison\n\n## Comparison Matrix\n- ...\n\n## Method Notes\n...",
        "session.review_draft" => literature_review_template("session"),
        "session.ask" => "...",
        _ => return Err(anyhow!("unsupported session task kind")),
    };
    let prompt_suffix = if kind == "session.ask" {
        format!(
            "\nUser question:\n{}",
            prompt.unwrap_or("No question provided.")
        )
    } else {
        String::new()
    };
    let task_kind_context = if kind == "session.ask" {
        String::new()
    } else {
        format!("Task kind: {kind}\n")
    };
    Ok(format!(
        "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nDo not include internal metadata such as target title, collection, or task kind in the answer.\nPreserve the heading and section style shown below.\nWhen answering a user question, cite the paper location in natural language when possible, such as section/chapter, page, or paragraph block.\n{}\n\n{}{}\n\nUse only this extracted evidence in the exact paper order provided:\n\n{}\n{}",
        review_draft_rules(kind),
        task_kind_context,
        task_instructions,
        sections.join("\n\n"),
        prompt_suffix
    ))
}

fn query_session_prompt_chunks(
    conn: &Connection,
    kind: &str,
    item_ids: &[i64],
    prompt: Option<&str>,
) -> Result<Vec<EvidenceChunk>> {
    let evidence_query = if kind == "session.ask" { prompt } else { None };
    let options = EvidenceQueryOptions {
        group_by_item: matches!(
            kind,
            "session.review_draft" | "session.compare" | "session.theme_map"
        ),
        ..EvidenceQueryOptions::default()
    };
    let chunks = query_evidence_chunks_conn(
        conn,
        item_ids,
        evidence_query,
        EVIDENCE_QUERY_LIMIT,
        &options,
    )?;
    if chunks.is_empty() && kind == "session.ask" && prompt.is_some() {
        return query_evidence_chunks_conn(conn, item_ids, None, EVIDENCE_QUERY_LIMIT, &options);
    }
    Ok(chunks)
}

fn build_single_session_prompt(
    kind: &str,
    title: &str,
    collection_name: &str,
    excerpt: &str,
    prompt: Option<&str>,
) -> Result<String> {
    let task_instructions = match kind {
        "session.summarize" => "# Summary: {title}\n\nCollection: {collection}\n\n## Key Points\n- ... (cite location inline)",
        "session.explain_terms" => "# Terminology Notes: {title}\n\n## Key Terms\n- term: explanation\n\n## Reading Tip\n...",
        "session.ask" => "...",
        "session.compare" => return Err(anyhow!("compare requires at least 2 unique papers")),
        "session.theme_map" => "# Theme Map: {title}\n\n## Themes\n- ...\n\n## Theme Clusters\n...",
        "session.review_draft" => literature_review_template("{title}"),
        _ => return Err(anyhow!("unsupported session task kind")),
    };
    let prompt_suffix = if kind == "session.ask" {
        format!("\nUser question:\n{}", prompt.unwrap_or(""))
    } else {
        String::new()
    };
    let internal_context = if kind == "session.ask" {
        String::new()
    } else {
        format!("\nTarget title: {title}\nCollection: {collection_name}\nTask kind: {kind}")
    };
    Ok(format!(
        "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nDo not include internal metadata such as target title, collection, or task kind in the answer.\nPreserve the heading and section style shown below.\nWhen answering a user question, cite the paper location in natural language when possible, such as section/chapter, page, or paragraph block.\n{}\n{}{}\n\nUse only this extracted paper text:\n\"\"\"\n{}\n\"\"\"\n{}",
        review_draft_rules(kind),
        task_instructions
            .replace("{title}", title)
            .replace("{collection}", collection_name),
        internal_context,
        excerpt,
        prompt_suffix
    ))
}

fn build_item_prompt(
    kind: &str,
    title: &str,
    collection_name: &str,
    excerpt: &str,
    prompt: Option<&str>,
) -> Result<String> {
    let task_instructions = match kind {
        "item.summarize" => "# Summary: {title}\n\nCollection: {collection}\n\n## Key Points\n- ... (cite location inline)",
        "item.translate" => "# Translation: {title}\n\n## Translated Passage\n...\n\n## Notes\n...",
        "item.explain_term" => "# Terminology Notes: {title}\n\n## Key Terms\n- term: explanation\n\n## Reading Tip\n...",
        "item.ask" => "...",
        _ => return Err(anyhow!("unsupported item task kind")),
    };
    let prompt_text = prompt.unwrap_or("");
    Ok(format!(
        "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nPreserve the heading and section style shown below.\nUse only the evidence chunks below. Ground key claims with inline evidence in the same sentence or bullet.\nDo not create a standalone Evidence, Evidence Map, Sources, or References section. Do not show raw evidence ids such as [E23] in the final answer; cite the paper location in natural language, such as paper title, section/chapter, page, or paragraph block.\n\nTarget title: {title}\nCollection: {collection_name}\nTask kind: {kind}\n{}\n\nEvidence chunks:\n\n{}\n{}",
        task_instructions
            .replace("{title}", title)
            .replace("{collection}", collection_name),
        excerpt,
        if kind == "item.ask" {
            format!("\nUser question:\n{prompt_text}")
        } else {
            String::new()
        }
    ))
}

fn evidence_context(chunks: &[EvidenceChunk]) -> String {
    chunks
        .iter()
        .map(|chunk| {
            let page = match (chunk.page_start.or(chunk.page_number), chunk.page_end) {
                (Some(start), Some(end)) if end != start => format!(", pp. {start}-{end}"),
                (Some(start), _) => format!(", p. {start}"),
                _ => String::new(),
            };
            let section = chunk
                .section_title
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(", section: {value}"))
                .unwrap_or_default();
            let paragraph = format!(", paragraph block {}", chunk.chunk_index + 1);
            format!(
                "[E{}] {}{}{}{}; kind: {}\n{}",
                chunk.id,
                chunk.item_title,
                page,
                section,
                paragraph,
                chunk.content_kind,
                truncate_chars(&chunk.text, EVIDENCE_CHUNK_MAX_CHARS)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn evidence_location_label(chunk: &EvidenceChunk) -> String {
    let page = match (chunk.page_start.or(chunk.page_number), chunk.page_end) {
        (Some(start), Some(end)) if start != end => format!("pp. {start}-{end}"),
        (Some(start), _) => format!("p. {start}"),
        _ => "no page".into(),
    };
    let heading_path = chunk
        .heading_path_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let section = if heading_path.is_empty() {
        chunk
            .section_title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("no section")
            .to_string()
    } else {
        heading_path.join(" > ")
    };
    format!(
        "{page}, {section}, paragraph block {}",
        chunk.chunk_index + 1
    )
}

fn replace_evidence_markers_with_locations(markdown: &str, chunks: &[EvidenceChunk]) -> String {
    if chunks.is_empty() {
        return markdown.to_string();
    }
    let citation_re = Regex::new(r"\[E(\d+)\]").unwrap();
    let locations = chunks
        .iter()
        .map(|chunk| (chunk.id, evidence_location_label(chunk)))
        .collect::<HashMap<_, _>>();
    citation_re
        .replace_all(markdown, |captures: &regex::Captures<'_>| {
            captures
                .get(1)
                .and_then(|value| value.as_str().parse::<i64>().ok())
                .and_then(|id| locations.get(&id))
                .map(|location| format!("({location})"))
                .unwrap_or_else(|| captures[0].to_string())
        })
        .to_string()
}

fn append_evidence_references_for_chunks(markdown: &str, chunks: &[EvidenceChunk]) -> String {
    replace_evidence_markers_with_locations(markdown, chunks)
}

fn append_evidence_references(conn: &Connection, markdown: &str) -> Result<String> {
    let citation_re = Regex::new(r"\[E(\d+)\]").unwrap();
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for capture in citation_re.captures_iter(markdown) {
        let Some(id) = capture
            .get(1)
            .and_then(|value| value.as_str().parse::<i64>().ok())
        else {
            continue;
        };
        if seen.insert(id) {
            ids.push(id);
        }
    }
    if ids.is_empty() {
        return Ok(markdown.to_string());
    }
    let mut chunks = Vec::new();
    for id in ids {
        if let Some(chunk) = conn
            .query_row(
                "
                SELECT c.id, c.item_id, i.title, c.chunk_index, c.page_number, c.page_start, c.page_end,
                       c.section_title, c.heading_path_json, c.content_kind, c.metadata_json, c.retrieval_weight,
                       NULL, c.anchor_json, c.text, c.source_kind, c.extractor_version
                FROM evidence_chunks c
                JOIN items i ON i.id = c.item_id
                WHERE c.id = ?1
                ",
                [id],
                map_evidence_chunk,
            )
            .optional()?
        {
            chunks.push(chunk);
        }
    }
    Ok(replace_evidence_markers_with_locations(markdown, &chunks))
}

fn literature_review_template(target: &str) -> &'static str {
    match target {
        "{title}" => "# Literature Review: {title}\n\n## Research Problem and Scope\n- ...\n\n## Main Themes\n- ...\n\n## Method and Evidence Comparison\n- ...\n\n## Agreements, Tensions, and Gaps\n- ...\n\n## Suggested Review Narrative\n...\n\n## Open Questions\n- ...",
        "{collection}" => "# Literature Review: {collection}\n\n## Research Problem and Scope\n- ...\n\n## Main Themes\n- ...\n\n## Method and Evidence Comparison\n- ...\n\n## Agreements, Tensions, and Gaps\n- ...\n\n## Suggested Review Narrative\n...\n\n## Open Questions\n- ...",
        _ => "# Literature Review: session\n\n## Research Problem and Scope\n- ...\n\n## Main Themes\n- ...\n\n## Method and Evidence Comparison\n- ...\n\n## Agreements, Tensions, and Gaps\n- ...\n\n## Suggested Review Narrative\n...\n\n## Open Questions\n- ...",
    }
}

fn review_draft_rules(kind: &str) -> &'static str {
    if kind.ends_with("review_draft") {
        "For review drafts: write an academic literature review, not a generic summary. Use only the retrieved evidence. Every key judgment, comparison, and gap analysis must include inline paper-location evidence in the same sentence or bullet. Do not invent papers, methods, datasets, results, or conclusions. If the evidence does not establish a point, write \"not established by retrieved evidence\"."
    } else {
        ""
    }
}

fn build_collection_prompt(
    conn: &Connection,
    collection_id: i64,
    collection_name: &str,
    kind: &str,
    scope_item_ids: &[i64],
    prompt: Option<&str>,
) -> Result<String> {
    let chunks = query_collection_prompt_chunks(conn, kind, scope_item_ids, prompt)?;
    if !chunks.is_empty() {
        let task_instructions = match kind {
            "collection.bulk_summarize" => "# Bulk Summary: {collection}\n\n## Paper Capsules\n- ...\n\n## Synthesis\n...",
            "collection.theme_map" => "# Theme Map: {collection}\n\n## Themes\n- ...\n\n## Theme Clusters\n...",
            "collection.compare_methods" => "# Method Comparison: {collection}\n\n## Comparison Matrix\n- ...\n\n## Method Notes\n...",
            "collection.review_draft" => literature_review_template("{collection}"),
            "collection.ask" => "...",
            _ => return Err(anyhow!("unsupported collection task kind")),
        };
        return Ok(format!(
            "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nPreserve the heading and section style shown below.\nUse only the evidence chunks below. Ground key claims, comparisons, and synthesis with inline evidence in the same sentence or bullet.\nDo not create a standalone Evidence, Evidence Map, Sources, or References section. Do not show raw evidence ids such as [E23] in the final answer; cite the paper location in natural language, such as paper title, section/chapter, page, or paragraph block.\n{}\n\nCollection: {collection_name}\nTask kind: {kind}\n{}\n\nEvidence chunks:\n\n{}\n{}",
            review_draft_rules(kind),
            task_instructions.replace("{collection}", collection_name),
            evidence_context(&chunks),
            if kind == "collection.ask" {
                format!("\nUser question:\n{}", prompt.unwrap_or("No question provided."))
            } else {
                String::new()
            }
        ));
    }
    let mut remaining = COLLECTION_TOTAL_TEXT_LIMIT;
    let mut sections = Vec::new();
    for item_id in scope_item_ids {
        let row = conn
            .query_row(
                "
                SELECT i.title, e.plain_text
                FROM items i
                JOIN extracted_content e ON e.item_id = i.id
                WHERE i.id = ?1 AND i.collection_id = ?2
                ",
                params![item_id, collection_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((title, plain_text)) = row else {
            return Err(anyhow!(
                "scope contains items outside the target collection"
            ));
        };
        if remaining == 0 {
            break;
        }
        let clipped = truncate_chars(&plain_text, COLLECTION_ITEM_TEXT_LIMIT.min(remaining));
        if clipped.trim().is_empty() {
            continue;
        }
        remaining = remaining.saturating_sub(clipped.chars().count());
        sections.push(format!("## {title}\n{clipped}"));
    }
    if sections.is_empty() {
        return Err(anyhow!("collection has no readable items"));
    }
    let task_instructions = match kind {
        "collection.bulk_summarize" => "# Bulk Summary: {collection}\n\n## Paper Capsules\n- ...\n\n## Synthesis\n...",
        "collection.theme_map" => "# Theme Map: {collection}\n\n## Themes\n- ...\n\n## Theme Clusters\n...",
        "collection.compare_methods" => "# Method Comparison: {collection}\n\n## Comparison Matrix\n- ...\n\n## Method Notes\n...",
        "collection.review_draft" => literature_review_template("{collection}"),
        "collection.ask" => "...",
        _ => return Err(anyhow!("unsupported collection task kind")),
    };
    let prompt_suffix = if kind == "collection.ask" {
        format!(
            "\nUser question:\n{}",
            prompt.unwrap_or("No question provided.")
        )
    } else {
        String::new()
    };
    Ok(format!(
        "You are assisting with a research reading workflow.\nReturn markdown only. Do not wrap the answer in code fences.\nPreserve the heading and section style shown below.\n{}\n\nCollection: {collection_name}\nTask kind: {kind}\n{}\n\nUse only this extracted collection evidence in the exact item order provided:\n\n{}\n{}",
        review_draft_rules(kind),
        task_instructions.replace("{collection}", collection_name),
        sections.join("\n\n"),
        prompt_suffix
    ))
}

fn query_collection_prompt_chunks(
    conn: &Connection,
    kind: &str,
    scope_item_ids: &[i64],
    prompt: Option<&str>,
) -> Result<Vec<EvidenceChunk>> {
    let evidence_query = if kind == "collection.ask" {
        prompt
    } else {
        None
    };
    let options = EvidenceQueryOptions {
        group_by_item: matches!(
            kind,
            "collection.review_draft" | "collection.compare_methods" | "collection.theme_map"
        ),
        ..EvidenceQueryOptions::default()
    };
    let chunks = query_evidence_chunks_conn(
        conn,
        scope_item_ids,
        evidence_query,
        EVIDENCE_QUERY_LIMIT,
        &options,
    )?;
    if chunks.is_empty() && kind == "collection.ask" && prompt.is_some() {
        return query_evidence_chunks_conn(
            conn,
            scope_item_ids,
            None,
            EVIDENCE_QUERY_LIMIT,
            &options,
        );
    }
    Ok(chunks)
}

fn extract_openai_content(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    value
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        part.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .filter(|text| !text.trim().is_empty())
}

fn map_library_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryItem> {
    let attachment_path: String = row.get(4)?;
    Ok(LibraryItem {
        id: row.get(0)?,
        title: row.get(1)?,
        collection_id: row.get(2)?,
        primary_attachment_id: row.get(3)?,
        attachment_format: infer_attachment_format(&attachment_path).to_string(),
        attachment_status: row.get(5)?,
        authors: row.get(6)?,
        publication_year: row.get(7)?,
        source: row.get(8)?,
        doi: row.get(9)?,
        tags: Vec::new(),
    })
}

fn hydrate_item_tags(conn: &Connection, mut items: Vec<LibraryItem>) -> Result<Vec<LibraryItem>> {
    if items.is_empty() {
        return Ok(items);
    }

    let item_ids = items.iter().map(|item| item.id).collect::<Vec<_>>();
    let placeholders = std::iter::repeat("?")
        .take(item_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let mut statement = conn.prepare(&format!(
        "
        SELECT it.item_id, t.name
        FROM tags t
        JOIN item_tags it ON it.tag_id = t.id
        WHERE it.item_id IN ({placeholders})
        ORDER BY it.item_id ASC, t.name ASC
        "
    ))?;
    let rows = statement.query_map(rusqlite::params_from_iter(item_ids), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut tags_by_item_id: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    for row in rows {
        let (item_id, tag_name) = row?;
        tags_by_item_id.entry(item_id).or_default().push(tag_name);
    }
    for item in &mut items {
        item.tags = tags_by_item_id.remove(&item.id).unwrap_or_default();
    }
    Ok(items)
}

fn map_research_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResearchNote> {
    Ok(ResearchNote {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        session_id: row.get(2)?,
        title: row.get(3)?,
        markdown: row.get(4)?,
    })
}

fn map_ai_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<AITask> {
    let raw_scope: Option<String> = row.get(4)?;
    let scope_item_ids = parse_scope_item_ids(raw_scope).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(AITask {
        id: row.get(0)?,
        item_id: row.get(1)?,
        collection_id: row.get(2)?,
        session_id: row.get(3)?,
        scope_item_ids,
        input_prompt: row.get(5)?,
        kind: row.get(6)?,
        status: row.get(7)?,
        output_markdown: row.get(8)?,
    })
}

fn map_ai_artifact(row: &rusqlite::Row<'_>) -> rusqlite::Result<AIArtifact> {
    let raw_scope: Option<String> = row.get(5)?;
    let scope_item_ids = parse_scope_item_ids(raw_scope).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(AIArtifact {
        id: row.get(0)?,
        task_id: row.get(1)?,
        item_id: row.get(2)?,
        collection_id: row.get(3)?,
        session_id: row.get(4)?,
        scope_item_ids,
        kind: row.get(6)?,
        markdown: row.get(7)?,
    })
}

fn map_ai_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<AISession> {
    Ok(AISession {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn map_ai_session_reference(row: &rusqlite::Row<'_>) -> rusqlite::Result<AISessionReference> {
    let kind_raw: String = row.get(2)?;
    let kind = AISessionReferenceKind::parse(&kind_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                error.to_string(),
            )),
        )
    })?;
    Ok(AISessionReference {
        id: row.get(0)?,
        session_id: row.get(1)?,
        kind,
        target_id: row.get(3)?,
        sort_index: row.get(4)?,
    })
}

fn parse_scope_item_ids(value: Option<String>) -> Result<Option<Vec<i64>>, serde_json::Error> {
    value.map(|raw| serde_json::from_str(&raw)).transpose()
}

fn map_collection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
    })
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn infer_attachment_format(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".pdf") {
        "pdf"
    } else if lower.ends_with(".docx") {
        "docx"
    } else if lower.ends_with(".epub") {
        "epub"
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "md"
    } else {
        "unknown"
    }
}

fn source_label_from_url(value: &str) -> Option<String> {
    let without_scheme = value
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(value);
    let host = without_scheme.split('/').next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn markdown_to_plain_text(markdown: &str) -> String {
    let mut text = String::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        let mut line = trimmed
            .trim_start_matches('#')
            .trim_start_matches('>')
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .to_string();
        if !in_fence {
            line = Regex::new(r"!\[([^\]]*)\]\([^)]+\)")
                .unwrap()
                .replace_all(&line, "$1")
                .to_string();
            line = Regex::new(r"\[([^\]]+)\]\([^)]+\)")
                .unwrap()
                .replace_all(&line, "$1")
                .to_string();
            line = line
                .replace("**", "")
                .replace("__", "")
                .replace('`', "")
                .replace('*', "");
        }
        if !line.trim().is_empty() {
            text.push_str(line.trim());
            text.push('\n');
        }
    }
    text.trim().to_string()
}

fn markdown_content_blocks(markdown: &str) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        if !in_fence && trimmed.starts_with('#') {
            let level = trimmed.chars().take_while(|ch| *ch == '#').count();
            let text = trimmed.trim_start_matches('#').trim();
            if !text.is_empty() {
                blocks.push(ContentBlock {
                    text: text.to_string(),
                    heading_level: Some(level),
                });
            }
            continue;
        }
        let mut text = trimmed
            .trim_start_matches('>')
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .to_string();
        if !in_fence {
            text = Regex::new(r"!\[([^\]]*)\]\([^)]+\)")
                .unwrap()
                .replace_all(&text, "$1")
                .to_string();
            text = Regex::new(r"\[([^\]]+)\]\([^)]+\)")
                .unwrap()
                .replace_all(&text, "$1")
                .to_string();
            text = text
                .replace("**", "")
                .replace("__", "")
                .replace('`', "")
                .replace('*', "");
        }
        let normalized = normalize_whitespace(&text);
        if !normalized.is_empty() {
            blocks.push(ContentBlock {
                text: normalized,
                heading_level: None,
            });
        }
    }
    blocks
}

fn markdown_to_safe_html(title: &str, markdown: &str) -> String {
    let mut html = format!("<article><h1>{}</h1>", encode_safe(title));
    let mut paragraph = Vec::new();
    let mut unordered_items = Vec::new();
    let mut ordered_items = Vec::new();
    let mut table_rows: Vec<Vec<String>> = Vec::new();
    let mut in_code = false;
    let mut code = String::new();

    let flush_paragraph = |html: &mut String, paragraph: &mut Vec<String>| {
        if !paragraph.is_empty() {
            html.push_str("<p>");
            html.push_str(&render_inline_markdown(&paragraph.join(" ")));
            html.push_str("</p>");
            paragraph.clear();
        }
    };
    let flush_unordered = |html: &mut String, items: &mut Vec<String>| {
        if !items.is_empty() {
            html.push_str("<ul>");
            for item in items.drain(..) {
                html.push_str("<li>");
                html.push_str(&render_inline_markdown(&item));
                html.push_str("</li>");
            }
            html.push_str("</ul>");
        }
    };
    let flush_ordered = |html: &mut String, items: &mut Vec<String>| {
        if !items.is_empty() {
            html.push_str("<ol>");
            for item in items.drain(..) {
                html.push_str("<li>");
                html.push_str(&render_inline_markdown(&item));
                html.push_str("</li>");
            }
            html.push_str("</ol>");
        }
    };
    let flush_table = |html: &mut String, rows: &mut Vec<Vec<String>>| {
        if rows.is_empty() {
            return;
        }
        if rows.len() < 2 {
            // Single row table — treat as header only.
            html.push_str("<table><thead><tr>");
            for cell in rows.drain(..).flatten() {
                html.push_str("<th>");
                html.push_str(&render_inline_markdown(&cell));
                html.push_str("</th>");
            }
            html.push_str("</tr></thead></table>");
            return;
        }
        // Check if second row is a separator (all cells consist of :?-+:?).
        let is_sep = |cell: &str| {
            let trimmed = cell.trim();
            !trimmed.is_empty()
                && trimmed
                    .chars()
                    .all(|c| c == '-' || c == ':' || c == '|' || c == ' ')
        };
        let has_separator = rows[1].iter().all(|c| is_sep(c));
        let mut header = rows.remove(0);
        if has_separator {
            rows.remove(0); // drop separator
        }
        // Normalize all rows to the same column count.
        let col_count = header
            .len()
            .max(rows.iter().map(|r| r.len()).max().unwrap_or(0));
        header.resize(col_count, String::new());
        for row in rows.iter_mut() {
            row.resize(col_count, String::new());
        }
        html.push_str("<table><thead><tr>");
        for cell in &header {
            html.push_str("<th>");
            html.push_str(&render_inline_markdown(cell));
            html.push_str("</th>");
        }
        html.push_str("</tr></thead><tbody>");
        for row in rows.drain(..) {
            html.push_str("<tr>");
            for cell in &row {
                html.push_str("<td>");
                html.push_str(&render_inline_markdown(cell));
                html.push_str("</td>");
            }
            html.push_str("</tr>");
        }
        html.push_str("</tbody></table>");
    };
    let is_ordered_list_item = |line: &str| -> Option<String> {
        let trimmed = line.trim();
        if let Some(dot_pos) = trimmed.find(". ") {
            let prefix = &trimmed[..dot_pos];
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) {
                return Some(trimmed[dot_pos + 2..].to_string());
            }
        }
        None
    };
    let is_table_line = |line: &str| -> Option<Vec<String>> {
        let trimmed = line.trim();
        if !trimmed.contains('|') {
            return None;
        }
        let mut cells: Vec<String> = trimmed.split('|').map(|c| c.trim().to_string()).collect();
        // Strip leading/trailing empty cells from outer pipe syntax (e.g. |a|b|).
        if cells.first().map_or(false, |c| c.is_empty()) {
            cells.remove(0);
        }
        if cells.last().map_or(false, |c| c.is_empty()) {
            cells.pop();
        }
        if cells.len() >= 2 {
            Some(cells)
        } else {
            None
        }
    };

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
            if in_code {
                html.push_str("<pre><code>");
                html.push_str(&encode_safe(&code));
                html.push_str("</code></pre>");
                code.clear();
                in_code = false;
            } else {
                in_code = true;
            }
            continue;
        }
        if in_code {
            code.push_str(line);
            code.push('\n');
            continue;
        }
        if trimmed.is_empty() {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
        } else if trimmed.starts_with('#') {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
            let level = trimmed
                .chars()
                .take_while(|ch| *ch == '#')
                .count()
                .clamp(1, 3);
            let heading = trimmed.trim_start_matches('#').trim();
            html.push_str(&format!("<h{level}>{}</h{level}>", encode_safe(heading)));
        } else if let Some(cells) = is_table_line(trimmed) {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            table_rows.push(cells);
        } else if let Some(item) = is_ordered_list_item(trimmed) {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_table(&mut html, &mut table_rows);
            ordered_items.push(item);
        } else if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            flush_paragraph(&mut html, &mut paragraph);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
            unordered_items.push(item.to_string());
        } else if let Some(quote) = trimmed.strip_prefix('>') {
            flush_paragraph(&mut html, &mut paragraph);
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
            html.push_str("<blockquote>");
            html.push_str(&render_inline_markdown(quote.trim()));
            html.push_str("</blockquote>");
        } else {
            flush_unordered(&mut html, &mut unordered_items);
            flush_ordered(&mut html, &mut ordered_items);
            flush_table(&mut html, &mut table_rows);
            paragraph.push(trimmed.to_string());
        }
    }
    flush_paragraph(&mut html, &mut paragraph);
    flush_unordered(&mut html, &mut unordered_items);
    flush_ordered(&mut html, &mut ordered_items);
    flush_table(&mut html, &mut table_rows);
    if in_code {
        html.push_str("<pre><code>");
        html.push_str(&encode_safe(&code));
        html.push_str("</code></pre>");
    }
    html.push_str("</article>");
    html
}

fn render_inline_markdown(value: &str) -> String {
    let mut rendered = encode_safe(value).to_string();
    // Strip images and links with empty URLs entirely (e.g. ![desc]() or [text]()).
    rendered = Regex::new(r"!\[[^\]]*\]\(\)")
        .unwrap()
        .replace_all(&rendered, "")
        .to_string();
    rendered = Regex::new(r"\[([^\]]*)\]\(\)")
        .unwrap()
        .replace_all(&rendered, "$1")
        .to_string();
    rendered = Regex::new(r"!\[([^\]]*)\]\([^)]+\)")
        .unwrap()
        .replace_all(&rendered, "$1")
        .to_string();
    rendered = Regex::new(r"\[([^\]]+)\]\([^)]+\)")
        .unwrap()
        .replace_all(&rendered, "$1")
        .to_string();
    // Render inline math $...$ as monospace spans, avoiding dollar amounts.
    let math_re = Regex::new(r"\$([^$]+)\$").unwrap();
    rendered = math_re
        .replace_all(&rendered, |caps: &regex::Captures| {
            let content = &caps[1];
            // Only treat as math if it contains LaTeX-like patterns.
            if content.contains('\\')
                || content.contains('^')
                || content.contains('_')
                || content.contains('{')
            {
                format!("<code class=\"math-inline\">{}</code>", content)
            } else {
                caps[0].to_string()
            }
        })
        .to_string();
    rendered
        .replace("**", "")
        .replace("__", "")
        .replace('`', "")
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    match conn.execute(&sql, []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(message)))
            if message.contains("duplicate column name") =>
        {
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn extract_markdown_heading(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('#'))
        .map(|line| line.trim_start_matches('#').trim().to_string())
        .filter(|line| !line.is_empty())
}

fn infer_metadata(title: &str) -> InferredMetadata {
    match title.to_lowercase().as_str() {
        "transformer scaling laws" | "transformer-scaling-laws" => InferredMetadata {
            title: Some("Transformer Scaling Laws".into()),
            authors: "Kaplan et al.".into(),
            publication_year: Some(2020),
            source: "OpenAI".into(),
            doi: Some("10.1000/scaling-laws".into()),
        },
        "graph neural survey" | "graph-neural-survey" => InferredMetadata {
            title: Some("Graph Neural Survey".into()),
            authors: "Wu et al.".into(),
            publication_year: Some(2021),
            source: "IEEE TPAMI".into(),
            doi: Some("10.1000/gnn-survey".into()),
        },
        "distributed consensus notes" | "distributed-consensus-notes" => InferredMetadata {
            title: Some("Distributed Consensus Notes".into()),
            authors: "Ongaro & Ousterhout".into(),
            publication_year: Some(2014),
            source: "USENIX".into(),
            doi: Some("10.1000/raft".into()),
        },
        _ => InferredMetadata {
            title: Some(title_from_slug(title)),
            authors: "Imported Author".into(),
            publication_year: None,
            source: "RustyReader Library".into(),
            doi: None,
        },
    }
}

fn extract_document(path: &Path, bytes: &[u8], format: &str) -> Result<ExtractedDocument> {
    match format {
        "pdf" => extract_pdf(path, bytes),
        "docx" => extract_docx(path, bytes),
        "epub" => extract_epub(path, bytes),
        "md" => extract_markdown(path, bytes),
        _ => Err(anyhow!("unsupported attachment format")),
    }
}

fn extract_pdf(path: &Path, bytes: &[u8]) -> Result<ExtractedDocument> {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Untitled".into());
    let fallback_title = if stem.contains('-') || stem.contains('_') {
        title_from_slug(&stem)
    } else {
        stem
    };

    // Best-effort parsing: PDF import/reading should not be blocked by metadata/text extraction.
    let pdf = PdfDocument::load_mem(bytes).ok();
    let page_count = pdf
        .as_ref()
        .map(|pdf| pdf.get_pages().len() as i64)
        .filter(|count| *count > 0);
    let metadata = pdf
        .as_ref()
        .map(|pdf| read_pdf_metadata(pdf, &fallback_title))
        .unwrap_or_else(|| InferredMetadata {
            title: Some(fallback_title.clone()),
            authors: "Imported Author".into(),
            publication_year: None,
            source: "Imported PDF".into(),
            doi: None,
        });

    let page_text = panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(bytes))
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let page_fragments = pdf_page_fragments(&page_text);
    let plain_text = join_plain_text(&page_fragments);
    let (content_status, content_notice) =
        classify_pdf_content(&page_fragments, page_count.unwrap_or(0) as usize);
    let normalized_html = article_from_paragraphs(
        &metadata
            .title
            .clone()
            .unwrap_or_else(|| fallback_title.clone()),
        &page_fragments,
    );

    Ok(ExtractedDocument {
        normalized_html,
        plain_text,
        chunks: build_pdf_chunks(&page_text),
        page_count,
        content_status,
        content_notice,
        extractor_version: EXTRACTOR_VERSION,
        metadata,
    })
}

fn extract_docx(path: &Path, bytes: &[u8]) -> Result<ExtractedDocument> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let document_xml = read_zip_entry(&mut archive, "word/document.xml")?;
    let blocks = extract_docx_blocks(&document_xml)?;
    let paragraphs = blocks
        .iter()
        .map(|block| block.text.clone())
        .collect::<Vec<_>>();
    let title = read_docx_title(&mut archive)?.unwrap_or_else(|| {
        path.file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .filter(|value| !value.trim().is_empty())
            .map(|value| title_from_slug(&value))
            .unwrap_or_else(|| "Untitled".into())
    });
    let authors = read_docx_author(&mut archive)?.unwrap_or_else(|| "Imported Author".into());
    let plain_text = join_plain_text(&paragraphs);
    let chunks = build_structured_chunks(&blocks, "docx");

    Ok(ExtractedDocument {
        normalized_html: article_from_paragraphs(&title, &paragraphs),
        plain_text,
        chunks,
        page_count: Some(paragraphs.len() as i64),
        content_status: "ready".into(),
        content_notice: None,
        extractor_version: EXTRACTOR_VERSION,
        metadata: InferredMetadata {
            title: Some(title),
            authors,
            publication_year: None,
            source: "Imported DOCX".into(),
            doi: None,
        },
    })
}

fn extract_epub(path: &Path, bytes: &[u8]) -> Result<ExtractedDocument> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let container_xml = read_zip_entry(&mut archive, "META-INF/container.xml")?;
    let rootfile = find_epub_rootfile(&container_xml)?;
    let package_xml = read_zip_entry(&mut archive, &rootfile)?;
    let (title, authors, blocks) = extract_epub_sections(&mut archive, &rootfile, &package_xml)?;
    let resolved_title = title.unwrap_or_else(|| {
        path.file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .filter(|value| !value.trim().is_empty())
            .map(|value| title_from_slug(&value))
            .unwrap_or_else(|| "Untitled".into())
    });
    let sections = blocks
        .iter()
        .map(|block| block.text.clone())
        .collect::<Vec<_>>();
    let plain_text = join_plain_text(&sections);
    let chunks = build_structured_chunks(&blocks, "epub");

    Ok(ExtractedDocument {
        normalized_html: article_from_paragraphs(&resolved_title, &sections),
        plain_text,
        chunks,
        page_count: Some(sections.len() as i64),
        content_status: "ready".into(),
        content_notice: None,
        extractor_version: EXTRACTOR_VERSION,
        metadata: InferredMetadata {
            title: Some(resolved_title),
            authors: authors.unwrap_or_else(|| "Imported Author".into()),
            publication_year: None,
            source: "Imported EPUB".into(),
            doi: None,
        },
    })
}

fn extract_markdown(path: &Path, bytes: &[u8]) -> Result<ExtractedDocument> {
    let markdown = String::from_utf8(bytes.to_vec())?;
    let title = markdown
        .lines()
        .find_map(|line| line.trim().strip_prefix("# "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
                .map(|value| title_from_slug(&value))
                .unwrap_or_else(|| "Untitled".into())
        });
    // Strip the first level-1 heading to avoid duplicating it in the HTML output
    // (markdown_to_safe_html already prepends an <h1> for the title).
    let body_md = if markdown
        .lines()
        .next()
        .map(|l| l.trim().starts_with("# "))
        .unwrap_or(false)
    {
        markdown.lines().skip(1).collect::<Vec<_>>().join("\n")
    } else {
        markdown
    };
    let plain_text = markdown_to_plain_text(&body_md);
    let normalized_html = markdown_to_safe_html(&title, &body_md);
    let blocks = markdown_content_blocks(&body_md);
    let chunks = build_structured_chunks(&blocks, "md");

    Ok(ExtractedDocument {
        normalized_html,
        plain_text,
        chunks,
        page_count: Some(blocks.len() as i64),
        content_status: "ready".into(),
        content_notice: None,
        extractor_version: EXTRACTOR_VERSION,
        metadata: InferredMetadata {
            title: Some(title),
            authors: "Imported Author".into(),
            publication_year: None,
            source: "Imported Markdown".into(),
            doi: None,
        },
    })
}

fn read_zip_entry<R: Read + Seek>(archive: &mut ZipArchive<R>, path: &str) -> Result<String> {
    let mut file = archive.by_name(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    Ok(contents)
}

fn extract_docx_blocks(xml: &str) -> Result<Vec<ContentBlock>> {
    let document = Document::parse(xml)?;
    let mut blocks = Vec::new();
    for paragraph in document.descendants().filter(|node| {
        node.has_tag_name((
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "p",
        ))
    }) {
        let text = paragraph
            .descendants()
            .filter(|node| {
                node.has_tag_name((
                    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                    "t",
                ))
            })
            .filter_map(|node| node.text())
            .collect::<Vec<_>>()
            .join("");
        let normalized = normalize_whitespace(&text);
        if !normalized.is_empty() {
            blocks.push(ContentBlock {
                text: normalized,
                heading_level: docx_heading_level(paragraph),
            });
        }
    }
    if blocks.is_empty() {
        blocks.push(ContentBlock {
            text: "DOCX imported, but no readable paragraphs were extracted.".into(),
            heading_level: None,
        });
    }
    Ok(blocks)
}

fn docx_heading_level(paragraph: roxmltree::Node<'_, '_>) -> Option<usize> {
    paragraph
        .descendants()
        .find(|node| {
            node.has_tag_name((
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "pStyle",
            ))
        })
        .and_then(|node| {
            node.attribute((
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "val",
            ))
            .or_else(|| node.attribute("val"))
        })
        .and_then(|value| {
            let lower = value.to_ascii_lowercase();
            lower
                .strip_prefix("heading")
                .and_then(|suffix| suffix.parse::<usize>().ok())
                .or_else(|| if lower == "title" { Some(1) } else { None })
        })
        .map(|level| level.clamp(1, 6))
}

fn read_docx_title<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Option<String>> {
    match archive.by_name("docProps/core.xml") {
        Ok(mut file) => {
            let mut xml = String::new();
            file.read_to_string(&mut xml)?;
            let doc = Document::parse(&xml)?;
            Ok(doc
                .descendants()
                .find(|node| node.tag_name().name() == "title")
                .and_then(|node| node.text())
                .map(normalize_whitespace)
                .filter(|value| !value.is_empty()))
        }
        Err(_) => Ok(None),
    }
}

fn read_docx_author<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Option<String>> {
    match archive.by_name("docProps/core.xml") {
        Ok(mut file) => {
            let mut xml = String::new();
            file.read_to_string(&mut xml)?;
            let doc = Document::parse(&xml)?;
            Ok(doc
                .descendants()
                .find(|node| node.tag_name().name() == "creator")
                .and_then(|node| node.text())
                .map(normalize_whitespace)
                .filter(|value| !value.is_empty()))
        }
        Err(_) => Ok(None),
    }
}

fn find_epub_rootfile(container_xml: &str) -> Result<String> {
    let document = Document::parse(container_xml)?;
    document
        .descendants()
        .find(|node| node.tag_name().name() == "rootfile")
        .and_then(|node| node.attribute("full-path"))
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("EPUB rootfile is missing"))
}

fn extract_epub_sections<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    rootfile: &str,
    package_xml: &str,
) -> Result<(Option<String>, Option<String>, Vec<ContentBlock>)> {
    let document = Document::parse(package_xml)?;
    let title = document
        .descendants()
        .find(|node| node.tag_name().name() == "title")
        .and_then(|node| node.text())
        .map(normalize_whitespace)
        .filter(|value| !value.is_empty());
    let author = document
        .descendants()
        .find(|node| node.tag_name().name() == "creator")
        .and_then(|node| node.text())
        .map(normalize_whitespace)
        .filter(|value| !value.is_empty());

    let mut manifest = std::collections::HashMap::new();
    for item in document
        .descendants()
        .filter(|node| node.tag_name().name() == "item")
    {
        if let (Some(id), Some(href)) = (item.attribute("id"), item.attribute("href")) {
            manifest.insert(id.to_string(), resolve_relative_path(rootfile, href));
        }
    }

    let mut sections = Vec::new();
    for itemref in document
        .descendants()
        .filter(|node| node.tag_name().name() == "itemref")
    {
        let Some(idref) = itemref.attribute("idref") else {
            continue;
        };
        let Some(chapter_path) = manifest.get(idref) else {
            continue;
        };
        let chapter_xml = read_zip_entry(archive, chapter_path)?;
        sections.extend(extract_xhtml_sections(&chapter_xml)?);
    }

    if sections.is_empty() {
        sections.push(ContentBlock {
            text: "EPUB imported, but no readable sections were extracted.".into(),
            heading_level: None,
        });
    }
    Ok((title, author, sections))
}

fn extract_xhtml_sections(xml: &str) -> Result<Vec<ContentBlock>> {
    let document = Document::parse(xml)?;
    let mut sections = Vec::new();
    for node in document.descendants().filter(|node| {
        matches!(
            node.tag_name().name(),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "li"
        )
    }) {
        let text = normalize_whitespace(node.text().unwrap_or_default());
        if !text.is_empty() {
            let heading_level = match node.tag_name().name() {
                "h1" => Some(1),
                "h2" => Some(2),
                "h3" => Some(3),
                "h4" => Some(4),
                "h5" => Some(5),
                "h6" => Some(6),
                _ => None,
            };
            sections.push(ContentBlock {
                text,
                heading_level,
            });
        }
    }
    Ok(sections)
}

fn pdf_page_fragments(page_text: &[String]) -> Vec<String> {
    page_text
        .iter()
        .map(|value| normalize_whitespace(value))
        .filter(|value| value.len() > 2)
        .collect()
}

fn classify_pdf_content(page_fragments: &[String], page_count: usize) -> (String, Option<String>) {
    if page_fragments.is_empty() {
        return (
            "unavailable".into(),
            Some("This PDF can be read by page, but no reliable text layer is available.".into()),
        );
    }

    if page_count > 1 && page_fragments.len() < page_count {
        return (
            "partial".into(),
            Some("This PDF has partial extracted text. Page reading remains available, but text features are limited.".into()),
        );
    }

    ("ready".into(), None)
}

fn read_pdf_metadata(pdf: &PdfDocument, fallback_title: &str) -> InferredMetadata {
    let info = pdf
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|object| match object {
            Object::Reference(id) => pdf.get_dictionary(*id).ok().cloned(),
            Object::Dictionary(dict) => Some(dict.clone()),
            _ => None,
        });
    let title = info
        .as_ref()
        .and_then(|dict| pdf_info_string(dict, b"Title"))
        .unwrap_or_else(|| fallback_title.to_string());
    let authors = info
        .as_ref()
        .and_then(|dict| pdf_info_string(dict, b"Author"))
        .unwrap_or_else(|| "Imported Author".into());
    let publication_year = info
        .as_ref()
        .and_then(|dict| pdf_info_string(dict, b"CreationDate"))
        .and_then(|value| {
            Regex::new(r"D:(\d{4})")
                .ok()?
                .captures(&value)
                .and_then(|captures| captures.get(1))
                .and_then(|year| year.as_str().parse::<i64>().ok())
        });

    InferredMetadata {
        title: Some(title),
        authors,
        publication_year,
        source: "Imported PDF".into(),
        doi: None,
    }
}

fn pdf_info_string(dict: &Dictionary, key: &[u8]) -> Option<String> {
    let object = dict.get(key).ok()?;
    match object {
        Object::String(value, _) => Some(normalize_whitespace(&String::from_utf8_lossy(value))),
        Object::Name(value) => Some(normalize_whitespace(&String::from_utf8_lossy(value))),
        _ => None,
    }
}

fn article_from_paragraphs(title: &str, paragraphs: &[String]) -> String {
    let body = if paragraphs.is_empty() {
        "<p>No readable content was extracted.</p>".to_string()
    } else {
        paragraphs
            .iter()
            .map(|paragraph| format!("<p>{}</p>", encode_safe(paragraph)))
            .collect::<Vec<_>>()
            .join("")
    };
    format!("<article><h1>{}</h1>{}</article>", encode_safe(title), body)
}

fn title_from_slug(value: &str) -> String {
    value
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(|chunk| {
            let mut chars = chunk.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn join_plain_text(parts: &[String]) -> String {
    if parts.is_empty() {
        String::new()
    } else {
        parts.join("\n\n")
    }
}

fn wrap_as_article(title: &str, body: &str) -> String {
    article_from_paragraphs(title, &[body.to_string()])
}

fn resolve_relative_path(base: &str, relative: &str) -> String {
    let base = Path::new(base);
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    parent.join(relative).to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: i64, collection_id: i64) -> LibraryItem {
        LibraryItem {
            id,
            title: format!("Paper {id}"),
            collection_id,
            primary_attachment_id: id + 100,
            attachment_format: "pdf".to_string(),
            attachment_status: "ready".to_string(),
            authors: String::new(),
            publication_year: None,
            source: String::new(),
            doi: None,
            tags: Vec::new(),
        }
    }

    fn reference(
        kind: AISessionReferenceKind,
        target_id: i64,
        sort_index: i64,
    ) -> AISessionReference {
        AISessionReference {
            id: sort_index + 1,
            session_id: 1,
            kind,
            target_id,
            sort_index,
        }
    }

    #[test]
    fn expands_item_references_before_collection_references() {
        let collections = vec![
            Collection {
                id: 1,
                name: "Root".to_string(),
                parent_id: None,
            },
            Collection {
                id: 2,
                name: "Child".to_string(),
                parent_id: Some(1),
            },
        ];
        let items = vec![item(10, 1), item(11, 1), item(12, 2)];
        let references = vec![
            reference(AISessionReferenceKind::Item, 12, 0),
            reference(AISessionReferenceKind::Collection, 1, 1),
        ];

        assert_eq!(
            expand_session_reference_item_ids(&references, &collections, &items),
            vec![12, 11, 10]
        );
    }

    #[test]
    fn expands_collection_children_by_name_and_items_by_recent_id() {
        let collections = vec![
            Collection {
                id: 1,
                name: "Root".to_string(),
                parent_id: None,
            },
            Collection {
                id: 2,
                name: "Beta".to_string(),
                parent_id: Some(1),
            },
            Collection {
                id: 3,
                name: "Alpha".to_string(),
                parent_id: Some(1),
            },
            Collection {
                id: 4,
                name: "Grandchild".to_string(),
                parent_id: Some(3),
            },
        ];
        let items = vec![
            item(10, 1),
            item(11, 3),
            item(12, 3),
            item(13, 4),
            item(14, 2),
        ];
        let references = vec![reference(AISessionReferenceKind::Collection, 1, 0)];

        assert_eq!(
            expand_session_reference_item_ids(&references, &collections, &items),
            vec![10, 12, 11, 13, 14]
        );
    }

    #[test]
    fn skips_missing_and_duplicate_reference_targets() {
        let collections = vec![Collection {
            id: 1,
            name: "Root".to_string(),
            parent_id: None,
        }];
        let items = vec![item(10, 1)];
        let references = vec![
            reference(AISessionReferenceKind::Item, 99, 0),
            reference(AISessionReferenceKind::Item, 10, 1),
            reference(AISessionReferenceKind::Collection, 1, 2),
        ];

        assert_eq!(
            expand_session_reference_item_ids(&references, &collections, &items),
            vec![10]
        );
    }
}
