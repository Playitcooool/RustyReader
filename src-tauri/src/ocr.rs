use std::{
    collections::HashMap,
    ffi::CString,
    fs,
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Semaphore;
use tesseract_ocr_static::{
    Config as TesseractConfig, Image as TessImage, PageSegmentationMode, TextRecognizer,
};

use crate::state::AppState;

pub(crate) static OCR_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

#[derive(Deserialize)]
pub(crate) struct OcrPdfPageInput {
    primary_attachment_id: i64,
    page_index0: i64,
    png_bytes: Vec<u8>,
    lang: Option<String>,
    config_version: String,
    source_resolution: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrBbox {
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrLine {
    pub(crate) text: String,
    pub(crate) bbox: OcrBbox,
    pub(crate) confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OcrPageResult {
    primary_attachment_id: i64,
    page_index0: i64,
    lang: String,
    config_version: String,
    lines: Vec<OcrLine>,
}

fn resolve_tessdata_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join("resources").join("tessdata");
        if packaged.exists() {
            return packaged;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("tessdata")
}

fn normalize_ocr_text(value: &str) -> String {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn cache_path_for_ocr(state: &AppState, input: &OcrPdfPageInput, lang: &str) -> PathBuf {
    state
        .library_root
        .join("ocr_cache")
        .join(&input.config_version)
        .join(lang)
        .join(input.primary_attachment_id.to_string())
        .join(format!("{}.json", input.page_index0))
}

fn parse_tesseract_tsv_to_lines(
    tsv_str: &str,
    image_width: u32,
    image_height: u32,
) -> Vec<OcrLine> {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct LineKey {
        block: i32,
        para: i32,
        line: i32,
    }

    #[derive(Debug)]
    struct LineAgg {
        left: u32,
        top: u32,
        right: u32,
        bottom: u32,
        words: Vec<String>,
        confidences: Vec<f32>,
    }

    let mut lines: Vec<LineAgg> = Vec::new();
    let mut current_key: Option<LineKey> = None;
    let mut current: Option<LineAgg> = None;

    let mut header_map: HashMap<&str, usize> = HashMap::new();
    let mut saw_header = false;

    for (idx, row) in tsv_str.lines().enumerate() {
        if idx == 0 {
            for (col_index, name) in row.split('\t').enumerate() {
                header_map.insert(name.trim(), col_index);
            }
            saw_header = true;
            continue;
        }
        if row.trim().is_empty() || !saw_header {
            continue;
        }

        let cols = row.split('\t').collect::<Vec<_>>();
        let get = |name: &str| -> Option<&str> {
            let idx = *header_map.get(name)?;
            cols.get(idx).copied()
        };

        let Some(level_str) = get("level") else {
            continue;
        };
        let Ok(level) = level_str.parse::<i32>() else {
            continue;
        };
        if level != 5 {
            continue;
        }

        let block: i32 = get("block_num")
            .and_then(|value| value.parse().ok())
            .unwrap_or(-1);
        let para: i32 = get("par_num")
            .and_then(|value| value.parse().ok())
            .unwrap_or(-1);
        let line: i32 = get("line_num")
            .and_then(|value| value.parse().ok())
            .unwrap_or(-1);
        let key = LineKey { block, para, line };

        let left: u32 = get("left")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let top: u32 = get("top").and_then(|value| value.parse().ok()).unwrap_or(0);
        let w: u32 = get("width")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let h: u32 = get("height")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let right = left.saturating_add(w);
        let bottom = top.saturating_add(h);

        let conf: f32 = get("conf")
            .and_then(|value| value.parse().ok())
            .unwrap_or(-1.0);
        let word = get("text").unwrap_or("");
        if conf < 0.0 {
            continue;
        }
        let normalized_word = normalize_ocr_text(word);
        if normalized_word.is_empty() {
            continue;
        }

        if current_key != Some(key) {
            if let Some(agg) = current.take() {
                lines.push(agg);
            }
            current_key = Some(key);
            current = Some(LineAgg {
                left,
                top,
                right,
                bottom,
                words: Vec::new(),
                confidences: Vec::new(),
            });
        }

        let agg = current.as_mut().expect("current agg");
        agg.left = agg.left.min(left);
        agg.top = agg.top.min(top);
        agg.right = agg.right.max(right);
        agg.bottom = agg.bottom.max(bottom);
        agg.words.push(normalized_word);
        agg.confidences.push(conf);
    }

    if let Some(agg) = current.take() {
        lines.push(agg);
    }

    let width_f = image_width.max(1) as f32;
    let height_f = image_height.max(1) as f32;
    let mut out_lines: Vec<OcrLine> = Vec::new();
    for agg in lines {
        let text = agg.words.join(" ").trim().to_string();
        if text.is_empty() {
            continue;
        }
        let confidence = if agg.confidences.is_empty() {
            0.0
        } else {
            agg.confidences.iter().copied().sum::<f32>() / (agg.confidences.len() as f32)
        };
        out_lines.push(OcrLine {
            text,
            bbox: OcrBbox {
                left: (agg.left as f32) / width_f,
                top: (agg.top as f32) / height_f,
                width: ((agg.right.saturating_sub(agg.left)) as f32) / width_f,
                height: ((agg.bottom.saturating_sub(agg.top)) as f32) / height_f,
            },
            confidence,
        });
    }

    out_lines
}

fn read_cached_ocr(path: &PathBuf) -> Option<OcrPageResult> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice::<OcrPageResult>(&bytes).ok()
}

fn write_cached_ocr_atomic(path: &PathBuf, result: &OcrPageResult) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(result).map_err(|error| error.to_string())?;
    fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
    fs::rename(&tmp, path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn ocr_pdf_page(
    app: AppHandle,
    state: State<'_, AppState>,
    input: OcrPdfPageInput,
) -> Result<OcrPageResult, String> {
    let lang = input
        .lang
        .clone()
        .unwrap_or_else(|| "eng+chi_sim".to_string());
    let cache_path = cache_path_for_ocr(&state, &input, &lang);
    if let Some(cached) = read_cached_ocr(&cache_path) {
        return Ok(cached);
    }

    let semaphore = OCR_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone();
    let _permit = semaphore
        .acquire_owned()
        .await
        .map_err(|_| "OCR queue closed")?;

    let decoded = image::load_from_memory_with_format(&input.png_bytes, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?
        .into_rgba8();
    let (width, height) = decoded.dimensions();
    let tess_image =
        TessImage::from_rgba(width, height, decoded.as_raw()).map_err(|_| "invalid OCR image")?;

    let tessdata_dir = resolve_tessdata_dir(&app);
    let data_dir = CString::new(tessdata_dir.to_string_lossy().as_ref().to_string())
        .map_err(|_| "invalid tessdata path")?;
    let languages = CString::new(lang.as_str()).map_err(|_| "invalid OCR language")?;
    let mut recognizer = TextRecognizer::with_config(TesseractConfig {
        data_dir: Some(data_dir.as_c_str()),
        languages: languages.as_c_str(),
        ..Default::default()
    })
    .map_err(|_| "tesseract init failed (missing tessdata?)")?;
    recognizer.set_page_segmentation_mode(PageSegmentationMode::SingleBlock);
    recognizer.set_source_resolution(input.source_resolution.unwrap_or(300));

    let results = recognizer
        .recognize_text(&tess_image)
        .map_err(|_| "tesseract recognition failed")?;

    let tsv = results.get_tsv_text(0);
    let tsv_str = std::str::from_utf8(tsv.as_c_str().to_bytes()).unwrap_or("");
    let out_lines = parse_tesseract_tsv_to_lines(tsv_str, width, height);

    let result = OcrPageResult {
        primary_attachment_id: input.primary_attachment_id,
        page_index0: input.page_index0,
        lang,
        config_version: input.config_version,
        lines: out_lines,
    };

    let _ = write_cached_ocr_atomic(&cache_path, &result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tesseract_tsv_word_rows_with_header_mapping() {
        let tsv = [
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "4\t1\t1\t1\t1\t0\t100\t200\t100\t10\t-1\t",
            "5\t1\t1\t1\t1\t1\t100\t200\t50\t10\t90\tHello",
            "5\t1\t1\t1\t1\t2\t160\t200\t40\t10\t80\tworld",
        ]
        .join("\n");

        let lines = parse_tesseract_tsv_to_lines(&tsv, 1000, 2000);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Hello world");
        assert!((lines[0].bbox.left - 0.1).abs() < 1e-6);
        assert!((lines[0].bbox.top - 0.1).abs() < 1e-6);
        assert!((lines[0].bbox.width - 0.1).abs() < 1e-6);
        assert!((lines[0].bbox.height - 0.005).abs() < 1e-6);
        assert!((lines[0].confidence - 85.0).abs() < 1e-6);
    }
}
