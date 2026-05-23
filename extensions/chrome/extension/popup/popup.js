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

const CONNECTOR_RETRY_DELAY_MS = 2000;
const AUTO_IMPORT_DELAY_MS = 5000;

const state = {
  config: null,
  collections: [],
  collectionsLoaded: false,
  activeTabId: null,
  pageUrl: "",
  candidates: [],
  selectedCandidate: null,
  lastImportCandidate: null,
  busy: false,
  connectorTimer: null,
  connectorCycleRunning: false,
  autoImportTimer: null,
  autoImportDeadline: 0,
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
  updateActionAvailability();
}

function updateActionAvailability() {
  const hasCollection = hasValidSelectedCollection();
  collectionSelect.disabled = state.busy || !state.collectionsLoaded || state.collections.length === 0;
  for (const button of candidateList.querySelectorAll("button")) {
    button.disabled = state.busy || !hasCollection;
    button.title = hasCollection ? "" : "RustyReader collections are still loading.";
  }
}

function hasValidSelectedCollection() {
  const selectedId = Number(collectionSelect.value);
  return state.collectionsLoaded && state.collections.some((collection) => collection.id === selectedId);
}

function selectedCollectionName() {
  const selectedId = Number(collectionSelect.value);
  const collection = state.collections.find((item) => item.id === selectedId);
  return collection?.name || collectionSelect.selectedOptions[0]?.textContent?.trim() || "selected collection";
}

function cancelAutoImport() {
  if (state.autoImportTimer) clearTimeout(state.autoImportTimer);
  state.autoImportTimer = null;
  state.autoImportDeadline = 0;
}

function autoImportIsEligible() {
  return state.collectionsLoaded && state.candidates.length === 1 && hasValidSelectedCollection();
}

function updateAutoImportCountdown() {
  const secondsRemaining = Math.max(1, Math.ceil((state.autoImportDeadline - Date.now()) / 1000));
  setResult("Auto-saving", `Auto-saving in ${secondsRemaining}s to ${selectedCollectionName()}.`, "success");
}

function scheduleAutoImport() {
  cancelAutoImport();
  if (!autoImportIsEligible()) return;

  state.autoImportDeadline = Date.now() + AUTO_IMPORT_DELAY_MS;
  updateAutoImportCountdown();
  state.autoImportTimer = setTimeout(() => {
    state.autoImportTimer = null;
    state.autoImportDeadline = 0;
    if (autoImportIsEligible()) void importCandidate(state.candidates[0]);
  }, AUTO_IMPORT_DELAY_MS);
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
  renderCollectionPlaceholder("Waiting for RustyReader");

  scheduleConnectorRetry(0);
}

async function detectImportModeLabel() {
  const response = await sendMessage({ type: "paper-reader:get-capabilities" });
  return response?.hasDownloads ? "Download then import" : "Upload to RustyReader";
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
  setConnection("Checking RustyReader", "Looking for the local connector…");
  try {
    const { health } = await discoverConnectorUrl();
    const version = health.connector_version ? ` v${health.connector_version}` : "";
    setConnection("RustyReader connected", `${health.app_name || "Connector"}${version} is reachable.`, "success");
    return health;
  } catch (error) {
    setConnection("RustyReader not reachable", error.message, "error");
    throw error;
  }
}

async function loadCollections() {
  setConnection("Loading collections", "Fetching RustyReader collections…");
  const response = await sendMessage({ type: "paper-reader:load-collections" });
  state.collections = response.collections;
  state.config = response.config;
  state.collectionsLoaded = true;
  renderCollections();
  setConnection("RustyReader connected", `Loaded ${response.collections.length} collections.`, "success");
}

function renderCollectionPlaceholder(label) {
  collectionSelect.innerHTML = "";
  const option = document.createElement("option");
  option.textContent = label;
  option.value = "";
  collectionSelect.append(option);
  collectionCount.textContent = "0";
  updateActionAvailability();
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
    updateActionAvailability();
    return;
  }

  const hasLastCollection = rows.some((row) => row.id === state.config?.lastCollectionId);
  if (!hasLastCollection) {
    const option = document.createElement("option");
    option.textContent = "Choose collection";
    option.value = "";
    collectionSelect.append(option);
  }

  for (const row of rows) {
    const option = document.createElement("option");
    option.value = String(row.id);
    option.textContent = collectionLabel(row, row.depth);
    if (hasLastCollection && row.id === state.config?.lastCollectionId) option.selected = true;
    collectionSelect.append(option);
  }
  updateActionAvailability();
}

function scheduleConnectorRetry(delayMs = CONNECTOR_RETRY_DELAY_MS) {
  cancelAutoImport();
  if (state.connectorTimer) clearTimeout(state.connectorTimer);
  state.connectorTimer = setTimeout(() => {
    state.connectorTimer = null;
    void runConnectorCycle();
  }, delayMs);
}

async function runConnectorCycle() {
  if (state.connectorCycleRunning) return;

  state.connectorCycleRunning = true;
  try {
    setResult("Waiting for RustyReader", "Start RustyReader; collections will load automatically.", "error");
    await discoverConnector();
    await loadCollections();
    await scanPage();
  } catch (error) {
    state.collectionsLoaded = false;
    state.collections = [];
    renderCollectionPlaceholder("Waiting for RustyReader");
    setConnection("Waiting for RustyReader", error.message, "error");
    setResult("Waiting for RustyReader", "Start RustyReader; this popup will reconnect automatically.", "error");
    scheduleConnectorRetry();
  } finally {
    state.connectorCycleRunning = false;
  }
}

async function scanPage() {
  cancelAutoImport();
  if (!state.activeTabId) return;
  if (!state.collectionsLoaded) {
    setResult("Waiting for RustyReader", "Collections will load automatically when RustyReader is reachable.", "error");
    return;
  }
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
    scheduleAutoImport();
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
    button.disabled = state.busy || !state.collectionsLoaded || Number(collectionSelect.value) <= 0;
    button.addEventListener("click", () => {
      state.selectedCandidate = candidate;
      renderCandidates();
      void importCandidate(candidate);
    });

    item.append(meta, button);
    candidateList.append(item);
  }
  updateActionAvailability();
}

async function importCandidate(candidate) {
  cancelAutoImport();
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
  cancelAutoImport();
  scheduleConnectorRetry(0);
});
document.querySelector("#scanButton").addEventListener("click", () => {
  cancelAutoImport();
  void scanPage();
});
document.querySelector("#rescanButton").addEventListener("click", () => {
  cancelAutoImport();
  void scanPage();
});
retryButton.addEventListener("click", () => {
  cancelAutoImport();
  if (state.lastImportCandidate) void importCandidate(state.lastImportCandidate);
  else scheduleConnectorRetry(0);
});
collectionSelect.addEventListener("change", () => {
  state.config = { ...(state.config || {}), lastCollectionId: Number(collectionSelect.value) || null };
  updateActionAvailability();
  void saveConfig({ quiet: true })
    .then(() => scheduleAutoImport())
    .catch((error) => setConnection("Save failed", error.message, "error"));
});

void initialize().catch((error) => {
  setConnection("Setup needed", error.message, "error");
  setResult("Not ready", "Start or update RustyReader, then refresh.", "error");
});
