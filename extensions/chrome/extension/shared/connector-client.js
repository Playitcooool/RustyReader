import { DEFAULT_CONNECTOR_URL } from "./constants.js";

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
      throw new Error("RustyReader desktop connector did not respond in time. Confirm RustyReader is running.");
    }
    throw new Error("RustyReader desktop connector is unreachable. Start or update RustyReader.");
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
    return "RustyReader rejected the connector request. Update RustyReader and try again.";
  }

  if (normalized.includes("collection")) {
    return "The selected RustyReader collection no longer exists. Refresh collections and choose another one.";
  }

  if (normalized.includes("unsupported")) {
    return "RustyReader does not support this file type. Import a PDF, DOCX, EPUB, or readable web page.";
  }

  if (normalized.includes("absolute")) {
    return "RustyReader rejected the downloaded file path because it was not absolute.";
  }

  if (status >= 500) {
    return "RustyReader import failed. The temporary download was kept for inspection.";
  }

  return serverMessage || `${status} ${statusText}`.trim();
}

export async function checkHealth(baseUrl) {
  return request(baseUrl, "/v1/health");
}

export async function discoverConnectorUrl(preferredUrl = DEFAULT_CONNECTOR_URL) {
  const connectorUrl = normalizeBaseUrl(preferredUrl || DEFAULT_CONNECTOR_URL);
  const health = await checkHealth(connectorUrl);
  if (health?.ok) {
    if (!health.auth_modes?.includes("browser_extension_origin")) {
      throw new Error("RustyReader needs an update before this extension can connect without a token.");
    }
    return { connectorUrl, health };
  }
  throw new Error("Connector health check returned an unexpected response.");
}

export async function fetchCollections(baseUrl = DEFAULT_CONNECTOR_URL, token) {
  return request(baseUrl, "/v1/collections", { token });
}

function requestArgs(baseUrlOrPayload, tokenOrPayload, maybePayload) {
  if (typeof baseUrlOrPayload !== "string") {
    return { baseUrl: DEFAULT_CONNECTOR_URL, token: undefined, payload: baseUrlOrPayload };
  }
  if (maybePayload === undefined) {
    return { baseUrl: baseUrlOrPayload, token: undefined, payload: tokenOrPayload };
  }
  return { baseUrl: baseUrlOrPayload, token: tokenOrPayload, payload: maybePayload };
}

export async function importPath(baseUrlOrPayload, tokenOrPayload, maybePayload) {
  const { baseUrl, token, payload } = requestArgs(baseUrlOrPayload, tokenOrPayload, maybePayload);
  return request(baseUrl, "/v1/import-path", {
    method: "POST",
    token,
    body: payload
  });
}

export async function importFile(baseUrlOrPayload, tokenOrPayload, maybePayload) {
  const { baseUrl, token, payload } = requestArgs(baseUrlOrPayload, tokenOrPayload, maybePayload);
  return request(baseUrl, "/v1/import-file", {
    method: "POST",
    token,
    body: payload
  });
}

export async function importMarkdown(baseUrlOrPayload, tokenOrPayload, maybePayload) {
  const { baseUrl, token, payload } = requestArgs(baseUrlOrPayload, tokenOrPayload, maybePayload);
  return request(baseUrl, "/v1/import-markdown", {
    method: "POST",
    token,
    body: payload
  });
}
