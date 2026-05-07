import { checkHealth } from "../shared/connector-client.js";
import { buildCollectionTree, collectionLabel, flattenCollectionTree } from "../shared/collections.js";

const connectorUrlInput = document.querySelector("#connectorUrl");
const connectorTokenInput = document.querySelector("#connectorToken");
const collectionSelect = document.querySelector("#collectionSelect");
const connectionStatus = document.querySelector("#connectionStatus");
const importStatus = document.querySelector("#importStatus");
const candidateList = document.querySelector("#candidateList");
const pageContext = document.querySelector("#pageContext");

const state = {
  config: null,
  collections: [],
  activeTabId: null,
  pageUrl: "",
  candidates: []
};

function setStatus(element, message, tone = "neutral") {
  element.textContent = message;
  element.classList.remove("is-error", "is-success");
  if (tone === "error") element.classList.add("is-error");
  if (tone === "success") element.classList.add("is-success");
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function initialize() {
  const [{ id: tabId, url }] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTabId = tabId;
  state.pageUrl = url || "";
  pageContext.textContent = state.pageUrl || "Open a supported page to scan for files.";

  const config = await sendMessage({ type: "paper-reader:get-state" });
  state.config = config;
  connectorUrlInput.value = config.connectorUrl;
  connectorTokenInput.value = config.connectorToken;

  if (config.connectorToken) {
    await loadCollections();
    await scanPage();
  } else {
    setStatus(connectionStatus, "Connector token is required before collections can load.", "error");
  }
}

async function saveConfig() {
  await sendMessage({
    type: "paper-reader:save-config",
    payload: {
      connectorUrl: connectorUrlInput.value,
      connectorToken: connectorTokenInput.value,
      lastCollectionId: Number(collectionSelect.value) || state.config?.lastCollectionId || null
    }
  });

  state.config = {
    ...(state.config || {}),
    connectorUrl: connectorUrlInput.value,
    connectorToken: connectorTokenInput.value,
    lastCollectionId: Number(collectionSelect.value) || state.config?.lastCollectionId || null
  };

  setStatus(connectionStatus, "Connector settings saved.", "success");
}

async function handleHealthCheck() {
  const baseUrl = connectorUrlInput.value.trim();
  setStatus(connectionStatus, "Checking connector…");
  try {
    const response = await checkHealth(baseUrl);
    setStatus(connectionStatus, response.ok ? "Connector reachable." : "Connector health check returned an unexpected response.", response.ok ? "success" : "error");
  } catch (error) {
    setStatus(connectionStatus, error.message, "error");
  }
}

async function loadCollections() {
  setStatus(connectionStatus, "Loading collections…");
  const response = await sendMessage({ type: "paper-reader:load-collections" });
  state.collections = response.collections;
  state.config = response.config;
  renderCollections();
  setStatus(connectionStatus, `Loaded ${response.collections.length} collections.`, "success");
}

function renderCollections() {
  collectionSelect.innerHTML = "";
  const rows = flattenCollectionTree(buildCollectionTree(state.collections));
  if (rows.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No collections found";
    option.value = "";
    collectionSelect.append(option);
    return;
  }

  for (const row of rows) {
    const option = document.createElement("option");
    option.value = String(row.id);
    option.textContent = collectionLabel(row, row.depth);
    if (row.id === state.config?.lastCollectionId) option.selected = true;
    collectionSelect.append(option);
  }
}

async function scanPage() {
  if (!state.activeTabId) return;
  setStatus(importStatus, "Scanning current page…");
  const response = await sendMessage({
    type: "paper-reader:detect-page-files",
    tabId: state.activeTabId
  });

  state.pageUrl = response.pageUrl;
  state.candidates = response.candidates || [];
  pageContext.textContent = state.pageUrl;
  renderCandidates();

  if (state.candidates.length === 0) {
    setStatus(importStatus, "No importable PDF links or readable page content found.", "error");
    return;
  }

  if (state.candidates.length === 1 && state.candidates[0].importType !== "markdown") {
    setStatus(importStatus, "Found one file. Importing automatically…", "success");
    await importCandidate(state.candidates[0]);
    return;
  }

  setStatus(importStatus, `Found ${state.candidates.length} import options. Pick one to import.`, "success");
}

function renderCandidates() {
  candidateList.innerHTML = "";
  for (const candidate of state.candidates) {
    const item = document.createElement("li");
    item.className = "candidate-item";

    const meta = document.createElement("div");
    meta.className = "candidate-meta";

    const title = document.createElement("div");
    title.className = "candidate-title";
    title.textContent = candidate.title || candidate.url;

    const url = document.createElement("div");
    url.className = "candidate-url";
    url.textContent = candidate.url;

    const type = document.createElement("span");
    type.className = "badge";
    type.textContent = candidate.fileLabel;

    meta.append(type, title, url);

    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.textContent = "Import";
    button.addEventListener("click", () => {
      void importCandidate(candidate);
    });

    item.append(meta, button);
    candidateList.append(item);
  }
}

async function importCandidate(candidate) {
  const collectionId = Number(collectionSelect.value);
  if (!collectionId) {
    setStatus(importStatus, "Select a collection before importing.", "error");
    return;
  }

  await saveConfig();
  setStatus(importStatus, candidate.importType === "markdown" ? `Saving ${candidate.title || candidate.url}…` : `Downloading ${candidate.title || candidate.url}…`);

  const response = await sendMessage({
    type: "paper-reader:import-candidate",
    payload: {
      collectionId,
      candidate,
      pageUrl: state.pageUrl
    }
  });

  if (!response.ok) {
    const suffix = response.download?.localPath ? ` Temporary file kept at ${response.download.localPath}.` : "";
    setStatus(importStatus, `${response.error}.${suffix}`, "error");
    return;
  }

  const tone = response.outcome.status === "failed" ? "error" : "success";
  const location = response.download?.localPath ? ` ${response.download.localPath}` : " Saved to collection.";
  setStatus(importStatus, `${response.outcome.message}${location}`, tone);
}

document.querySelector("#saveConfigButton").addEventListener("click", () => {
  void saveConfig();
});
document.querySelector("#checkHealthButton").addEventListener("click", () => {
  void handleHealthCheck();
});
document.querySelector("#refreshButton").addEventListener("click", () => {
  void loadCollections();
});
document.querySelector("#scanButton").addEventListener("click", () => {
  void scanPage();
});
collectionSelect.addEventListener("change", () => {
  state.config = { ...(state.config || {}), lastCollectionId: Number(collectionSelect.value) || null };
  if (state.candidates.length === 1 && state.candidates[0].importType !== "markdown") {
    void importCandidate(state.candidates[0]);
  }
});

void initialize().catch((error) => {
  setStatus(connectionStatus, error.message, "error");
});
