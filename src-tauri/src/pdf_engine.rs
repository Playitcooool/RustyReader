use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, OnceLock},
};

use lopdf::{Dictionary, Document as LopdfDocument, Object, ObjectId};
use pdf_oxide::{
    document::PdfDocument as OxidePdfDocument,
    rendering::{render_page, ImageFormat, RenderOptions},
};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Semaphore;

use crate::state::{service_for_root, AppState};

pub(crate) static PDF_RENDER_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfTextSpan {
    pub(crate) text: String,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfPageBundle {
    png_bytes: Vec<u8>,
    width_px: u32,
    height_px: u32,
    page_width_pt: f32,
    page_height_pt: f32,
    spans: Vec<PdfTextSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfPageInfo {
    width_pt: f32,
    height_pt: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfDocumentInfo {
    page_count: usize,
    pages: Vec<PdfPageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PdfOutlineItem {
    id: String,
    title: String,
    page_index0: i64,
    children: Vec<PdfOutlineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfInitialPageBundle {
    document_info: PdfDocumentInfo,
    bundle: PdfPageBundle,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetPageBundleInput {
    primary_attachment_id: i64,
    page_index0: i64,
    target_width_px: u32,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetDocumentInfoInput {
    primary_attachment_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetOutlineInput {
    primary_attachment_id: i64,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetPageTextInput {
    primary_attachment_id: i64,
    page_index0: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfPageText {
    page_index0: i64,
    spans: Vec<PdfTextSpan>,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetPageBundlesBatchInput {
    primary_attachment_id: i64,
    page_indexes0: Vec<i64>,
    target_width_px: u32,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineGetPageTextsBatchInput {
    primary_attachment_id: i64,
    page_indexes0: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfSearchMatch {
    page_index0: i64,
    span_index: usize,
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PdfSearchResult {
    total: usize,
    matches: Vec<PdfSearchMatch>,
}

#[derive(Deserialize)]
pub(crate) struct PdfEngineSearchInput {
    primary_attachment_id: i64,
    query: String,
    max_matches: Option<usize>,
}

#[derive(Default)]
pub(crate) struct PdfEngineCache {
    pub(crate) document_info_by_attachment: HashMap<i64, PdfDocumentInfo>,
    pub(crate) outline_by_attachment: HashMap<i64, Vec<PdfOutlineItem>>,
    pub(crate) text_spans_by_page: HashMap<(i64, i64), Vec<PdfTextSpan>>,
    text_spans_order: VecDeque<(i64, i64)>,
    pub(crate) bundle_by_key: HashMap<(i64, i64, u32), PdfPageBundle>,
    bundle_order: VecDeque<(i64, i64, u32)>,
    bundle_total_bytes: usize,
    search_cache_by_query: HashMap<(i64, String), PdfSearchResult>,
    search_order: VecDeque<(i64, String)>,
}

const PDF_TEXT_PAGE_CACHE_LIMIT: usize = 64;
const PDF_BUNDLE_CACHE_ENTRY_LIMIT: usize = 24;
const PDF_BUNDLE_CACHE_BYTES_LIMIT: usize = 96 * 1024 * 1024;
const MAX_BUNDLE_BATCH: usize = 4;
const MAX_TEXT_BATCH: usize = 16;
const SEARCH_CACHE_LIMIT: usize = 8;

fn remember_search_result(cache: &mut PdfEngineCache, key: (i64, String), result: PdfSearchResult) {
    cache.search_cache_by_query.insert(key.clone(), result);
    cache.search_order.retain(|existing| existing != &key);
    cache.search_order.push_back(key);
    while cache.search_order.len() > SEARCH_CACHE_LIMIT {
        if let Some(oldest) = cache.search_order.pop_front() {
            cache.search_cache_by_query.remove(&oldest);
        }
    }
}

fn normalized_query(input: &str) -> String {
    input.trim().to_lowercase()
}

fn outline_dict_from_object<'a>(doc: &'a LopdfDocument, object: &'a Object) -> Option<&'a Dictionary> {
    match object {
        Object::Dictionary(dictionary) => Some(dictionary),
        Object::Reference(object_id) => doc.get_dictionary(*object_id).ok(),
        _ => None,
    }
}

fn outline_page_index_from_destination(
    doc: &LopdfDocument,
    destination: &Object,
    page_index_by_id: &HashMap<ObjectId, i64>,
) -> Option<i64> {
    match destination {
        Object::Array(items) => items
            .first()
            .and_then(|page| page.as_reference().ok())
            .and_then(|page_id| page_index_by_id.get(&page_id).copied()),
        Object::Reference(object_id) => doc
            .get_object(*object_id)
            .ok()
            .and_then(|object| outline_page_index_from_destination(doc, object, page_index_by_id)),
        _ => None,
    }
}

fn outline_page_index_for_node(
    doc: &LopdfDocument,
    node: &Dictionary,
    page_index_by_id: &HashMap<ObjectId, i64>,
) -> Option<i64> {
    if let Ok(destination) = node.get(b"Dest") {
        return outline_page_index_from_destination(doc, destination, page_index_by_id);
    }
    let action = node.get(b"A").ok().and_then(|object| outline_dict_from_object(doc, object))?;
    if action.get(b"S").ok()?.as_name().ok()? != b"GoTo" {
        return None;
    }
    outline_page_index_from_destination(doc, action.get(b"D").ok()?, page_index_by_id)
}

fn decode_pdf_outline_title(bytes: &[u8]) -> String {
    if bytes.starts_with(b"\xFE\xFF") {
        let units = bytes[2..]
            .chunks(2)
            .filter_map(|chunk| {
                if chunk.len() == 2 {
                    Some(u16::from_be_bytes([chunk[0], chunk[1]]))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&units)
    } else if bytes.starts_with(b"\xEF\xBB\xBF") {
        String::from_utf8_lossy(&bytes[3..]).to_string()
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn outline_title_for_node(node: &Dictionary) -> Option<String> {
    let title = decode_pdf_outline_title(node.get(b"Title").ok()?.as_str().ok()?);
    let title = title.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn collect_outline_items(
    doc: &LopdfDocument,
    first: Object,
    page_index_by_id: &HashMap<ObjectId, i64>,
    prefix: String,
    visited: &mut HashSet<ObjectId>,
) -> Vec<PdfOutlineItem> {
    let mut items = Vec::new();
    let mut current = Some(first);
    let mut sibling_index = 0usize;

    while let Some(object) = current {
        let reference = object.as_reference().ok();
        if let Some(object_id) = reference {
            if !visited.insert(object_id) {
                break;
            }
        }

        let Some(node) = outline_dict_from_object(doc, &object) else {
            break;
        };
        let item_path = if prefix.is_empty() {
            sibling_index.to_string()
        } else {
            format!("{prefix}-{sibling_index}")
        };
        let children = node
            .get(b"First")
            .ok()
            .cloned()
            .map(|first_child| collect_outline_items(doc, first_child, page_index_by_id, item_path.clone(), visited))
            .unwrap_or_default();

        if let (Some(title), Some(page_index0)) = (
            outline_title_for_node(node),
            outline_page_index_for_node(doc, node, page_index_by_id),
        ) {
            items.push(PdfOutlineItem {
                id: format!("outline-{item_path}"),
                title,
                page_index0,
                children,
            });
        } else {
            items.extend(children);
        }

        current = node.get(b"Next").ok().cloned();
        sibling_index += 1;
    }

    items
}

fn extract_pdf_outline(bytes: &[u8]) -> Result<Vec<PdfOutlineItem>, String> {
    let doc = LopdfDocument::load_mem(bytes).map_err(|error| error.to_string())?;
    let page_index_by_id = doc
        .get_pages()
        .into_iter()
        .map(|(page_number, object_id)| (object_id, i64::from(page_number.saturating_sub(1))))
        .collect::<HashMap<_, _>>();
    let catalog = doc.catalog().map_err(|error| error.to_string())?;
    let Some(outlines) = catalog
        .get(b"Outlines")
        .ok()
        .and_then(|object| outline_dict_from_object(&doc, object))
    else {
        return Ok(Vec::new());
    };
    let Some(first) = outlines.get(b"First").ok().cloned() else {
        return Ok(Vec::new());
    };
    Ok(collect_outline_items(
        &doc,
        first,
        &page_index_by_id,
        String::new(),
        &mut HashSet::new(),
    ))
}

fn unique_preserve_order(page_indexes0: &[i64]) -> Result<Vec<i64>, String> {
    let mut seen = HashMap::<i64, ()>::new();
    let mut unique = Vec::new();
    for index0 in page_indexes0 {
        if *index0 < 0 {
            return Err("invalid page index".to_string());
        }
        if seen.contains_key(index0) {
            continue;
        }
        seen.insert(*index0, ());
        unique.push(*index0);
    }
    Ok(unique)
}

fn remember_text_spans(cache: &mut PdfEngineCache, key: (i64, i64), spans: Vec<PdfTextSpan>) {
    cache.text_spans_by_page.insert(key, spans);
    cache.text_spans_order.retain(|existing| existing != &key);
    cache.text_spans_order.push_back(key);
    while cache.text_spans_order.len() > PDF_TEXT_PAGE_CACHE_LIMIT {
        if let Some(oldest) = cache.text_spans_order.pop_front() {
            cache.text_spans_by_page.remove(&oldest);
        }
    }
}

fn collect_search_matches_for_page(
    page_index0: i64,
    spans: &[PdfTextSpan],
    q: &str,
    max_remaining: usize,
) -> Vec<PdfSearchMatch> {
    let mut matches = Vec::new();
    if q.is_empty() || max_remaining == 0 {
        return matches;
    }

    for (span_index, span) in spans.iter().enumerate() {
        let hay = span.text.to_lowercase();
        let mut cursor = 0;
        while cursor < hay.len() {
            let Some(pos) = hay[cursor..].find(q) else {
                break;
            };
            let start = cursor + pos;
            let end = start + q.len();
            matches.push(PdfSearchMatch {
                page_index0,
                span_index,
                start,
                end,
            });
            if matches.len() >= max_remaining {
                return matches;
            }
            cursor = start + q.len().max(1);
        }
    }

    matches
}

fn bundle_weight(bundle: &PdfPageBundle) -> usize {
    let span_text_bytes = bundle
        .spans
        .iter()
        .map(|span| span.text.len() + std::mem::size_of::<PdfTextSpan>())
        .sum::<usize>();
    bundle.png_bytes.len() + span_text_bytes
}

fn remember_page_bundle(cache: &mut PdfEngineCache, key: (i64, i64, u32), bundle: PdfPageBundle) {
    if let Some(previous) = cache.bundle_by_key.remove(&key) {
        cache.bundle_total_bytes = cache
            .bundle_total_bytes
            .saturating_sub(bundle_weight(&previous));
        cache.bundle_order.retain(|existing| existing != &key);
    }
    cache.bundle_total_bytes = cache
        .bundle_total_bytes
        .saturating_add(bundle_weight(&bundle));
    cache.bundle_by_key.insert(key, bundle);
    cache.bundle_order.push_back(key);

    while cache.bundle_order.len() > PDF_BUNDLE_CACHE_ENTRY_LIMIT
        || cache.bundle_total_bytes > PDF_BUNDLE_CACHE_BYTES_LIMIT
    {
        let Some(oldest) = cache.bundle_order.pop_front() else {
            break;
        };
        if let Some(removed) = cache.bundle_by_key.remove(&oldest) {
            cache.bundle_total_bytes = cache
                .bundle_total_bytes
                .saturating_sub(bundle_weight(&removed));
        }
    }
}

fn width_bucket(width_px: u32) -> u32 {
    let bucket = 64;
    width_px.div_ceil(bucket) * bucket
}

fn spans_from_document(
    doc: &OxidePdfDocument,
    page_index: usize,
) -> Result<Vec<PdfTextSpan>, String> {
    let spans_raw = doc
        .extract_spans(page_index)
        .map_err(|error| error.to_string())?;
    let mut spans: Vec<PdfTextSpan> = Vec::with_capacity(spans_raw.len());
    for span in spans_raw {
        let text = span.text;
        if text.trim().is_empty() {
            continue;
        }
        let x0 = span.bbox.x;
        let y0 = span.bbox.y;
        let x1 = x0 + span.bbox.width;
        let y1 = y0 + span.bbox.height;
        spans.push(PdfTextSpan {
            text,
            x0,
            y0,
            x1,
            y1,
        });
    }
    Ok(spans)
}

#[cfg(test)]
fn document_info_from_document(doc: &OxidePdfDocument) -> Result<PdfDocumentInfo, String> {
    let page_count = doc.page_count().map_err(|error| error.to_string())?;
    let mut pages = Vec::with_capacity(page_count);
    for page_index in 0..page_count {
        let page_info = doc
            .get_page_info(page_index)
            .map_err(|error| error.to_string())?;
        pages.push(PdfPageInfo {
            width_pt: page_info.media_box.width,
            height_pt: page_info.media_box.height,
        });
    }
    Ok(PdfDocumentInfo { page_count, pages })
}

fn quick_document_info_from_document(
    doc: &OxidePdfDocument,
    page_index: usize,
) -> Result<PdfDocumentInfo, String> {
    let page_count = doc.page_count().map_err(|error| error.to_string())?;
    if page_count == 0 {
        return Ok(PdfDocumentInfo {
            page_count,
            pages: Vec::new(),
        });
    }
    let bounded_page_index = page_index.min(page_count - 1);
    let page_info = doc
        .get_page_info(bounded_page_index)
        .map_err(|error| error.to_string())?;
    Ok(PdfDocumentInfo {
        page_count,
        pages: vec![PdfPageInfo {
            width_pt: page_info.media_box.width,
            height_pt: page_info.media_box.height,
        }],
    })
}

fn render_page_bundle_from_document(
    doc: &mut OxidePdfDocument,
    page_index: usize,
    bucketed_width: u32,
    spans: Option<Vec<PdfTextSpan>>,
) -> Result<PdfPageBundle, String> {
    let page_info = doc
        .get_page_info(page_index)
        .map_err(|error| error.to_string())?;

    let page_width_pt = page_info.media_box.width;
    let page_height_pt = page_info.media_box.height;
    if !(page_width_pt.is_finite()
        && page_height_pt.is_finite()
        && page_width_pt > 0.0
        && page_height_pt > 0.0)
    {
        return Err("invalid page size".to_string());
    }

    let dpi = ((bucketed_width as f32) * 72.0 / page_width_pt)
        .clamp(36.0, 600.0)
        .round() as u32;
    let opts = RenderOptions {
        dpi,
        format: ImageFormat::Png,
        ..Default::default()
    };
    let rendered = render_page(doc, page_index, &opts).map_err(|error| error.to_string())?;
    let spans = match spans {
        Some(spans) => spans,
        None => spans_from_document(doc, page_index)?,
    };

    Ok(PdfPageBundle {
        png_bytes: rendered.data,
        width_px: rendered.width,
        height_px: rendered.height,
        page_width_pt,
        page_height_pt,
        spans,
    })
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_document_info(
    state: State<'_, AppState>,
    input: PdfEngineGetDocumentInfoInput,
) -> Result<PdfDocumentInfo, String> {
    if let Some(cached) = state
        .pdf_cache
        .lock()
        .map_err(|_| "pdf cache poisoned".to_string())?
        .document_info_by_attachment
        .get(&input.primary_attachment_id)
        .cloned()
    {
        return Ok(cached);
    }

    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;
        let doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
        let info = quick_document_info_from_document(&doc, 0)?;
        pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?
            .document_info_by_attachment
            .insert(input.primary_attachment_id, info.clone());
        Ok(info)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_outline(
    state: State<'_, AppState>,
    input: PdfEngineGetOutlineInput,
) -> Result<Vec<PdfOutlineItem>, String> {
    if let Some(cached) = state
        .pdf_cache
        .lock()
        .map_err(|_| "pdf cache poisoned".to_string())?
        .outline_by_attachment
        .get(&input.primary_attachment_id)
        .cloned()
    {
        return Ok(cached);
    }

    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;
        let outline = extract_pdf_outline(&bytes)?;
        pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?
            .outline_by_attachment
            .insert(input.primary_attachment_id, outline.clone());
        Ok(outline)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_page_text(
    state: State<'_, AppState>,
    input: PdfEngineGetPageTextInput,
) -> Result<PdfPageText, String> {
    if input.page_index0 < 0 {
        return Err("invalid page index".to_string());
    }
    if let Some(cached) = state
        .pdf_cache
        .lock()
        .map_err(|_| "pdf cache poisoned".to_string())?
        .text_spans_by_page
        .get(&(input.primary_attachment_id, input.page_index0))
        .cloned()
    {
        return Ok(PdfPageText {
            page_index0: input.page_index0,
            spans: cached,
        });
    }

    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;
        let doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
        let page_index: usize =
            usize::try_from(input.page_index0).map_err(|_| "invalid page index")?;
        let spans = spans_from_document(&doc, page_index)?;
        let mut cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        remember_text_spans(
            &mut cache,
            (input.primary_attachment_id, input.page_index0),
            spans.clone(),
        );
        Ok(PdfPageText {
            page_index0: input.page_index0,
            spans,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_initial_page_bundle(
    state: State<'_, AppState>,
    input: PdfEngineGetPageBundleInput,
) -> Result<PdfInitialPageBundle, String> {
    if input.page_index0 < 0 {
        return Err("invalid page index".to_string());
    }
    let target_width_px = input.target_width_px.clamp(1, 8192);
    let bucketed_width = width_bucket(target_width_px);

    let cached_bundle = {
        let cache = state
            .pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        cache
            .bundle_by_key
            .get(&(
                input.primary_attachment_id,
                input.page_index0,
                bucketed_width,
            ))
            .cloned()
            .and_then(|bundle| {
                cache
                    .document_info_by_attachment
                    .get(&input.primary_attachment_id)
                    .cloned()
                    .map(|document_info| PdfInitialPageBundle {
                        document_info,
                        bundle,
                    })
            })
    };
    if let Some(cached) = cached_bundle {
        return Ok(cached);
    }

    let semaphore = PDF_RENDER_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone();
    let permit = semaphore
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;
    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;
        let mut doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
        let page_index: usize =
            usize::try_from(input.page_index0).map_err(|_| "invalid page index")?;
        let document_info = quick_document_info_from_document(&doc, page_index)?;

        let cached_spans = {
            let cache = pdf_cache
                .lock()
                .map_err(|_| "pdf cache poisoned".to_string())?;
            cache
                .text_spans_by_page
                .get(&(input.primary_attachment_id, input.page_index0))
                .cloned()
        };
        let bundle =
            render_page_bundle_from_document(&mut doc, page_index, bucketed_width, cached_spans)?;

        let mut cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        cache
            .document_info_by_attachment
            .insert(input.primary_attachment_id, document_info.clone());
        remember_text_spans(
            &mut cache,
            (input.primary_attachment_id, input.page_index0),
            bundle.spans.clone(),
        );
        remember_page_bundle(
            &mut cache,
            (
                input.primary_attachment_id,
                input.page_index0,
                bucketed_width,
            ),
            bundle.clone(),
        );

        Ok(PdfInitialPageBundle {
            document_info,
            bundle,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_page_bundle(
    state: State<'_, AppState>,
    input: PdfEngineGetPageBundleInput,
) -> Result<PdfPageBundle, String> {
    if input.page_index0 < 0 {
        return Err("invalid page index".to_string());
    }
    let target_width_px = input.target_width_px.clamp(1, 8192);
    let bucketed_width = width_bucket(target_width_px);
    if let Some(cached) = state
        .pdf_cache
        .lock()
        .map_err(|_| "pdf cache poisoned".to_string())?
        .bundle_by_key
        .get(&(
            input.primary_attachment_id,
            input.page_index0,
            bucketed_width,
        ))
        .cloned()
    {
        return Ok(cached);
    }

    let semaphore = PDF_RENDER_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone();
    let permit = semaphore
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;
    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;

        let mut doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
        let page_index: usize =
            usize::try_from(input.page_index0).map_err(|_| "invalid page index")?;

        let spans = if let Some(cached) = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?
            .text_spans_by_page
            .get(&(input.primary_attachment_id, input.page_index0))
            .cloned()
        {
            cached
        } else {
            spans_from_document(&doc, page_index)?
        };
        let bundle = render_page_bundle_from_document(
            &mut doc,
            page_index,
            bucketed_width,
            Some(spans.clone()),
        )?;

        let mut cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        remember_text_spans(
            &mut cache,
            (input.primary_attachment_id, input.page_index0),
            spans,
        );
        remember_page_bundle(
            &mut cache,
            (
                input.primary_attachment_id,
                input.page_index0,
                bucketed_width,
            ),
            bundle.clone(),
        );
        Ok(bundle)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_page_bundles_batch(
    state: State<'_, AppState>,
    input: PdfEngineGetPageBundlesBatchInput,
) -> Result<Vec<PdfPageBundle>, String> {
    if input.page_indexes0.is_empty() {
        return Ok(Vec::new());
    }
    if input.page_indexes0.len() > MAX_BUNDLE_BATCH {
        return Err("too many pages in batch".to_string());
    }
    let target_width_px = input.target_width_px.clamp(1, 8192);
    let bucketed_width = width_bucket(target_width_px);
    let unique = unique_preserve_order(&input.page_indexes0)?;

    // Fast path: if all cached, return immediately.
    let cached_all = {
        let cache = state
            .pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        unique.iter().all(|page_index0| {
            cache.bundle_by_key.contains_key(&(
                input.primary_attachment_id,
                *page_index0,
                bucketed_width,
            ))
        })
    };
    if cached_all {
        let cache = state
            .pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        let mut by_page: HashMap<i64, PdfPageBundle> = HashMap::new();
        for page_index0 in &unique {
            if let Some(bundle) = cache
                .bundle_by_key
                .get(&(input.primary_attachment_id, *page_index0, bucketed_width))
                .cloned()
            {
                by_page.insert(*page_index0, bundle);
            }
        }
        return Ok(input
            .page_indexes0
            .iter()
            .filter_map(|page_index0| by_page.get(page_index0).cloned())
            .collect());
    }

    let semaphore = PDF_RENDER_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone();
    let permit = semaphore
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;
    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;

        // Determine which pages are missing without holding the lock during heavy work.
        let missing: Vec<i64> = {
            let cache = pdf_cache
                .lock()
                .map_err(|_| "pdf cache poisoned".to_string())?;
            unique
                .iter()
                .copied()
                .filter(|page_index0| {
                    !cache.bundle_by_key.contains_key(&(
                        input.primary_attachment_id,
                        *page_index0,
                        bucketed_width,
                    ))
                })
                .collect()
        };

        if !missing.is_empty() {
            let bytes = service_for_root(&library_root)?
                .read_primary_attachment_bytes(input.primary_attachment_id)
                .map_err(|error| error.to_string())?;
            let mut doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;

            for page_index0 in &missing {
                let page_index: usize =
                    usize::try_from(*page_index0).map_err(|_| "invalid page index")?;
                let page_info = doc
                    .get_page_info(page_index)
                    .map_err(|error| error.to_string())?;
                let page_width_pt = page_info.media_box.width;
                let page_height_pt = page_info.media_box.height;
                if !(page_width_pt.is_finite()
                    && page_height_pt.is_finite()
                    && page_width_pt > 0.0
                    && page_height_pt > 0.0)
                {
                    return Err("invalid page size".to_string());
                }

                let dpi = ((bucketed_width as f32) * 72.0 / page_width_pt)
                    .clamp(36.0, 600.0)
                    .round() as u32;
                let opts = RenderOptions {
                    dpi,
                    format: ImageFormat::Png,
                    ..Default::default()
                };
                let rendered =
                    render_page(&mut doc, page_index, &opts).map_err(|error| error.to_string())?;

                let cached_spans = {
                    let cache = pdf_cache
                        .lock()
                        .map_err(|_| "pdf cache poisoned".to_string())?;
                    cache
                        .text_spans_by_page
                        .get(&(input.primary_attachment_id, *page_index0))
                        .cloned()
                };
                let spans = match cached_spans {
                    Some(spans) => spans,
                    None => spans_from_document(&doc, page_index)
                        .map_err(|error| format!("failed to extract PDF text spans: {error}"))?,
                };

                let bundle = PdfPageBundle {
                    png_bytes: rendered.data,
                    width_px: rendered.width,
                    height_px: rendered.height,
                    page_width_pt,
                    page_height_pt,
                    spans: spans.clone(),
                };

                let mut cache = pdf_cache
                    .lock()
                    .map_err(|_| "pdf cache poisoned".to_string())?;
                remember_text_spans(
                    &mut cache,
                    (input.primary_attachment_id, *page_index0),
                    spans,
                );
                remember_page_bundle(
                    &mut cache,
                    (input.primary_attachment_id, *page_index0, bucketed_width),
                    bundle,
                );
            }
        }

        // Collect results in input order (including duplicates).
        let cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        let mut by_page: HashMap<i64, PdfPageBundle> = HashMap::new();
        for page_index0 in &unique {
            if let Some(bundle) = cache
                .bundle_by_key
                .get(&(input.primary_attachment_id, *page_index0, bucketed_width))
                .cloned()
            {
                by_page.insert(*page_index0, bundle);
            }
        }
        Ok(input
            .page_indexes0
            .iter()
            .filter_map(|page_index0| by_page.get(page_index0).cloned())
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_get_page_texts_batch(
    state: State<'_, AppState>,
    input: PdfEngineGetPageTextsBatchInput,
) -> Result<Vec<PdfPageText>, String> {
    if input.page_indexes0.is_empty() {
        return Ok(Vec::new());
    }
    if input.page_indexes0.len() > MAX_TEXT_BATCH {
        return Err("too many pages in batch".to_string());
    }
    let unique = unique_preserve_order(&input.page_indexes0)?;

    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let missing: Vec<i64> = {
            let cache = pdf_cache
                .lock()
                .map_err(|_| "pdf cache poisoned".to_string())?;
            unique
                .iter()
                .copied()
                .filter(|page_index0| {
                    !cache
                        .text_spans_by_page
                        .contains_key(&(input.primary_attachment_id, *page_index0))
                })
                .collect()
        };

        if !missing.is_empty() {
            let bytes = service_for_root(&library_root)?
                .read_primary_attachment_bytes(input.primary_attachment_id)
                .map_err(|error| error.to_string())?;
            let doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
            for page_index0 in &missing {
                let page_index: usize =
                    usize::try_from(*page_index0).map_err(|_| "invalid page index")?;
                let spans = spans_from_document(&doc, page_index)?;
                let mut cache = pdf_cache
                    .lock()
                    .map_err(|_| "pdf cache poisoned".to_string())?;
                remember_text_spans(
                    &mut cache,
                    (input.primary_attachment_id, *page_index0),
                    spans,
                );
            }
        }

        let cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        let mut by_page: HashMap<i64, Vec<PdfTextSpan>> = HashMap::new();
        for page_index0 in &unique {
            if let Some(spans) = cache
                .text_spans_by_page
                .get(&(input.primary_attachment_id, *page_index0))
                .cloned()
            {
                by_page.insert(*page_index0, spans);
            }
        }

        Ok(input
            .page_indexes0
            .iter()
            .filter_map(|page_index0| {
                by_page.get(page_index0).cloned().map(|spans| PdfPageText {
                    page_index0: *page_index0,
                    spans,
                })
            })
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn pdf_engine_search(
    state: State<'_, AppState>,
    input: PdfEngineSearchInput,
) -> Result<PdfSearchResult, String> {
    let q = normalized_query(&input.query);
    if q.is_empty() {
        return Ok(PdfSearchResult {
            total: 0,
            matches: Vec::new(),
        });
    }

    if let Some(cached) = state
        .pdf_cache
        .lock()
        .map_err(|_| "pdf cache poisoned".to_string())?
        .search_cache_by_query
        .get(&(input.primary_attachment_id, q.clone()))
        .cloned()
    {
        return Ok(cached);
    }

    let max_matches = input.max_matches.unwrap_or(5_000).clamp(1, 50_000);
    let library_root = state.library_root.clone();
    let pdf_cache = state.pdf_cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = service_for_root(&library_root)?
            .read_primary_attachment_bytes(input.primary_attachment_id)
            .map_err(|error| error.to_string())?;
        let doc = OxidePdfDocument::from_bytes(bytes).map_err(|error| error.to_string())?;
        let page_count = doc.page_count().map_err(|error| error.to_string())?;

        let mut matches: Vec<PdfSearchMatch> = Vec::new();
        for page_index in 0..page_count {
            let page_index0 = page_index as i64;
            let cache_key = (input.primary_attachment_id, page_index0);
            let cached_spans = {
                let cache = pdf_cache
                    .lock()
                    .map_err(|_| "pdf cache poisoned".to_string())?;
                cache.text_spans_by_page.get(&cache_key).cloned()
            };
            let spans = match cached_spans {
                Some(spans) => spans,
                None => {
                    let spans = spans_from_document(&doc, page_index)?;
                    let mut cache = pdf_cache
                        .lock()
                        .map_err(|_| "pdf cache poisoned".to_string())?;
                    remember_text_spans(&mut cache, cache_key, spans.clone());
                    spans
                }
            };
            let remaining = max_matches.saturating_sub(matches.len());
            matches.extend(collect_search_matches_for_page(
                page_index0,
                &spans,
                &q,
                remaining,
            ));
            if matches.len() >= max_matches {
                break;
            }
        }

        let result = PdfSearchResult {
            total: matches.len(),
            matches,
        };

        let mut cache = pdf_cache
            .lock()
            .map_err(|_| "pdf cache poisoned".to_string())?;
        remember_search_result(&mut cache, (input.primary_attachment_id, q), result.clone());
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;
    use lopdf::{Dictionary, Document, Object, Stream};

    fn push_page(
        doc: &mut Document,
        pages_id: lopdf::ObjectId,
        width_pt: f32,
        height_pt: f32,
    ) -> lopdf::ObjectId {
        let content = Stream::new(
            Dictionary::new(),
            b"BT /F1 12 Tf 72 720 Td (Test) Tj ET".to_vec(),
        );
        let content_id = doc.add_object(content);
        doc.add_object(lopdf::dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), width_pt.into(), height_pt.into()],
            "Contents" => content_id,
            "Resources" => lopdf::dictionary! {
                "Font" => lopdf::dictionary! {
                    "F1" => lopdf::dictionary! {
                        "Type" => "Font",
                        "Subtype" => "Type1",
                        "BaseFont" => "Helvetica",
                    }
                }
            }
        })
    }

    fn make_two_page_pdf_with_distinct_sizes() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_one_id = push_page(&mut doc, pages_id, 612.0, 792.0);
        let page_two_id = push_page(&mut doc, pages_id, 420.0, 595.0);
        let catalog_id = doc.add_object(lopdf::dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });

        doc.objects.insert(
            pages_id,
            Object::Dictionary(lopdf::dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_one_id.into(), page_two_id.into()],
                "Count" => 2,
            }),
        );
        doc.trailer.set("Root", catalog_id);

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("test pdf should serialize");
        bytes
    }

    fn make_pdf_with_outline() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_one_id = push_page(&mut doc, pages_id, 612.0, 792.0);
        let page_two_id = push_page(&mut doc, pages_id, 612.0, 792.0);
        let outline_root_id = doc.new_object_id();
        let intro_id = doc.new_object_id();
        let methods_id = doc.new_object_id();
        let child_id = doc.new_object_id();
        let remote_id = doc.new_object_id();
        let unresolved_id = doc.new_object_id();
        let catalog_id = doc.add_object(lopdf::dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "Outlines" => outline_root_id,
        });

        doc.objects.insert(
            pages_id,
            Object::Dictionary(lopdf::dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_one_id.into(), page_two_id.into()],
                "Count" => 2,
            }),
        );
        doc.objects.insert(
            outline_root_id,
            Object::Dictionary(lopdf::dictionary! {
                "Type" => "Outlines",
                "First" => intro_id,
                "Last" => unresolved_id,
                "Count" => 4,
            }),
        );
        doc.objects.insert(
            intro_id,
            Object::Dictionary(lopdf::dictionary! {
                "Title" => Object::string_literal("Introduction"),
                "Parent" => outline_root_id,
                "Next" => methods_id,
                "Dest" => vec![page_one_id.into(), "Fit".into()],
            }),
        );
        doc.objects.insert(
            methods_id,
            Object::Dictionary(lopdf::dictionary! {
                "Title" => Object::string_literal("Methods"),
                "Parent" => outline_root_id,
                "Prev" => intro_id,
                "Next" => remote_id,
                "First" => child_id,
                "Last" => child_id,
                "Count" => 1,
                "A" => lopdf::dictionary! {
                    "S" => "GoTo",
                    "D" => vec![page_two_id.into(), "Fit".into()],
                },
            }),
        );
        doc.objects.insert(
            child_id,
            Object::Dictionary(lopdf::dictionary! {
                "Title" => Object::string_literal("Experiment 1"),
                "Parent" => methods_id,
                "Dest" => vec![page_two_id.into(), "Fit".into()],
            }),
        );
        doc.objects.insert(
            remote_id,
            Object::Dictionary(lopdf::dictionary! {
                "Title" => Object::string_literal("Remote"),
                "Parent" => outline_root_id,
                "Prev" => methods_id,
                "Next" => unresolved_id,
                "A" => lopdf::dictionary! {
                    "S" => "GoToR",
                    "D" => vec![page_two_id.into(), "Fit".into()],
                },
            }),
        );
        doc.objects.insert(
            unresolved_id,
            Object::Dictionary(lopdf::dictionary! {
                "Title" => Object::string_literal("Named destination"),
                "Parent" => outline_root_id,
                "Prev" => remote_id,
                "Dest" => Object::string_literal("chapter-three"),
            }),
        );
        doc.trailer.set("Root", catalog_id);

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("test pdf should serialize");
        bytes
    }

    #[test]
    fn pdf_cache_enforces_text_and_bundle_limits() {
        let mut cache = PdfEngineCache::default();
        for page_index0 in 0..(PDF_TEXT_PAGE_CACHE_LIMIT as i64 + 3) {
            remember_text_spans(
                &mut cache,
                (7, page_index0),
                vec![PdfTextSpan {
                    text: format!("page-{page_index0}"),
                    x0: 0.0,
                    y0: 0.0,
                    x1: 1.0,
                    y1: 1.0,
                }],
            );
        }
        assert_eq!(cache.text_spans_by_page.len(), PDF_TEXT_PAGE_CACHE_LIMIT);
        assert!(!cache.text_spans_by_page.contains_key(&(7, 0)));

        for page_index0 in 0..(PDF_BUNDLE_CACHE_ENTRY_LIMIT as i64 + 3) {
            remember_page_bundle(
                &mut cache,
                (7, page_index0, 640),
                PdfPageBundle {
                    png_bytes: vec![0; 1024],
                    width_px: 640,
                    height_px: 800,
                    page_width_pt: 600.0,
                    page_height_pt: 750.0,
                    spans: vec![],
                },
            );
        }
        assert!(cache.bundle_by_key.len() <= PDF_BUNDLE_CACHE_ENTRY_LIMIT);
        assert!(!cache.bundle_by_key.contains_key(&(7, 0, 640)));
    }

    #[test]
    fn document_info_includes_every_page_size() {
        let bytes = make_two_page_pdf_with_distinct_sizes();
        let doc = OxidePdfDocument::from_bytes(bytes).expect("test pdf should parse");

        let info = document_info_from_document(&doc).expect("document info should load");

        assert_eq!(info.page_count, 2);
        assert_eq!(info.pages.len(), 2);
        assert_eq!(info.pages[0].width_pt, 612.0);
        assert_eq!(info.pages[0].height_pt, 792.0);
        assert_eq!(info.pages[1].width_pt, 420.0);
        assert_eq!(info.pages[1].height_pt, 595.0);
    }

    #[test]
    fn outline_extraction_reads_nested_destinations_and_skips_unsupported_nodes() {
        let outline = extract_pdf_outline(&make_pdf_with_outline()).expect("outline should parse");

        assert_eq!(outline.len(), 2);
        assert_eq!(outline[0].title, "Introduction");
        assert_eq!(outline[0].page_index0, 0);
        assert!(outline[0].children.is_empty());
        assert_eq!(outline[1].title, "Methods");
        assert_eq!(outline[1].page_index0, 1);
        assert_eq!(outline[1].children.len(), 1);
        assert_eq!(outline[1].children[0].title, "Experiment 1");
        assert_eq!(outline[1].children[0].page_index0, 1);
    }

    #[test]
    fn outline_extraction_returns_empty_for_pdf_without_outline() {
        let outline = extract_pdf_outline(&make_two_page_pdf_with_distinct_sizes()).expect("outline should parse");

        assert!(outline.is_empty());
    }

    #[test]
    fn unique_preserve_order_dedups_and_keeps_first_occurrence_order() {
        let input = vec![2, 1, 2, 3, 1];
        let unique = unique_preserve_order(&input).expect("should be valid");
        assert_eq!(unique, vec![2, 1, 3]);
    }

    #[test]
    fn search_matches_do_not_depend_on_full_text_cache_retention() {
        let mut cache = PdfEngineCache::default();
        let page_count = PDF_TEXT_PAGE_CACHE_LIMIT + 2;
        let pages = (0..page_count)
            .map(|page_index0| {
                vec![PdfTextSpan {
                    text: if page_index0 == 0 || page_index0 == page_count - 1 {
                        format!("needle page {page_index0}")
                    } else {
                        format!("filler page {page_index0}")
                    },
                    x0: 0.0,
                    y0: 0.0,
                    x1: 1.0,
                    y1: 1.0,
                }]
            })
            .collect::<Vec<_>>();

        for page_index0 in 0..page_count {
            remember_text_spans(
                &mut cache,
                (9, page_index0 as i64),
                pages[page_index0].clone(),
            );
        }
        assert!(!cache.text_spans_by_page.contains_key(&(9, 0)));

        let mut matches = Vec::new();
        for (page_index0, spans) in pages.iter().enumerate() {
            matches.extend(collect_search_matches_for_page(
                page_index0 as i64,
                spans,
                "needle",
                usize::MAX,
            ));
        }

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].page_index0, 0);
        assert_eq!(matches[1].page_index0, (page_count - 1) as i64);
    }
}
