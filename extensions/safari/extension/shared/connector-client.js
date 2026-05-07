import { DEFAULT_CONNECTOR_URL } from "./constants.js";

const CONNECTOR_CANDIDATES = [DEFAULT_CONNECTOR_URL, "http://localhost:17654"];
const REQUEST_TIMEOUT_MS = 8000;

function normalizeBaseUrl(baseUrl = DEFAULT_CONNECTOR_URL) {
  return baseUrl.replace(/\/$/, "");
}

async function request(baseUrl, path, { token, method = "GET", body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Paper Reader desktop connector did not respond in time. Confirm Paper Reader is running.");
    }
    throw new Error("Paper Reader desktop connector is unreachable. Start Paper Reader and confirm the connector URL.");
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(userMessageForError(response.status, response.statusText, data));
  }

  return data;
}

function userMessageForError(status, statusText, data) {
  const serverMessage = data?.error || data?.message || "";
  const normalized = serverMessage.toLowerCase();

  if (status === 401 || status === 403 || normalized.includes("unauthorized")) {
    return "Connector token was rejected. Check that the pasted token matches Paper Reader.";
  }

  if (normalized.includes("collection")) {
    return "The selected Paper Reader collection no longer exists. Refresh collections and choose another one.";
  }

  if (normalized.includes("unsupported")) {
    return "Paper Reader does not support this file type. Import a PDF, DOCX, EPUB, or readable web page.";
  }

  if (normalized.includes("absolute")) {
    return "Paper Reader rejected the downloaded file path because it was not absolute.";
  }

  if (status >= 500) {
    return "Paper Reader import failed. The temporary download was kept for inspection.";
  }

  return serverMessage || `${status} ${statusText}`.trim();
}

export async function checkHealth(baseUrl) {
  return request(baseUrl, "/v1/health");
}

export async function discoverConnectorUrl(preferredUrl = DEFAULT_CONNECTOR_URL) {
  const candidates = [preferredUrl, ...CONNECTOR_CANDIDATES]
    .filter(Boolean)
    .map(normalizeBaseUrl)
    .filter((value, index, rows) => rows.indexOf(value) === index);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const health = await checkHealth(candidate);
      if (health?.ok) return { connectorUrl: candidate, health };
      lastError = new Error("Connector health check returned an unexpected response.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Paper Reader desktop connector is unreachable. Start Paper Reader and confirm the connector URL.");
}

export async function fetchCollections(baseUrl, token) {
  return request(baseUrl, "/v1/collections", { token });
}

export async function importPath(baseUrl, token, payload) {
  return request(baseUrl, "/v1/import-path", {
    method: "POST",
    token,
    body: payload
  });
}

export async function importFile(baseUrl, token, payload) {
  return request(baseUrl, "/v1/import-file", {
    method: "POST",
    token,
    body: payload
  });
}

export async function importMarkdown(baseUrl, token, payload) {
  return request(baseUrl, "/v1/import-markdown", {
    method: "POST",
    token,
    body: payload
  });
}
