use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use app_core::service::{ImportBatchResult, ImportMode, LibraryService};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub(crate) const CONNECTOR_PORT: u16 = 17654;
pub(crate) const CONNECTOR_URL: &str = "http://127.0.0.1:17654";
const SOCKET_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REQUEST_BODY_BYTES: usize = 80 * 1024 * 1024;

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

#[derive(Debug, Clone, Serialize)]
struct LibraryChangedEvent {
    source: String,
    collection_id: i64,
    imported_count: usize,
    duplicate_count: usize,
    failed_count: usize,
    imported_item_ids: Vec<i64>,
    duplicate_item_ids: Vec<i64>,
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

pub(crate) fn start(
    service: Arc<LibraryService>,
    status: SharedConnectorStatus,
    app_handle: AppHandle,
) {
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
                    let app_handle = app_handle.clone();
                    thread::spawn(move || {
                        if let Err(error) = handle_connection(stream, service, app_handle) {
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
    app_handle: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    stream.set_read_timeout(Some(SOCKET_TIMEOUT))?;
    stream.set_write_timeout(Some(SOCKET_TIMEOUT))?;
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
    if content_length > MAX_REQUEST_BODY_BYTES {
        let response = json_response(413, error_body("request body too large"))
            .with_cors_origin(cors_origin(&headers));
        stream.write_all(&response.into_bytes())?;
        return Ok(());
    }
    let mut body = vec![0_u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    let response =
        route_request_with_app(method, path, &headers, &body, &service, Some(&app_handle));
    stream.write_all(&response.into_bytes())?;
    Ok(())
}

#[cfg(test)]
fn route_request(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    service: &LibraryService,
) -> HttpResponse {
    route_request_with_app(method, path, headers, body, service, None)
}

fn route_request_with_app(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    service: &LibraryService,
    app_handle: Option<&AppHandle>,
) -> HttpResponse {
    let cors_origin = cors_origin(headers);

    if body.len() > MAX_REQUEST_BODY_BYTES {
        return json_response(413, error_body("request body too large"))
            .with_cors_origin(cors_origin);
    }

    if method == "GET" && path == "/v1/health" {
        return json_response(200, health_body()).with_cors_origin(cors_origin);
    }

    if method == "OPTIONS" {
        return json_response(200, serde_json::json!({ "ok": true })).with_cors_origin(cors_origin);
    }

    match authorize(headers, service) {
        Ok(()) => {}
        Err(response) => return response.with_cors_origin(cors_origin),
    }

    let response = match (method, path) {
        ("GET", "/v1/collections") => match service.list_collections() {
            Ok(collections) => json_response(200, collections),
            Err(error) => json_response(500, error_body(error.to_string())),
        },
        ("POST", "/v1/import-path") => import_path(body, service, app_handle),
        ("POST", "/v1/import-file") => import_file(body, service, app_handle),
        ("POST", "/v1/import-markdown") => import_markdown(body, service, app_handle),
        _ => json_response(404, error_body("not found")),
    };
    response.with_cors_origin(cors_origin)
}

fn authorize(
    headers: &HashMap<String, String>,
    service: &LibraryService,
) -> Result<(), HttpResponse> {
    if !headers.contains_key("origin") {
        return Ok(());
    }

    if headers
        .get("origin")
        .is_some_and(|origin| is_trusted_browser_extension_origin(origin))
    {
        return Ok(());
    }

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

fn is_trusted_browser_extension_origin(origin: &str) -> bool {
    let normalized = origin.trim().to_ascii_lowercase();
    normalized.starts_with("chrome-extension://")
        || normalized.starts_with("safari-web-extension://")
        || normalized.starts_with("moz-extension://")
}

fn cors_origin(headers: &HashMap<String, String>) -> Option<String> {
    match headers.get("origin") {
        Some(origin) if is_trusted_browser_extension_origin(origin) => Some(origin.clone()),
        Some(_) => None,
        None => Some("*".to_string()),
    }
}

fn import_path(
    body: &[u8],
    service: &LibraryService,
    app_handle: Option<&AppHandle>,
) -> HttpResponse {
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
        Ok(result) => {
            emit_library_changed(app_handle, input.collection_id, &result);
            json_response::<ImportBatchResult>(200, result)
        }
        Err(error) => json_response(500, error_body(error.to_string())),
    }
}

fn import_markdown(
    body: &[u8],
    service: &LibraryService,
    app_handle: Option<&AppHandle>,
) -> HttpResponse {
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
        Ok(result) => {
            emit_library_changed(app_handle, input.collection_id, &result);
            json_response::<ImportBatchResult>(200, result)
        }
        Err(error) => json_response(400, error_body(error.to_string())),
    }
}

fn import_file(
    body: &[u8],
    service: &LibraryService,
    app_handle: Option<&AppHandle>,
) -> HttpResponse {
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
        Some(ext) if ext == "pdf" || ext == "docx" || ext == "epub" || ext == "md" || ext == "markdown"
    ) {
        return json_response(400, error_body("unsupported attachment format"));
    }

    let bytes = match base64::engine::general_purpose::STANDARD.decode(input.content_base64.trim())
    {
        Ok(bytes) if !bytes.is_empty() => bytes,
        Ok(_) => return json_response(400, error_body("content must not be empty")),
        Err(error) => {
            return json_response(400, error_body(format!("invalid base64 content: {error}")))
        }
    };
    let result_path = input.source_url.as_deref().unwrap_or(filename);

    match service.import_file_bytes(input.collection_id, filename, bytes, result_path) {
        Ok(result) => {
            emit_library_changed(app_handle, input.collection_id, &result);
            json_response::<ImportBatchResult>(200, result)
        }
        Err(error) => json_response(400, error_body(error.to_string())),
    }
}

fn emit_library_changed(
    app_handle: Option<&AppHandle>,
    collection_id: i64,
    result: &ImportBatchResult,
) {
    let Some(app_handle) = app_handle else {
        return;
    };
    if result.imported.is_empty() && result.duplicates.is_empty() {
        return;
    }
    let _ = app_handle.emit(
        "library:changed",
        LibraryChangedEvent {
            source: "connector".into(),
            collection_id,
            imported_count: result.imported.len(),
            duplicate_count: result.duplicates.len(),
            failed_count: result.failed.len(),
            imported_item_ids: result.imported.iter().map(|item| item.id).collect(),
            duplicate_item_ids: result
                .duplicates
                .iter()
                .filter_map(|duplicate| duplicate.item.as_ref().map(|item| item.id))
                .collect(),
        },
    );
}

#[derive(Debug)]
struct HttpResponse {
    status: u16,
    body: String,
    cors_origin: Option<String>,
}

impl HttpResponse {
    fn with_cors_origin(mut self, cors_origin: Option<String>) -> Self {
        self.cors_origin = cors_origin;
        self
    }

    fn into_bytes(self) -> Vec<u8> {
        let reason = match self.status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            413 => "Payload Too Large",
            404 => "Not Found",
            _ => "Internal Server Error",
        };
        let cors_header = self
            .cors_origin
            .map(|origin| format!("Access-Control-Allow-Origin: {origin}\r\n"))
            .unwrap_or_default();
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\n{}Access-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.status,
            reason,
            cors_header,
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
        cors_origin: None,
    }
}

fn error_body(message: impl Into<String>) -> serde_json::Value {
    serde_json::json!({ "error": message.into() })
}

fn health_body() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "app_name": "RustyReader",
        "connector_version": 1,
        "auth_modes": ["browser_extension_origin", "bearer"],
        "supported_file_types": ["pdf", "docx", "epub", "md"],
        "capabilities": ["collections", "import_path", "import_file", "import_markdown"]
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use app_core::service::LibraryService;
    use serde_json::Value;
    use tempfile::tempdir;

    use super::{health_body, route_request, MAX_REQUEST_BODY_BYTES};

    #[test]
    fn health_body_advertises_connector_capabilities() {
        let body = health_body();

        assert_eq!(body["ok"], true);
        assert_eq!(body["app_name"], "RustyReader");
        assert_eq!(body["connector_version"], 1);
        assert!(body["supported_file_types"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "pdf"));
        assert!(body["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "import_file"));
        assert!(body["auth_modes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "browser_extension_origin"));
    }

    #[test]
    fn collections_allow_trusted_extension_origin_without_token() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        service.create_collection("Inbox", None).unwrap();
        let headers = headers_with_origin("chrome-extension://abcdef");

        let response = route_request("GET", "/v1/collections", &headers, &[], &service);

        assert_eq!(response.status, 200);
        assert_eq!(
            response.cors_origin.as_deref(),
            Some("chrome-extension://abcdef")
        );
        let collections: Vec<Value> = serde_json::from_str(&response.body).unwrap();
        assert_eq!(collections.len(), 1);
    }

    #[test]
    fn import_file_allows_trusted_extension_origin_without_token() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        let collection = service.create_collection("Inbox", None).unwrap();
        let headers = headers_with_origin("safari-web-extension://com.example.paper-reader");
        let body = serde_json::json!({
            "collection_id": collection.id,
            "filename": "paper.pdf",
            "content_base64": "JVBERi0xLjQK",
            "source_url": "https://example.com/paper.pdf"
        })
        .to_string();

        let response = route_request(
            "POST",
            "/v1/import-file",
            &headers,
            body.as_bytes(),
            &service,
        );

        assert_eq!(response.status, 200);
        assert_eq!(
            response.cors_origin.as_deref(),
            Some("safari-web-extension://com.example.paper-reader")
        );
    }

    #[test]
    fn collections_allow_originless_local_requests_without_token() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        service.create_collection("Inbox", None).unwrap();
        let headers = HashMap::new();

        let response = route_request("GET", "/v1/collections", &headers, &[], &service);

        assert_eq!(response.status, 200);
        assert_eq!(response.cors_origin.as_deref(), Some("*"));
        let collections: Vec<Value> = serde_json::from_str(&response.body).unwrap();
        assert_eq!(collections.len(), 1);
    }

    #[test]
    fn import_file_allows_originless_local_requests_without_token() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        let collection = service.create_collection("Inbox", None).unwrap();
        let headers = HashMap::new();
        let body = serde_json::json!({
            "collection_id": collection.id,
            "filename": "paper.pdf",
            "content_base64": "JVBERi0xLjQK",
            "source_url": "https://example.com/paper.pdf"
        })
        .to_string();

        let response = route_request(
            "POST",
            "/v1/import-file",
            &headers,
            body.as_bytes(),
            &service,
        );

        assert_eq!(response.status, 200);
        assert_eq!(response.cors_origin.as_deref(), Some("*"));
    }

    #[test]
    fn oversized_request_body_is_rejected_before_routing() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        let headers = HashMap::new();
        let body = vec![b'x'; MAX_REQUEST_BODY_BYTES + 1];

        let response = route_request("POST", "/v1/import-file", &headers, &body, &service);

        assert_eq!(response.status, 413);
        assert!(response.body.contains("request body too large"));
        assert_eq!(response.cors_origin.as_deref(), Some("*"));
    }

    #[test]
    fn ordinary_web_origin_without_token_is_rejected_without_cors_grant() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        let headers = headers_with_origin("https://example.com");

        let response = route_request("GET", "/v1/collections", &headers, &[], &service);

        assert_eq!(response.status, 401);
        assert_eq!(response.cors_origin, None);
    }

    #[test]
    fn bearer_token_still_authorizes_requests() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        service.create_collection("Inbox", None).unwrap();
        let token = service.get_connector_settings().unwrap().token;
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), format!("Bearer {token}"));

        let response = route_request("GET", "/v1/collections", &headers, &[], &service);

        assert_eq!(response.status, 200);
        assert_eq!(response.cors_origin.as_deref(), Some("*"));
    }

    #[test]
    fn options_only_grants_cors_to_trusted_or_originless_requests() {
        let root = tempdir().unwrap();
        let service = LibraryService::new(root.path()).unwrap();
        let trusted = headers_with_origin("chrome-extension://abcdef");
        let web = headers_with_origin("https://example.com");
        let none = HashMap::new();

        assert_eq!(
            route_request("OPTIONS", "/v1/collections", &trusted, &[], &service)
                .cors_origin
                .as_deref(),
            Some("chrome-extension://abcdef")
        );
        assert_eq!(
            route_request("OPTIONS", "/v1/collections", &web, &[], &service).cors_origin,
            None
        );
        assert_eq!(
            route_request("OPTIONS", "/v1/collections", &none, &[], &service)
                .cors_origin
                .as_deref(),
            Some("*")
        );
    }

    fn headers_with_origin(origin: &str) -> HashMap<String, String> {
        HashMap::from([("origin".to_string(), origin.to_string())])
    }
}
