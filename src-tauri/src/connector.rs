use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

use app_core::service::{ImportBatchResult, ImportMode, LibraryService};
use base64::Engine;
use serde::{Deserialize, Serialize};

pub(crate) const CONNECTOR_PORT: u16 = 17654;
pub(crate) const CONNECTOR_URL: &str = "http://127.0.0.1:17654";

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ConnectorRuntimeSettings {
    pub connector_url: String,
    pub port: u16,
    pub token: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct ConnectorStatus {
    error: Option<String>,
}

pub(crate) type SharedConnectorStatus = Arc<Mutex<ConnectorStatus>>;

#[derive(Debug, Deserialize)]
struct ImportPathRequest {
    collection_id: i64,
    path: String,
    #[allow(dead_code)]
    source_url: Option<String>,
    #[allow(dead_code)]
    page_url: Option<String>,
    #[allow(dead_code)]
    download_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ImportMarkdownRequest {
    collection_id: i64,
    title: String,
    markdown: String,
    source_url: Option<String>,
    #[allow(dead_code)]
    page_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImportFileRequest {
    collection_id: i64,
    filename: String,
    content_base64: String,
    source_url: Option<String>,
    #[allow(dead_code)]
    page_url: Option<String>,
    #[allow(dead_code)]
    content_type: Option<String>,
}

pub(crate) fn new_status() -> SharedConnectorStatus {
    Arc::new(Mutex::new(ConnectorStatus::default()))
}

pub(crate) fn runtime_settings(
    service: &LibraryService,
    status: &SharedConnectorStatus,
) -> Result<ConnectorRuntimeSettings, String> {
    let token = service
        .get_connector_settings()
        .map_err(|error| error.to_string())?
        .token;
    let error = status.lock().ok().and_then(|guard| guard.error.clone());
    Ok(ConnectorRuntimeSettings {
        connector_url: CONNECTOR_URL.to_string(),
        port: CONNECTOR_PORT,
        token,
        status: if error.is_some() { "error" } else { "running" }.into(),
        error,
    })
}

pub(crate) fn start(service: Arc<LibraryService>, status: SharedConnectorStatus) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", CONNECTOR_PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                set_error(&status, error.to_string());
                return;
            }
        };
        set_error(&status, String::new());

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let service = service.clone();
                    thread::spawn(move || {
                        if let Err(error) = handle_connection(stream, service) {
                            eprintln!("connector request failed: {error}");
                        }
                    });
                }
                Err(error) => set_error(&status, error.to_string()),
            }
        }
    });
}

fn set_error(status: &SharedConnectorStatus, error: String) {
    if let Ok(mut guard) = status.lock() {
        guard.error = if error.is_empty() { None } else { Some(error) };
    }
}

fn handle_connection(
    mut stream: TcpStream,
    service: Arc<LibraryService>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0_u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    let response = route_request(method, path, &headers, &body, &service);
    stream.write_all(&response.into_bytes())?;
    Ok(())
}

fn route_request(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    service: &LibraryService,
) -> HttpResponse {
    if method == "GET" && path == "/v1/health" {
        return json_response(200, serde_json::json!({ "ok": true }));
    }

    if method == "OPTIONS" {
        return json_response(200, serde_json::json!({ "ok": true }));
    }

    match authorize(headers, service) {
        Ok(()) => {}
        Err(response) => return response,
    }

    match (method, path) {
        ("GET", "/v1/collections") => match service.list_collections() {
            Ok(collections) => json_response(200, collections),
            Err(error) => json_response(500, error_body(error.to_string())),
        },
        ("POST", "/v1/import-path") => import_path(body, service),
        ("POST", "/v1/import-file") => import_file(body, service),
        ("POST", "/v1/import-markdown") => import_markdown(body, service),
        _ => json_response(404, error_body("not found")),
    }
}

fn authorize(
    headers: &HashMap<String, String>,
    service: &LibraryService,
) -> Result<(), HttpResponse> {
    let expected = service
        .get_connector_settings()
        .map_err(|error| json_response(500, error_body(error.to_string())))?
        .token;
    let actual = headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if actual == expected {
        Ok(())
    } else {
        Err(json_response(401, error_body("unauthorized")))
    }
}

fn import_path(body: &[u8], service: &LibraryService) -> HttpResponse {
    let input = match serde_json::from_slice::<ImportPathRequest>(body) {
        Ok(input) => input,
        Err(error) => return json_response(400, error_body(error.to_string())),
    };
    let path = PathBuf::from(&input.path);
    if !path.is_absolute() {
        return json_response(400, error_body("path must be absolute"));
    }
    match service.collection_exists(input.collection_id) {
        Ok(true) => {}
        Ok(false) => return json_response(400, error_body("collection does not exist")),
        Err(error) => return json_response(500, error_body(error.to_string())),
    }

    match service.import_files(input.collection_id, &[path], ImportMode::ManagedCopy) {
        Ok(result) => json_response::<ImportBatchResult>(200, result),
        Err(error) => json_response(500, error_body(error.to_string())),
    }
}

fn import_markdown(body: &[u8], service: &LibraryService) -> HttpResponse {
    let input = match serde_json::from_slice::<ImportMarkdownRequest>(body) {
        Ok(input) => input,
        Err(error) => return json_response(400, error_body(error.to_string())),
    };
    match service.collection_exists(input.collection_id) {
        Ok(true) => {}
        Ok(false) => return json_response(400, error_body("collection does not exist")),
        Err(error) => return json_response(500, error_body(error.to_string())),
    }

    match service.import_markdown_item(
        input.collection_id,
        &input.title,
        &input.markdown,
        input.source_url.as_deref(),
    ) {
        Ok(result) => json_response::<ImportBatchResult>(200, result),
        Err(error) => json_response(400, error_body(error.to_string())),
    }
}

fn import_file(body: &[u8], service: &LibraryService) -> HttpResponse {
    let input = match serde_json::from_slice::<ImportFileRequest>(body) {
        Ok(input) => input,
        Err(error) => return json_response(400, error_body(error.to_string())),
    };
    match service.collection_exists(input.collection_id) {
        Ok(true) => {}
        Ok(false) => return json_response(400, error_body("collection does not exist")),
        Err(error) => return json_response(500, error_body(error.to_string())),
    }

    let filename = input.filename.trim();
    if filename.is_empty() {
        return json_response(400, error_body("filename must not be empty"));
    }
    if !matches!(
        filename.rsplit('.').next().map(|value| value.to_ascii_lowercase()),
        Some(ext) if ext == "pdf" || ext == "docx" || ext == "epub"
    ) {
        return json_response(400, error_body("unsupported attachment format"));
    }

    let bytes = match base64::engine::general_purpose::STANDARD.decode(input.content_base64.trim())
    {
        Ok(bytes) if !bytes.is_empty() => bytes,
        Ok(_) => return json_response(400, error_body("content must not be empty")),
        Err(error) => return json_response(400, error_body(format!("invalid base64 content: {error}"))),
    };
    let result_path = input.source_url.as_deref().unwrap_or(filename);

    match service.import_file_bytes(input.collection_id, filename, bytes, result_path) {
        Ok(result) => json_response::<ImportBatchResult>(200, result),
        Err(error) => json_response(400, error_body(error.to_string())),
    }
}

#[derive(Debug)]
struct HttpResponse {
    status: u16,
    body: String,
}

impl HttpResponse {
    fn into_bytes(self) -> Vec<u8> {
        let reason = match self.status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            _ => "Internal Server Error",
        };
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.status,
            reason,
            self.body.as_bytes().len(),
            self.body
        )
        .into_bytes()
    }
}

fn json_response<T: Serialize>(status: u16, body: T) -> HttpResponse {
    HttpResponse {
        status,
        body: serde_json::to_string(&body)
            .unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".into()),
    }
}

fn error_body(message: impl Into<String>) -> serde_json::Value {
    serde_json::json!({ "error": message.into() })
}
