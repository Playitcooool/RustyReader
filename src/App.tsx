import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiPanel } from "./components/app/AiPanel";
import { DeleteConfirmDialog, type DeleteConfirmTarget } from "./components/app/DeleteConfirmDialog";
import { ErrorBoundary } from "./components/app/ErrorBoundary";
import { ActivePdfHighlightBar } from "./components/app/PdfHighlightBars";
import { ReaderWorkspace } from "./components/app/ReaderWorkspace";
import { ResourceSidebar } from "./components/app/ResourceSidebar";
import { SettingsDialog, type GeneralSettingsDraft } from "./components/app/SettingsDialog";
import { clamp, collectionDeleteSummary, readStoredBoolean, readStoredNumber, readStoredString, type AttachmentFilter, type ItemSort, type ReaderFitMode } from "./lib/appView";
import { isTauriRuntime } from "./lib/api";
import { getRuntimePolyfillDiagnostics } from "./lib/runtimePolyfills";
import type { AIProvider, AISettings, AppApi, Collection, ConnectorSettings, UpdateAISettingsInput } from "./lib/contracts";
import { useAiSessionState } from "./hooks/useAiSessionState";
import { useLibraryState } from "./hooks/useLibraryState";
import { useReaderState } from "./hooks/useReaderState";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 460;
const AI_PANEL_MIN_WIDTH = 320;
const AI_PANEL_MAX_WIDTH = 620;
const DEFAULT_SIDEBAR_WIDTH = 300;
const DEFAULT_AI_PANEL_WIDTH = 360;
const DEFAULT_ITEM_SORT: ItemSort = "recent";
const DEFAULT_ATTACHMENT_FILTER: AttachmentFilter = "all";
const DEFAULT_READER_FIT_MODE: ReaderFitMode = "fit_width";
const DEFAULT_READER_ZOOM = 100;
const SIDEBAR_WIDTH_KEY = "paper-reader.sidebar-width";
const AI_PANEL_WIDTH_KEY = "paper-reader.ai-panel-width";
const SIDEBAR_OPEN_KEY = "paper-reader.sidebar-open";
const ITEM_SORT_KEY = "paper-reader.item-sort";
const ATTACHMENT_FILTER_KEY = "paper-reader.attachment-filter";
const READER_FIT_MODE_KEY = "paper-reader.reader-fit-mode";
const READER_ZOOM_KEY = "paper-reader.reader-zoom";

const emptyAiSettingsDraft = (): UpdateAISettingsInput => ({
  active_provider: "openai",
  openai_model: "",
  openai_base_url: "",
  anthropic_model: "",
  anthropic_base_url: "",
  translation_provider: "openai",
  translation_openai_model: "",
  translation_anthropic_model: "",
  translation_target_lang: "ZH-HANS",
  deepl_base_url: "https://api-free.deepl.com",
});

const isPdfTextSelection = (selection: unknown): selection is import("./components/readers/pdfSelection").PdfTextSelection =>
  Boolean(selection && typeof selection === "object" && "anchor" in selection && typeof (selection as { anchor?: unknown }).anchor === "string");

const draftFromAiSettings = (settings: AISettings): UpdateAISettingsInput => ({
  active_provider: settings.active_provider,
  openai_model: settings.openai_model,
  openai_base_url: settings.openai_base_url,
  anthropic_model: settings.anthropic_model,
  anthropic_base_url: settings.anthropic_base_url,
  translation_provider: settings.translation_provider,
  translation_openai_model: settings.translation_openai_model,
  translation_anthropic_model: settings.translation_anthropic_model,
  translation_target_lang: settings.translation_target_lang,
  deepl_base_url: settings.deepl_base_url,
});

export default function App({ api }: { api: AppApi }) {
  const getApi = useCallback(() => Promise.resolve(api), [api]);
  const [statusMessage, setStatusMessage] = useState("Loading library...");
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => readStoredBoolean(SIDEBAR_OPEN_KEY, true));
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
  const [aiPanelWidth, setAiPanelWidth] = useState(() => readStoredNumber(AI_PANEL_WIDTH_KEY, DEFAULT_AI_PANEL_WIDTH));
  const [deleteTarget, setDeleteTarget] = useState<DeleteConfirmTarget | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<UpdateAISettingsInput>(emptyAiSettingsDraft);
  const [generalSettingsDraft, setGeneralSettingsDraft] = useState<GeneralSettingsDraft>({
    resourcesSidebarOpen: true,
    defaultItemSort: DEFAULT_ITEM_SORT,
    defaultAttachmentFilter: DEFAULT_ATTACHMENT_FILTER,
    defaultReaderFitMode: DEFAULT_READER_FIT_MODE,
    defaultReaderZoom: DEFAULT_READER_ZOOM,
  });
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [anthropicApiKeyDraft, setAnthropicApiKeyDraft] = useState("");
  const [deeplApiKeyDraft, setDeeplApiKeyDraft] = useState("");
  const [connectorSettings, setConnectorSettings] = useState<ConnectorSettings | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const aiComposerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const library = useLibraryState({
    api,
    onActivateItem: (item, options) => readerState.activateItem(item, options),
    setStatusMessage,
  });
  const readerState = useReaderState({
    api,
    libraryItems: library.libraryItems,
    setIsSidebarVisible,
    setStatusMessage,
  });
  const ai = useAiSessionState({
    api,
    collections: library.collections,
    libraryItems: library.libraryItems,
    selectedCollectionId: library.selectedCollectionId,
    activePaper: readerState.activePaper,
    openPapers: readerState.openPapers,
    setStatusMessage,
  });
  const previousWorkspaceModeRef = useRef(readerState.workspaceMode);

  const activeCollection = library.activeCollection;
  const activePaper = readerState.activePaper;
  const activePaperMetadata = useMemo(() => (activePaper ? [activePaper.authors, activePaper.publication_year, activePaper.source].filter(Boolean).join(" · ") || null : null), [activePaper]);
  const closeReaderFloatingUi = useCallback(() => {
    readerState.setIsFindHudOpen(false);
    readerState.setReaderSearchQuery("");
    readerState.setReaderSearchMatchIndex(0);
    readerState.setReaderSearchMatchCount(0);
    readerState.setReportedActiveSearchMatchIndex(-1);
    readerState.setPdfSelection(null);
    readerState.setReaderSelection(null);
    readerState.dismissActivePdfHighlight();
    readerState.closeTranslationPopover();
  }, [readerState]);

  const closeFindHud = useCallback(() => {
    readerState.setIsFindHudOpen(false);
    readerState.setReaderSearchQuery("");
    readerState.setReaderSearchMatchIndex(0);
    readerState.setReaderSearchMatchCount(0);
    readerState.setReportedActiveSearchMatchIndex(-1);
  }, [readerState]);

  const ensureAiPanelReady = useCallback(() => {
    if (readerState.workspaceMode === "pdf_focus") closeReaderFloatingUi();
    void ai.ensureSessionReady();
  }, [ai, closeReaderFloatingUi, readerState.workspaceMode]);

  const handleOpenEvidenceCitation = useCallback(async (evidenceId: number) => {
    const target = await (await getApi()).locateEvidenceChunk(evidenceId);
    if (!target) {
      setStatusMessage(`Evidence E${evidenceId} is no longer available.`);
      return;
    }
    const item = library.libraryItems.find((entry) => entry.id === target.item_id);
    if (!item) {
      setStatusMessage(`Evidence E${evidenceId} belongs to a paper outside the current library view.`);
      return;
    }
    readerState.activateItem(item, { focusPdf: item.attachment_format === "pdf" });
    if (item.attachment_format === "pdf" && target.page_number) {
      readerState.setReaderPageClamped(target.page_number - 1);
    }
    const prefix = target.text_prefix.slice(0, 80).trim();
    if (prefix) {
      readerState.setReaderSearchQuery(prefix);
      readerState.setReaderSearchMatchIndex(0);
      readerState.openFindHud();
    }
  }, [getApi, library.libraryItems, readerState]);

  const focusAiComposer = useCallback(() => {
    requestAnimationFrame(() => {
      aiComposerInputRef.current?.focus();
    });
  }, []);

  const selectionCitation = useCallback((selectionOverride?: typeof readerState.pdfSelection | typeof readerState.translationSelection | null) => {
    const selection = selectionOverride ?? readerState.pdfSelection ?? readerState.translationSelection;
    if (!readerState.activePaper || !selection?.quote.trim()) return null;
    let page = "";
    if (isPdfTextSelection(selection)) {
      try {
        const anchor = JSON.parse(selection.anchor) as { page?: number };
        page = typeof anchor.page === "number" ? `, p. ${anchor.page}` : "";
      } catch {
        page = "";
      }
    }
    return `> ${selection.quote.trim()}\n\nSource: ${readerState.activePaper.title}${page}`;
  }, [readerState.activePaper, readerState.pdfSelection, readerState.translationSelection]);

  const ensureAiSessionWithCurrentPaper = useCallback(async () => {
    const sessionId = await ai.ensureSessionReady();
    if (readerState.activePaper) {
      await (await getApi()).addAiSessionReference({ session_id: sessionId, kind: "item", target_id: readerState.activePaper.id });
      await ai.refreshActiveAiSession(sessionId);
    }
    return sessionId;
  }, [ai, getApi, readerState.activePaper]);

  const handleOpenCopilotWithSelection = useCallback(async (quoted: string | null) => {
    await ensureAiSessionWithCurrentPaper();
    if (quoted) ai.setAiComposerValue(`${quoted}\n\nQuestion: `);
    focusAiComposer();
  }, [ai, ensureAiSessionWithCurrentPaper, focusAiComposer]);

  const handleAskWithSelection = useCallback(async () => {
    const quoted = selectionCitation();
    if (!quoted) return;
    await handleOpenCopilotWithSelection(quoted);
  }, [handleOpenCopilotWithSelection, selectionCitation]);

  const handleAddHighlightToSession = useCallback(async () => {
    const quoted = selectionCitation();
    if (readerState.pdfSelection) {
      await readerState.handleCreatePdfFocusHighlight("yellow");
    }
    if (!quoted || !readerState.activePaper) return;
    await handleOpenCopilotWithSelection(quoted);
  }, [handleOpenCopilotWithSelection, readerState, selectionCitation]);

  const handleSaveSelectionAsNote = useCallback(async () => {
    const quoted = selectionCitation();
    if (!quoted || !readerState.activePaper) return;
    const sessionId = ai.activeAiSessionId ?? null;
    const note = await (await getApi()).createResearchNote({
      collection_id: readerState.activePaper.collection_id,
      session_id: sessionId,
      title: `${readerState.activePaper.title} Selection`,
      markdown: `# ${readerState.activePaper.title} Selection\n\n${quoted}`,
    });
    if (sessionId) {
      const notes = await (await getApi()).listAiSessionNotes(sessionId);
      ai.setNotes(notes);
      ai.setActiveNoteId(note.id);
      ai.setNoteDraft(note.markdown);
    }
    setStatusMessage("Saved selection as a note.");
  }, [ai, getApi, readerState.activePaper, selectionCitation]);

  const closeAiPanel = useCallback(() => {
    if (readerState.workspaceMode === "pdf_focus") closeReaderFloatingUi();
    ai.closeAiPanel();
  }, [ai, closeReaderFloatingUi, readerState.workspaceMode]);

  useEffect(() => {
    const previousWorkspaceMode = previousWorkspaceModeRef.current;
    previousWorkspaceModeRef.current = readerState.workspaceMode;
    if (previousWorkspaceMode === readerState.workspaceMode || readerState.workspaceMode !== "pdf_focus") return;
    ai.setIsAiSessionHistoryOpen(false);
    ai.setAiDockOpen({ artifacts: false, history: false, notes: false });
    if (ai.isReferencePickerOpen) ai.toggleAiReferencePicker();
    closeReaderFloatingUi();
  }, [ai, closeReaderFloatingUi, readerState.workspaceMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getRuntimePolyfillDiagnostics();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    window.localStorage.setItem(AI_PANEL_WIDTH_KEY, String(aiPanelWidth));
    if (readerState.workspaceMode === "workspace") {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(isSidebarVisible));
    }
    window.localStorage.setItem(ITEM_SORT_KEY, library.itemSort);
    window.localStorage.setItem(ATTACHMENT_FILTER_KEY, library.attachmentFilter);
    window.localStorage.setItem(READER_FIT_MODE_KEY, readerState.readerFitMode);
    window.localStorage.setItem(READER_ZOOM_KEY, String(readerState.readerZoom));
  }, [aiPanelWidth, isSidebarVisible, library.attachmentFilter, library.itemSort, readerState.readerFitMode, readerState.readerZoom, readerState.workspaceMode, sidebarWidth]);

  useEffect(() => {
    if (readerState.workspaceMode !== "workspace") return;
    if (activePaper || readerState.openPapers.length > 0 || isSidebarVisible) return;
    setIsSidebarVisible(true);
  }, [activePaper, isSidebarVisible, readerState.openPapers.length, readerState.workspaceMode]);

  const openSettingsDialog = useCallback(async () => {
    const runtimeApi = await getApi();
    const [settings, connector] = await Promise.all([
      runtimeApi.getAiSettings(),
      runtimeApi.getConnectorSettings(),
    ]);
    setAiSettings(settings);
    setConnectorSettings(connector);
    setAiSettingsDraft(draftFromAiSettings(settings));
    setGeneralSettingsDraft({
      resourcesSidebarOpen: readStoredBoolean(SIDEBAR_OPEN_KEY, true),
      defaultItemSort: readStoredString(ITEM_SORT_KEY, DEFAULT_ITEM_SORT, ["recent", "title", "year_desc"] as const),
      defaultAttachmentFilter: readStoredString(ATTACHMENT_FILTER_KEY, DEFAULT_ATTACHMENT_FILTER, ["all", "ready", "missing", "citation_only"] as const),
      defaultReaderFitMode: readStoredString(READER_FIT_MODE_KEY, DEFAULT_READER_FIT_MODE, ["fit_width", "manual"] as const),
      defaultReaderZoom: readStoredNumber(READER_ZOOM_KEY, DEFAULT_READER_ZOOM),
    });
    setOpenAiApiKeyDraft("");
    setAnthropicApiKeyDraft("");
    setDeeplApiKeyDraft("");
    setIsSettingsOpen(true);
  }, [getApi]);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsOpen(false);
    setOpenAiApiKeyDraft("");
    setAnthropicApiKeyDraft("");
    setDeeplApiKeyDraft("");
  }, []);

  const handleSaveAiSettings = useCallback(async () => {
    const next = await (await getApi()).updateAiSettings({
      ...aiSettingsDraft,
      openai_api_key: openAiApiKeyDraft.trim() ? openAiApiKeyDraft : undefined,
      anthropic_api_key: anthropicApiKeyDraft.trim() ? anthropicApiKeyDraft : undefined,
      deepl_api_key: deeplApiKeyDraft.trim() ? deeplApiKeyDraft : undefined,
    });
    setIsSidebarVisible(generalSettingsDraft.resourcesSidebarOpen);
    library.setItemSort?.(generalSettingsDraft.defaultItemSort);
    library.setAttachmentFilter(generalSettingsDraft.defaultAttachmentFilter);
    readerState.setReaderFitMode(generalSettingsDraft.defaultReaderFitMode);
    readerState.setReaderZoom(clamp(generalSettingsDraft.defaultReaderZoom, 70, 180));
    setAiSettings(next);
    setAiSettingsDraft(draftFromAiSettings(next));
    setOpenAiApiKeyDraft("");
    setAnthropicApiKeyDraft("");
    setDeeplApiKeyDraft("");
    setIsSettingsOpen(false);
    setStatusMessage("Saved settings.");
  }, [aiSettingsDraft, anthropicApiKeyDraft, deeplApiKeyDraft, generalSettingsDraft, getApi, library, openAiApiKeyDraft, readerState]);

  const handleClearSavedKey = useCallback(async (provider: AIProvider | "deepl") => {
    const next = await (await getApi()).updateAiSettings({
      ...aiSettingsDraft,
      clear_openai_api_key: provider === "openai" ? true : undefined,
      clear_anthropic_api_key: provider === "anthropic" ? true : undefined,
      clear_deepl_api_key: provider === "deepl" ? true : undefined,
    });
    setAiSettings(next);
    setAiSettingsDraft(draftFromAiSettings(next));
    if (provider === "openai") setOpenAiApiKeyDraft("");
    else if (provider === "anthropic") setAnthropicApiKeyDraft("");
    else setDeeplApiKeyDraft("");
    setStatusMessage(`${provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "DeepL"} API key cleared.`);
  }, [aiSettingsDraft, getApi]);

  const handleRegenerateConnectorToken = useCallback(async () => {
    const next = await (await getApi()).regenerateConnectorToken();
    setConnectorSettings(next);
    setStatusMessage("Regenerated connector token.");
  }, [getApi]);

  useEffect(() => {
    if (!isTauriRuntime() || !(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return;
    let unlistenDocs: null | (() => void) = null;
    let unlistenCitations: null | (() => void) = null;
    let unlistenSettings: null | (() => void) = null;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenDocs = await listen("menu:import-documents", () => library.importDocumentsRef.current());
      unlistenCitations = await listen("menu:import-citations", () => library.importCitationsRef.current());
      unlistenSettings = await listen("menu:open-settings", () => {
        void openSettingsDialog();
      });
    })();
    return () => {
      unlistenDocs?.();
      unlistenCitations?.();
      unlistenSettings?.();
    };
  }, [library.importCitationsRef, library.importDocumentsRef, openSettingsDialog]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: null | (() => void) = null;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "enter") {
            library.setDraggedFileCount(event.payload.paths.filter((path) => path.endsWith(".pdf") || path.endsWith(".docx") || path.endsWith(".epub")).length);
            return;
          }
          if (event.payload.type === "leave") {
            library.setDraggedFileCount(0);
            return;
          }
          if (event.payload.type === "drop") {
            library.importPathsRef.current(event.payload.paths, "drag & drop");
          }
        });
      } catch {
        // Ignore unavailable desktop drag/drop during tests.
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [library]);

  useEffect(() => {
    function handleWindowKeydown(event: KeyboardEvent) {
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (!isEditable && event.key.toLowerCase() === "t" && (event.metaKey || event.ctrlKey)) {
        if (readerState.translationSelection || readerState.pdfSelection) {
          event.preventDefault();
          void readerState.requestSelectionTranslation();
        }
        return;
      }
      if (!isEditable && event.key.toLowerCase() === "f" && (event.metaKey || event.ctrlKey) && readerState.textToolsEnabled) {
        event.preventDefault();
        readerState.openFindHud();
        return;
      }
      if (!isEditable && event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        const selection = readerState.pdfSelection ?? readerState.translationSelection;
        const quoted = selectionCitation(selection);
        void handleOpenCopilotWithSelection(quoted);
        return;
      }
      if (event.key === "Escape" && readerState.translationPopover) {
        readerState.closeTranslationPopover();
        return;
      }
      if (event.key === "Escape" && readerState.workspaceMode === "pdf_focus") {
        readerState.setWorkspaceMode("workspace");
        setIsSidebarVisible(true);
      }
    }
    window.addEventListener("keydown", handleWindowKeydown);
    return () => window.removeEventListener("keydown", handleWindowKeydown);
  }, [handleOpenCopilotWithSelection, readerState, selectionCitation, setIsSidebarVisible]);

  const startPaneResize = useCallback((target: "sidebar" | "ai", event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 820) return;
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startAiPanelWidth = aiPanelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (target === "sidebar") setSidebarWidth(clamp(startSidebarWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      else setAiPanelWidth(clamp(startAiPanelWidth - delta, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [aiPanelWidth, sidebarWidth]);

  const handleRequestDeleteCollection = useCallback((collection: Collection) => {
    const summary = collectionDeleteSummary(library.collections, library.libraryItems, collection.id);
    setDeleteTarget({ kind: "collection", targetId: collection.id, label: collection.name, parentCollectionId: collection.parent_id, ...summary });
    library.setResourceContextMenu(null);
  }, [library.collections, library.libraryItems, library]);

  const handleRequestDeleteItem = useCallback((item: { id: number; title: string; collection_id: number }) => {
    setDeleteTarget({ kind: "item", targetId: item.id, label: item.title, parentCollectionId: item.collection_id });
    library.setResourceContextMenu(null);
  }, [library]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const runtimeApi = await getApi();
    try {
      if (deleteTarget.kind === "ai_session") {
        const deletedSessionId = deleteTarget.targetId;
        const wasActiveSession = ai.activeAiSessionId === deletedSessionId;
        await runtimeApi.deleteAiSession(deletedSessionId);
        const remainingSessions = await runtimeApi.listAiSessions();
        ai.setAiSessions(remainingSessions);
        ai.setActiveAiSessionId(wasActiveSession ? (remainingSessions[0]?.id ?? null) : ai.activeAiSessionId);
        if (wasActiveSession && remainingSessions.length === 0) {
          const session = await runtimeApi.createAiSession();
          ai.setAiSessions([session]);
          ai.setActiveAiSessionId(session.id);
          await ai.refreshActiveAiSession(session.id);
        }
        setStatusMessage(`Deleted ${deleteTarget.label}.`);
      } else if (deleteTarget.kind === "item") {
        const deletedItemId = deleteTarget.targetId;
        const remainingOpenPaperIds = readerState.openPaperIds.filter((itemId) => itemId !== deletedItemId);
        await runtimeApi.removeItem({ item_id: deletedItemId });
        await library.loadLibrary();
        readerState.cleanupAfterItemDelete(deletedItemId, remainingOpenPaperIds);
        ai.cleanupAfterItemDelete(deletedItemId);
        library.setSelectedItemIds((current: number[]) => current.filter((itemId) => itemId !== deletedItemId));
        if (ai.activeAiSessionId) await ai.refreshActiveAiSession(ai.activeAiSessionId);
        setStatusMessage(`Deleted ${deleteTarget.label}.`);
      } else {
        const deletedCollectionIds = new Set(deleteTarget.deletedCollectionIds ?? [deleteTarget.targetId]);
        const deletedItemIds = new Set(deleteTarget.deletedItemIds ?? []);
        const remainingOpenPaperIds = readerState.openPaperIds.filter((itemId) => !deletedItemIds.has(itemId));
        await runtimeApi.removeCollection({ collection_id: deleteTarget.targetId });
        await library.loadLibrary();
        await library.refreshCollections(deleteTarget.parentCollectionId);
        readerState.cleanupAfterCollectionDelete(deletedItemIds, remainingOpenPaperIds);
        ai.cleanupAfterCollectionDelete(deletedCollectionIds, deletedItemIds);
        library.setSelectedItemIds((current: number[]) => current.filter((itemId) => !deletedItemIds.has(itemId)));
        setStatusMessage(`Deleted ${deleteTarget.label}.`);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Failed to delete ${deleteTarget.label}.`);
    } finally {
      setDeleteTarget(null);
    }
  }, [ai, deleteTarget, getApi, library, readerState]);

  const showActivePdfHighlightBar = Boolean(readerState.activePdfHighlight);
  const activePdfHighlightBarStyle = useMemo(() => {
    const rect = readerState.activePdfHighlight?.rect;
    if (!rect) return {};
    const BAR_WIDTH_PX = 172;
    const BAR_HEIGHT_PX = 44;
    const GAP_PX = 10;
    const PADDING_PX = 12;
    let left = rect.right + GAP_PX;
    let top = rect.top - BAR_HEIGHT_PX - GAP_PX;
    if (top < PADDING_PX) top = rect.bottom + GAP_PX;
    left = clamp(left, PADDING_PX, window.innerWidth - BAR_WIDTH_PX - PADDING_PX);
    top = clamp(top, PADDING_PX, window.innerHeight - BAR_HEIGHT_PX - PADDING_PX);
    return { left: `${left}px`, top: `${top}px` } as const;
  }, [readerState.activePdfHighlight]);

  return (
    <div
      ref={appShellRef}
      className={`app-shell ${readerState.workspaceMode === "pdf_focus" ? "app-shell-focus" : "app-shell-workspace"} ${ai.isAiPanelOpen ? "app-shell-ai-open" : ""}`}
      style={{ "--sidebar-width": `${clamp(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)}px`, "--ai-panel-width": `${clamp(aiPanelWidth, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH)}px` } as CSSProperties}
    >
      {!ai.isAiPanelOpen ? (
        <div className="status-pill app-status" role="status">
          {statusMessage}
        </div>
      ) : null}
      {library.resourceContextMenu && (library.contextMenuCollection || library.contextMenuItem) ? (
        <div ref={library.resourceContextMenuRef} aria-label="Resource actions" className="floating-menu resource-context-menu" role="menu" style={{ left: library.resourceContextMenu.x, top: library.resourceContextMenu.y }}>
          {library.contextMenuCollection ? (
            <>
              <button className="nav-item" role="menuitem" type="button" onClick={() => library.startCreateCollection(library.contextMenuCollection?.id ?? null)}>New Folder</button>
              <button className="nav-item" role="menuitem" type="button" onClick={() => library.contextMenuCollection && library.startRenameCollection(library.contextMenuCollection)}>Rename</button>
              <button className="nav-item resource-context-menu-delete" role="menuitem" type="button" onClick={() => library.contextMenuCollection && handleRequestDeleteCollection(library.contextMenuCollection)}>Delete</button>
            </>
          ) : null}
          {library.contextMenuItem ? (
            <>
              <button className="nav-item" role="menuitem" type="button" onClick={() => { readerState.activateItem(library.contextMenuItem!); library.setResourceContextMenu(null); }}>Open</button>
              <button className="nav-item resource-context-menu-delete" role="menuitem" type="button" onClick={() => handleRequestDeleteItem(library.contextMenuItem!)}>Delete</button>
            </>
          ) : null}
        </div>
      ) : null}

      {isSidebarVisible ? (
        <ResourceSidebar
          activePaperId={activePaper?.id ?? null}
          attachmentFilter={library.attachmentFilter}
          batchMoveTargetId={library.batchMoveTargetId}
          batchTagName={library.batchTagName}
          collectionDraftName={library.collectionDraftName}
          collections={library.collections}
          creatingCollectionParentId={library.creatingCollectionParentId}
          draggedFileCount={library.draggedFileCount}
          expandedCollectionIds={library.expandedCollectionIds}
          isManageOpen={library.isManageOpen}
          itemSort={library.itemSort}
          lastImportResult={library.lastImportResult}
          libraryItems={library.libraryItems}
          manageButtonRef={library.manageButtonRef}
          managePopoverRef={library.managePopoverRef}
          newTagName={library.newTagName}
          onActivateItem={(item, options) => readerState.activateItem(item, options)}
          onBatchMove={library.handleBatchMove}
          onBatchMoveTargetChange={library.setBatchMoveTargetId}
          onBatchTag={library.handleBatchTag}
          onBatchTagNameChange={library.setBatchTagName}
          onCancelCollectionInlineEdit={library.cancelCollectionInlineEdit}
          onContextMenu={library.openResourceContextMenu}
          onCreateCollection={library.handleCreateCollection}
          onCreateTag={() => library.handleCreateTag(activePaper)}
          onDragCountChange={library.setDraggedFileCount}
          onImportPaths={library.importPaths}
          onNewTagNameChange={library.setNewTagName}
          onSearchChange={library.setSearch}
          onSelectedCollectionChange={library.setSelectedCollectionId}
          onSelectedTagChange={library.setSelectedTagId}
          onSetCollectionDraftName={library.setCollectionDraftName}
          onStartCreateCollection={library.startCreateCollection}
          onStartRenameCollection={library.startRenameCollection}
          onSubmitCollectionRename={library.submitCollectionRename}
          onToggleCollectionExpanded={library.toggleCollectionExpanded}
          onToggleManage={() => library.setIsManageOpen((current: boolean) => !current)}
          renamingCollectionId={library.renamingCollectionId}
          search={library.search}
          selectedCollectionId={library.selectedCollectionId}
          selectedItemIds={library.selectedItemIds}
          selectedTagId={library.selectedTagId}
          setAttachmentFilter={library.setAttachmentFilter}
          setItemSort={library.setItemSort}
          tags={library.tags}
          treeSearchFilter={library.treeSearchFilter}
        />
      ) : null}

      {isSidebarVisible && readerState.workspaceMode !== "pdf_focus" ? <div aria-hidden="true" className="pane-resizer" onPointerDown={(event) => startPaneResize("sidebar", event)} /> : null}

      <ReaderWorkspace
        data={{
          activePaper,
          activePaperMetadata,
          annotations: readerState.annotations,
          currentReaderHtml: readerState.currentReaderHtml,
          hasCollections: library.hasCollections,
          openPapers: readerState.openPapers,
          readerView: readerState.readerView,
        }}
        pdfApi={{
          getPdfDocumentInfo: readerState.getPdfDocumentInfo,
          getPdfInitialPageBundle: readerState.getPdfInitialPageBundle,
          getPdfPageBundle: readerState.getPdfPageBundle,
          getPdfPageBundlesBatch: readerState.getPdfPageBundlesBatch,
          getPdfPageText: readerState.getPdfPageText,
          getPdfPageTextsBatch: readerState.getPdfPageTextsBatch,
          readPrimaryAttachmentBytes: readerState.readPrimaryAttachmentBytes,
          onOcrPdfPage: readerState.ocrPdfPage,
          pdfEngineSearch: readerState.pdfEngineSearch,
        }}
        ui={{
          isAiPanelOpen: ai.isAiPanelOpen,
          isFindHudOpen: readerState.isFindHudOpen,
          pdfFocusHighlightBarRef: readerState.pdfFocusHighlightBarRef,
          pdfSelection: readerState.pdfSelection,
          readerFitMode: readerState.readerFitMode,
          readerPage: readerState.readerPage,
          readerPageCount: readerState.readerPageCount,
          readerPageInput: readerState.readerPageInput,
          readerSearchInputRef: readerState.readerSearchInputRef,
          readerSearchMatchCount: readerState.readerSearchMatchCount,
          readerSearchMatchIndex: readerState.readerSearchMatchIndex,
          readerSearchQuery: readerState.readerSearchQuery,
          readerZoom: readerState.readerZoom,
          reportedActiveSearchMatchIndex: readerState.reportedActiveSearchMatchIndex,
          textToolsEnabled: readerState.textToolsEnabled,
          translationError: readerState.translationError,
          translationLoading: readerState.translationLoading,
          translationPopover: readerState.translationPopover,
          translationSelection: readerState.translationSelection,
          workspaceMode: readerState.workspaceMode,
        }}
        actions={{
          onActivateItem: (item, options) => readerState.activateItem(item, options),
          onActivePdfHighlight: readerState.handleActivatePdfHighlight,
          onAiToggle: () => {
            if (ai.isAiPanelOpen) {
              closeAiPanel();
              return;
            }
            ensureAiPanelReady();
          },
          onClearReaderSelection: readerState.clearReaderSelection,
          onCloseFindHud: closeFindHud,
          onCloseTab: readerState.closePaperTab,
          onCloseTranslationPopover: readerState.closeTranslationPopover,
          onCopyReaderSelection: readerState.copyReaderSelection,
          onCreatePdfFocusHighlight: readerState.handleCreatePdfFocusHighlight,
          onAskWithSelection: handleAskWithSelection,
          onAddHighlightToSession: handleAddHighlightToSession,
          onSaveSelectionAsNote: handleSaveSelectionAsNote,
          onCreatePdfFocusTextBoxAnnotation: readerState.handleCreatePdfFocusTextBoxAnnotation,
          onUpdatePdfTextBoxAnnotation: readerState.handleUpdatePdfTextBoxAnnotation,
          onRemovePdfTextBoxAnnotation: readerState.handleRemovePdfTextBoxAnnotation,
          onExitFocus: () => { readerState.setWorkspaceMode("workspace"); setIsSidebarVisible(true); },
          onFindQueryChange: readerState.setReaderSearchQuery,
          onMoveMatch: (direction) => readerState.setReaderSearchMatchIndex((current: number) => current + direction),
          onPdfZoomChange: readerState.setPdfZoomManual,
          onReaderFitModeChange: readerState.setReaderFitMode,
          onReaderPageChange: readerState.setReaderPageClamped,
          onReaderPageInputChange: readerState.setReaderPageInput,
          onReaderPageSubmit: readerState.handleReaderPageSubmit,
          onReaderSearchMatchesChange: ({ total, activeIndex }) => { readerState.setReaderSearchMatchCount(total); readerState.setReportedActiveSearchMatchIndex(activeIndex); },
          onRequestSelectionTranslation: readerState.requestSelectionTranslation,
          onSearchReaderSelection: readerState.searchReaderSelection,
          onSelectionChange: (selection) => {
            readerState.setReaderSelection(selection);
            readerState.setPdfSelection(isPdfTextSelection(selection) ? selection : null);
            if (selection) readerState.dismissActivePdfHighlight();
          },
          onShowLibrary: () => setIsSidebarVisible(true),
          onStepNormalizedZoom: readerState.stepNormalizedZoom,
          openFindHud: readerState.openFindHud,
          setPdfPageCount: (pageCount) => activePaper && readerState.setPdfPageCounts((current: Record<number, number>) => current[activePaper.id] === pageCount ? current : { ...current, [activePaper.id]: pageCount }),
        }}
      />

      {showActivePdfHighlightBar ? <ActivePdfHighlightBar barRef={readerState.highlightActionBarRef} style={activePdfHighlightBarStyle} onRemoveHighlight={() => void readerState.handleRemoveActivePdfHighlight()} /> : null}

      {ai.isAiPanelOpen ? (
        <>
          <div aria-hidden="true" className="pane-resizer" onPointerDown={(event) => startPaneResize("ai", event)} />
          <ErrorBoundary
            resetKey={ai.activeAiSessionId}
            fallback={
              <aside className="ai-shell" aria-label="AI panel">
                <div className="ai-shell-header">
                  <div className="ai-copilot-header">
                    <div className="ai-copilot-heading">
                      <span className="ai-copilot-title">Copilot</span>
                      <span className="meta-count">Panel crashed</span>
                    </div>
                    <button className="icon-button" type="button" aria-label="Close AI panel" onClick={closeAiPanel}>
                      ×
                    </button>
                  </div>
                </div>
                <div className="ai-empty-state" role="alert">
                  AI panel failed to render. Close and reopen it to retry.
                </div>
              </aside>
            }
          >
            <AiPanel
              activeAiPending={ai.activeAiPending}
              activeAiSession={ai.activeAiSession}
              activeAiSessionId={ai.activeAiSessionId}
              activeNoteId={ai.activeNoteId}
              aiChatHistoryRef={ai.aiChatHistoryRef}
              aiComposerInputRef={aiComposerInputRef}
              aiComposerValue={ai.aiComposerValue}
              aiDockOpen={ai.aiDockOpen}
              aiPanelCanSend={ai.aiPanelCanSend}
              aiReferenceButtonRef={ai.aiReferenceButtonRef}
              aiReferenceCollectionIds={ai.aiReferenceCollectionIds}
              aiReferenceItemIds={ai.aiReferenceItemIds}
              aiReferencePickerResults={ai.aiReferencePickerResults}
              aiReferencePopoverRef={ai.aiReferencePopoverRef}
              aiReferenceQuery={ai.aiReferenceQuery}
              aiReferenceSearchError={ai.aiReferenceSearchError}
              aiReferenceSearchInputRef={ai.aiReferenceSearchInputRef}
              aiReferenceSearchLoading={ai.aiReferenceSearchLoading}
              aiSessionArtifact={ai.aiSessionArtifact}
              aiSessionReferences={ai.aiSessionReferences}
              aiSessionTaskRuns={ai.aiSessionTaskRuns}
              aiSessionThreadRuns={ai.aiSessionThreadRuns}
              aiSessions={ai.aiSessions}
              areQuickActionsDisabled={ai.areQuickActionsDisabled}
              collections={library.collections}
              compareEnabled={ai.compareEnabled}
              isAiSessionHistoryOpen={ai.isAiSessionHistoryOpen}
              isReferencePickerOpen={ai.isReferencePickerOpen}
              libraryItems={library.libraryItems}
              noteDraft={ai.noteDraft}
              notes={ai.notes}
              onAiComposerChange={ai.setAiComposerValue}
              onAiReferenceQueryChange={ai.setAiReferenceQuery}
              onClosePanel={closeAiPanel}
              onCreateResearchNote={ai.handleCreateResearchNote}
              onCreateSession={ai.handleCreateAiSession}
              onDeleteSession={(session) => setDeleteTarget({ kind: "ai_session", targetId: session.id, label: session.title })}
              onExportMarkdown={ai.handleExportMarkdown}
              onOpenSession={(sessionId) => { ai.setActiveAiSessionId(sessionId); ai.setIsAiSessionHistoryOpen(false); }}
              onQuickAction={ai.handleQuickAction}
              onAddReference={ai.handleAddAiReference}
              onOpenEvidenceCitation={handleOpenEvidenceCitation}
              onRemoveReference={ai.handleRemoveAiReference}
              onSaveNoteEdits={ai.handleSaveNoteEdits}
              onSelectNote={(note) => { ai.setActiveNoteId(note.id); ai.setNoteDraft(note.markdown); }}
              onSendPrompt={ai.handleAiSubmit}
              onToggleDockSection={ai.toggleAiDockSection}
              onToggleReferencePicker={ai.toggleAiReferencePicker}
              onToggleSessionHistory={() => ai.setIsAiSessionHistoryOpen((current: boolean) => !current)}
              onUpdateNoteDraft={ai.setNoteDraft}
            />
          </ErrorBoundary>
        </>
      ) : null}

      {deleteTarget ? <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleConfirmDelete()} /> : null}

      {isSettingsOpen ? (
        <SettingsDialog
          generalSettingsDraft={generalSettingsDraft}
          aiSettings={aiSettings}
          connectorSettings={connectorSettings}
          aiSettingsDraft={aiSettingsDraft}
          openAiApiKeyDraft={openAiApiKeyDraft}
          anthropicApiKeyDraft={anthropicApiKeyDraft}
          deeplApiKeyDraft={deeplApiKeyDraft}
          readerMinZoom={70}
          readerMaxZoom={180}
          defaultReaderZoom={DEFAULT_READER_ZOOM}
          onGeneralSettingsDraftChange={setGeneralSettingsDraft}
          onAiSettingsDraftChange={setAiSettingsDraft}
          onOpenAiApiKeyDraftChange={setOpenAiApiKeyDraft}
          onAnthropicApiKeyDraftChange={setAnthropicApiKeyDraft}
          onDeeplApiKeyDraftChange={setDeeplApiKeyDraft}
          onClampReaderZoom={(value) => clamp(value, 70, 180)}
          onResetLayoutWidths={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            setAiPanelWidth(DEFAULT_AI_PANEL_WIDTH);
          }}
          onClearSavedKey={(provider) => void handleClearSavedKey(provider)}
          onRegenerateConnectorToken={() => void handleRegenerateConnectorToken()}
          onCancel={closeSettingsDialog}
          onSave={() => void handleSaveAiSettings()}
        />
      ) : null}
    </div>
  );
}
