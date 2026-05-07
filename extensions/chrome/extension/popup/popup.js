import { discoverConnectorUrl } from "../shared/connector-client.js";
import { buildCollectionTree, collectionLabel, flattenCollectionTree } from "../shared/collections.js";

const api = globalThis.browser || globalThis.chrome;

const collectionSelect = document.querySelector("#collectionSelect");
const connectionDot = document.querySelector("#connectionDot");
const connectionTitle = document.querySelector("#connectionTitle");
const connectionStatus = document.querySelector("#connectionStatus");
const importStatus = document.querySelector("#importStatus");
const resultCard = document.querySelector("#resultCard");
const resultTitle = document.querySelector("#resultTitle");
const candidateList = document.querySelector("#candidateList");
const pageContext = document.querySelector("#pageContext");
const emptyState = document.querySelector("#emptyState");
const collectionCount = document.querySelector("#collectionCount");
const retryButton = document.querySelector("#retryButton");

const state = {
  config: null,
  collections: [],
  activeTabId: null,
  pageUrl: "",
  candidates: [],
  selectedCandidate: null,
  lastImportCandidate: null,
  busy: false,
  importModeLabel: "Download then import"
};

function setConnection(title, message, tone = "neutral") {
  connectionTitle.textContent = title;
  connectionStatus.textContent = message;
  connectionDot.classList.remove("is-error", "is-success");
  if (tone === "error") connectionDot.classList.add("is-error");
  if (tone === "success") connectionDot.classList.add("is-success");
}

function setResult(title, message, tone = "neutral", { retry = false } = {}) {
  resultCard.classList.remove("is-hidden", "is-error", "is-success");
  resultTitle.textContent = title;
  importStatus.textContent = message;
  if (tone === "error") resultCard.classList.add("is-error");
  if (tone === "success") resultCard.classList.add("is-success");
  retryButton.classList.toggle("is-hidden", !retry);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  for (const button of document.querySelectorAll("button")) {
    button.disabled = isBusy;
  }
}

async function sendMessage(message) {
  const response = await api.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function initialize() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  state.activeTabId = tab?.id ?? null;
  state.pageUrl = tab?.url || "";
  pageContext.textContent = state.pageUrl || "Open a supported page to scan for files.";

  const config = await sendMessage({ type: "paper-reader:get-state" });
  state.config = config;
  state.importModeLabel = await detectImportModeLabel();

  await discoverConnector();
  await loadCollections();
  await scanPage();
}

async function detectImportModeLabel() {
  const response = await sendMessage({ type: "paper-reader:get-capabilities" });
  return response?.hasDownloads ? "Download then import" : "Upload to Paper Reader";
}

async function saveConfig({ quiet = false } = {}) {
  await sendMessage({
    type: "paper-reader:save-config",
    payload: {
      lastCollectionId: Number(collectionSelect.value) || state.config?.lastCollectionId || null
    }
  });

  state.config = {
    ...(state.config || {}),
    lastCollectionId: Number(collectionSelect.value) || state.config?.lastCollectionId || null
  };

  if (!quiet) setConnection("Destination saved", "Target collection was saved.", "success");
}

async function discoverConnector() {
  setConnection("Checking Paper Reader", "Looking for the local connector…");
  try {
    const { health } = await discoverConnectorUrl();
    const version = health.connector_version ? ` v${health.connector_version}` : "";
    setConnection("Paper Reader connected", `${health.app_name || "Connector"}${version} is reachable.`, "success");
    return health;
  } catch (error) {
    setConnection("Paper Reader not reachable", error.message, "error");
    throw error;
  }
}

async function loadCollections() {
  setConnection("Loading collections", "Fetching Paper Reader collections…");
  const response = await sendMessage({ type: "paper-reader:load-collections" });
  state.collections = response.collections;
  state.config = response.config;
  renderCollections();
  setConnection("Paper Reader connected", `Loaded ${response.collections.length} collections.`, "success");
}

function renderCollections() {
  collectionSelect.innerHTML = "";
  const rows = flattenCollectionTree(buildCollectionTree(state.collections));
  collectionCount.textContent = String(rows.length);
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
  setBusy(true);
  setResult("Scanning page", "Looking for PDFs, documents, and readable page content.");
  try {
    const response = await sendMessage({
      type: "paper-reader:detect-page-files",
      tabId: state.activeTabId
    });

    state.pageUrl = response.pageUrl;
    state.candidates = response.candidates || [];
    state.selectedCandidate = state.candidates[0] || null;
    pageContext.textContent = state.pageUrl;
    renderCandidates();

    if (state.candidates.length === 0) {
      setResult("Nothing to import", "No importable files or readable page content were found.", "error");
      return;
    }

    setResult("Ready to import", `${state.candidates.length} option${state.candidates.length === 1 ? "" : "s"} found. Choose Import when ready.`, "success");
  } catch (error) {
    setResult("Scan failed", error.message, "error", { retry: true });
  } finally {
    setBusy(false);
  }
}

function renderCandidates() {
  candidateList.innerHTML = "";
  emptyState.classList.toggle("is-hidden", state.candidates.length > 0);
  for (const candidate of state.candidates) {
    const item = document.createElement("li");
    item.className = "candidate-item";
    if (candidate === state.selectedCandidate) item.classList.add("is-selected");

    const meta = document.createElement("div");
    meta.className = "candidate-meta";

    const topRow = document.createElement("div");
    topRow.className = "candidate-row";

    const type = document.createElement("span");
    type.className = "badge";
    type.textContent = candidate.fileLabel || "PAGE";

    const title = document.createElement("div");
    title.className = "candidate-title";
    title.textContent = candidate.title || candidate.url;

    const url = document.createElement("div");
    url.className = "candidate-url";
    url.textContent = candidate.url;

    const mode = document.createElement("div");
    mode.className = "candidate-mode";
    mode.textContent = candidate.importType === "markdown" ? "Save readable page" : state.importModeLabel;

    topRow.append(type, title);
    meta.append(topRow, url, mode);

    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.textContent = "Import";
    button.addEventListener("click", () => {
      state.selectedCandidate = candidate;
      renderCandidates();
      void importCandidate(candidate);
    });

    item.append(meta, button);
    candidateList.append(item);
  }
}

async function importCandidate(candidate) {
  const collectionId = Number(collectionSelect.value);
  if (!collectionId) {
    setResult("Collection required", "Select a target collection before importing.", "error");
    return;
  }

  setBusy(true);
  state.lastImportCandidate = candidate;
  try {
    await saveConfig({ quiet: true });
    const action = candidate.importType === "markdown" ? "Saving readable page" : state.importModeLabel;
    setResult(action, candidate.title || candidate.url);

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
      setResult("Import failed", `${response.error}${suffix}`, "error", { retry: true });
      return;
    }

    const tone = response.outcome.status === "failed" ? "error" : "success";
    const title = response.outcome.status === "duplicate" ? "Already in library" : response.outcome.status === "failed" ? "Import failed" : "Imported";
    setResult(title, response.outcome.message || "Import finished.", tone, { retry: response.outcome.status === "failed" });
  } catch (error) {
    setResult("Import failed", error.message, "error", { retry: true });
  } finally {
    setBusy(false);
  }
}

document.querySelector("#refreshButton").addEventListener("click", () => {
  void loadCollections().then(scanPage).catch((error) => setResult("Refresh failed", error.message, "error"));
});
document.querySelector("#scanButton").addEventListener("click", () => {
  void scanPage();
});
document.querySelector("#rescanButton").addEventListener("click", () => {
  void scanPage();
});
retryButton.addEventListener("click", () => {
  if (state.lastImportCandidate) void importCandidate(state.lastImportCandidate);
  else void scanPage();
});
collectionSelect.addEventListener("change", () => {
  state.config = { ...(state.config || {}), lastCollectionId: Number(collectionSelect.value) || null };
  void saveConfig({ quiet: true }).catch((error) => setConnection("Save failed", error.message, "error"));
});

void initialize().catch((error) => {
  setConnection("Setup needed", error.message, "error");
  setResult("Not ready", "Start or update Paper Reader, then refresh.", "error");
});
