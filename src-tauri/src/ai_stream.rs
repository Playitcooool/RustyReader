use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct AITaskStreamEvent {
    stream_id: String,
    scope: String,
    session_id: Option<i64>,
    item_id: Option<i64>,
    collection_id: Option<i64>,
    scope_item_ids: Option<Vec<i64>>,
    kind: String,
    phase: String,
    task_id: Option<i64>,
    input_prompt: Option<String>,
    delta_markdown: Option<String>,
    full_markdown: Option<String>,
    error: Option<String>,
}

pub fn split_markdown_chunks(markdown: &str) -> Vec<String> {
    const MAX_CHUNK_CHARS: usize = 220;
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    let mut chunks = Vec::new();
    for paragraph in trimmed.split("\n\n") {
        if paragraph.len() <= MAX_CHUNK_CHARS {
            chunks.push(paragraph.to_string());
            continue;
        }

        let mut current = String::new();
        for sentence in paragraph.split_inclusive(['.', '!', '?', '\n']) {
            if current.len() + sentence.len() > MAX_CHUNK_CHARS && !current.is_empty() {
                chunks.push(current.trim_end().to_string());
                current.clear();
            }
            if sentence.len() > MAX_CHUNK_CHARS {
                let bytes = sentence.as_bytes();
                let mut start = 0;
                while start < bytes.len() {
                    let end = usize::min(start + MAX_CHUNK_CHARS, bytes.len());
                    let piece = sentence[start..end].trim();
                    if !piece.is_empty() {
                        chunks.push(piece.to_string());
                    }
                    start = end;
                }
            } else {
                current.push_str(sentence);
            }
        }
        if !current.trim().is_empty() {
            chunks.push(current.trim_end().to_string());
        }
    }

    chunks
}

#[allow(clippy::too_many_arguments)]
pub fn emit_ai_task_stream(
    app_handle: &AppHandle,
    stream_id: &str,
    scope: &str,
    session_id: Option<i64>,
    item_id: Option<i64>,
    collection_id: Option<i64>,
    scope_item_ids: Option<Vec<i64>>,
    kind: &str,
    phase: &str,
    task_id: Option<i64>,
    input_prompt: Option<String>,
    delta_markdown: Option<String>,
    full_markdown: Option<String>,
    error: Option<String>,
) {
    let _ = app_handle.emit(
        "ai-task-stream",
        AITaskStreamEvent {
            stream_id: stream_id.to_string(),
            scope: scope.to_string(),
            session_id,
            item_id,
            collection_id,
            scope_item_ids,
            kind: kind.to_string(),
            phase: phase.to_string(),
            task_id,
            input_prompt,
            delta_markdown,
            full_markdown,
            error,
        },
    );
}
