import { DEFAULT_CONNECTOR_URL } from "./constants.js";

function normalizeBaseUrl(baseUrl = DEFAULT_CONNECTOR_URL) {
  return baseUrl.replace(/\/$/, "");
}

async function request(baseUrl, path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("Paper Reader desktop connector is unreachable. Start Paper Reader and confirm the connector URL.");
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
