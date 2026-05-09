import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readStoredNumber, readStoredString, type ReaderFitMode } from "../lib/appView";
import type { AIArtifact, AITask, Annotation, AppApi, LibraryItem, ReaderView } from "../lib/contracts";
import type { PdfHighlightColor, PdfTextSelection } from "../components/readers/pdfSelection";
import { useAppApi } from "./useAppApi";

export type WorkspaceMode = "workspace" | "pdf_focus";
export type ActivePdfHighlight = {
  annotationId: number;
  rect: { left: number; top: number; right: number; bottom: number };
};
export type ReaderTextSelection = {
  quote: string;
  rect: { left: number; top: number; right: number; bottom: number };
};
export type PdfTextBoxAnnotationDraft = {
  anchor: string;
  body: string;
};
export type TranslationPopover = {
  rect: ReaderTextSelection["rect"];
  translatedText: string;
};

const DEFAULT_READER_FIT_MODE: ReaderFitMode = "fit_width";
const DEFAULT_READER_ZOOM = 100;
const READER_MIN_ZOOM = 70;
const READER_MAX_ZOOM = 180;
const READER_ZOOM_STEP = 10;
const READER_FIT_MODE_KEY = "paper-reader.reader-fit-mode";
const READER_ZOOM_KEY = "paper-reader.reader-zoom";

export function useReaderState({
  api,
  libraryItems,
  setIsSidebarVisible,
  setStatusMessage,
}: {
  api: AppApi;
  libraryItems: LibraryItem[];
  setIsSidebarVisible: (value: React.SetStateAction<boolean>) => void;
  setStatusMessage: (value: string) => void;
}) {
  const getApi = useAppApi(api);
  const readerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const readerLoadRequestIdRef = useRef(0);
  const highlightActionBarRef = useRef<HTMLDivElement | null>(null);
  const pdfFocusHighlightBarRef = useRef<HTMLDivElement | null>(null);

  const [openPaperIds, setOpenPaperIds] = useState<number[]>([]);
  const [activePaperId, setActivePaperId] = useState<number | null>(null);
  const [readerView, setReaderView] = useState<ReaderView | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [paperArtifact, setPaperArtifact] = useState<AIArtifact | null>(null);
  const [paperTaskRuns, setPaperTaskRuns] = useState<AITask[]>([]);
  const [collectionArtifact, setCollectionArtifact] = useState<AIArtifact | null>(null);
  const [collectionTaskRuns, setCollectionTaskRuns] = useState<AITask[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("workspace");
  const [readerPage, setReaderPage] = useState(0);
  const [readerPageInput, setReaderPageInput] = useState("1");
  const [readerZoom, setReaderZoom] = useState(() => readStoredNumber(READER_ZOOM_KEY, DEFAULT_READER_ZOOM));
  const [readerFitMode, setReaderFitMode] = useState<ReaderFitMode>(() =>
    readStoredString(READER_FIT_MODE_KEY, DEFAULT_READER_FIT_MODE, ["fit_width", "manual"] as const),
  );
  const [readerSearchQuery, setReaderSearchQuery] = useState("");
  const [isFindHudOpen, setIsFindHudOpen] = useState(false);
  const [readerSearchMatchIndex, setReaderSearchMatchIndex] = useState(0);
  const [readerSearchMatchCount, setReaderSearchMatchCount] = useState(0);
  const [reportedActiveSearchMatchIndex, setReportedActiveSearchMatchIndex] = useState(-1);
  const [pdfPageCounts, setPdfPageCounts] = useState<Record<number, number>>({});
  const [pdfSelection, setPdfSelection] = useState<PdfTextSelection | null>(null);
  const [translationSelection, setTranslationSelection] = useState<ReaderTextSelection | null>(null);
  const [translationPopover, setTranslationPopover] = useState<TranslationPopover | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [activePdfHighlight, setActivePdfHighlight] = useState<ActivePdfHighlight | null>(null);

  const openPapers = useMemo(
    () => openPaperIds.map((itemId) => libraryItems.find((item) => item.id === itemId)).filter((item): item is LibraryItem => Boolean(item)),
    [libraryItems, openPaperIds],
  );
  const activePaper = useMemo(
    () => libraryItems.find((item) => item.id === activePaperId) ?? openPapers[openPapers.length - 1] ?? null,
    [activePaperId, libraryItems, openPapers],
  );
  const isPdfReader = readerView?.reader_kind === "pdf";
  const attachmentAvailable = Boolean(activePaper && activePaper.attachment_status !== "missing" && activePaper.attachment_status !== "citation_only");
  const aiCapabilitiesEnabled = Boolean(attachmentAvailable && readerView?.content_status === "ready");
  const isPdfAttachment = Boolean(activePaper?.attachment_format === "pdf" || isPdfReader);
  const pdfTextToolsEnabled = Boolean(attachmentAvailable && isPdfAttachment);
  const textToolsEnabled = Boolean(isPdfAttachment ? pdfTextToolsEnabled : aiCapabilitiesEnabled);
  const readerPageCount = activePaper?.id && isPdfReader ? pdfPageCounts[activePaper.id] ?? readerView?.page_count ?? 1 : 1;
  const currentReaderHtml = useMemo(
    () => readerView?.normalized_html ?? "<article><p>No reader view available yet.</p></article>",
    [readerView],
  );

  useEffect(() => {
    if (!activePaperId) {
      readerLoadRequestIdRef.current += 1;
      setReaderView(null);
      setAnnotations([]);
      return;
    }
    let cancelled = false;
    const itemId = activePaperId;
    const requestId = readerLoadRequestIdRef.current + 1;
    readerLoadRequestIdRef.current = requestId;
    void (async () => {
      setReaderView(null);
      setAnnotations([]);
      try {
        const runtimeApi = await getApi();
        const view = await runtimeApi.getReaderView(itemId);
        if (cancelled || readerLoadRequestIdRef.current !== requestId) return;
        setReaderView(view);
        setReaderPage(0);
        setReaderPageInput("1");
        setReaderFitMode(readStoredString(READER_FIT_MODE_KEY, DEFAULT_READER_FIT_MODE, ["fit_width", "manual"] as const));
        setReaderZoom(readStoredNumber(READER_ZOOM_KEY, DEFAULT_READER_ZOOM));
        setReaderSearchQuery("");
        setIsFindHudOpen(false);
        setReaderSearchMatchIndex(0);
        setReaderSearchMatchCount(0);
        setReportedActiveSearchMatchIndex(-1);
        setPdfSelection(null);
        setTranslationSelection(null);
        setTranslationPopover(null);
        setTranslationError(null);
        void (async () => {
          try {
            const annotationsResult = await runtimeApi.listAnnotations(itemId);
            if (!cancelled && readerLoadRequestIdRef.current === requestId) setAnnotations(annotationsResult);
          } catch (error) {
            if (cancelled || readerLoadRequestIdRef.current !== requestId) return;
            setAnnotations([]);
            setStatusMessage(error instanceof Error ? error.message : "Failed to load annotations.");
          }
        })();
      } catch (error) {
        if (cancelled || readerLoadRequestIdRef.current !== requestId) return;
        setReaderView(null);
        setAnnotations([]);
        setStatusMessage(error instanceof Error ? error.message : "Failed to load reader view.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePaperId, getApi]);

  useEffect(() => {
    if (!activePaper) {
      setWorkspaceMode("workspace");
      return;
    }
    if (workspaceMode === "pdf_focus" && activePaper.attachment_format !== "pdf") {
      setWorkspaceMode("workspace");
      setIsSidebarVisible(true);
    }
  }, [activePaper, setIsSidebarVisible, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === "pdf_focus") setIsSidebarVisible(false);
  }, [setIsSidebarVisible, workspaceMode]);

  useEffect(() => {
    setReaderSearchMatchIndex(0);
  }, [activePaperId, readerPage, readerSearchQuery, readerView?.reader_kind]);

  useEffect(() => {
    if (!isFindHudOpen) return;
    readerSearchInputRef.current?.focus();
    readerSearchInputRef.current?.select();
  }, [isFindHudOpen]);

  const setReaderPageClamped = useCallback((nextPage: number) => {
    const clampedPage = Math.max(0, Math.min(nextPage, Math.max(readerPageCount - 1, 0)));
    setReaderPage(clampedPage);
    setReaderPageInput(String(clampedPage + 1));
  }, [readerPageCount]);

  const clampReaderZoom = useCallback((value: number) => {
    return Math.max(READER_MIN_ZOOM, Math.min(value, READER_MAX_ZOOM));
  }, []);

  const setPdfZoomManual = useCallback((value: number) => {
    setReaderFitMode("manual");
    setReaderZoom(clampReaderZoom(value));
  }, [clampReaderZoom]);

  const stepPdfZoom = useCallback((direction: 1 | -1) => {
    setPdfZoomManual(readerZoom + direction * READER_ZOOM_STEP);
  }, [readerZoom, setPdfZoomManual]);

  const stepNormalizedZoom = useCallback((direction: 1 | -1) => {
    setReaderZoom((current) => clampReaderZoom(current + direction * READER_ZOOM_STEP));
  }, [clampReaderZoom]);

  const handleReaderPageSubmit = useCallback(() => {
    const parsed = Number(readerPageInput.trim());
    if (!Number.isFinite(parsed)) {
      setReaderPageInput(String(readerPage + 1));
      return;
    }
    setReaderPageClamped(parsed - 1);
  }, [readerPage, readerPageInput, setReaderPageClamped]);

  const activateItem = useCallback((item: LibraryItem, options?: { focusPdf?: boolean }) => {
    setActivePaperId(item.id);
    setOpenPaperIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
    setWorkspaceMode(options?.focusPdf && item.attachment_format === "pdf" ? "pdf_focus" : "workspace");
  }, [setActivePaperId]);

  const closePaperTab = useCallback((itemId: number) => {
    setOpenPaperIds((current) => {
      const remaining = current.filter((id) => id !== itemId);
      setActivePaperId((currentActive) => (currentActive === itemId ? remaining[remaining.length - 1] ?? null : currentActive));
      if (activePaperId === itemId) {
        setWorkspaceMode("workspace");
        setIsSidebarVisible(true);
      }
      return remaining;
    });
  }, [activePaperId, setActivePaperId, setIsSidebarVisible]);

  const getPdfPageBundle = useCallback(async (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => (await getApi()).pdfEngineGetPageBundle(input), [getApi]);
  const getPdfPageBundlesBatch = useCallback(async (input: { primary_attachment_id: number; page_indexes0: number[]; target_width_px: number }) => (await getApi()).pdfEngineGetPageBundlesBatch(input), [getApi]);
  const getPdfInitialPageBundle = useCallback(async (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => (await getApi()).pdfEngineGetInitialPageBundle(input), [getApi]);
  const getPdfDocumentInfo = useCallback(async (primaryAttachmentId: number) => (await getApi()).pdfEngineGetDocumentInfo({ primary_attachment_id: primaryAttachmentId }), [getApi]);
  const getPdfPageText = useCallback(async (input: { primary_attachment_id: number; page_index0: number }) => (await getApi()).pdfEngineGetPageText(input), [getApi]);
  const getPdfPageTextsBatch = useCallback(async (input: { primary_attachment_id: number; page_indexes0: number[] }) => (await getApi()).pdfEngineGetPageTextsBatch(input), [getApi]);
  const pdfEngineSearch = useCallback(async (input: { primary_attachment_id: number; query: string; max_matches?: number }) => (await getApi()).pdfEngineSearch(input), [getApi]);
  const ocrPdfPage = useCallback(async (input: { primary_attachment_id: number; page_index0: number; png_bytes: Uint8Array; lang?: string; config_version: string; source_resolution?: number }) => (await getApi()).ocrPdfPage(input), [getApi]);
  const readPrimaryAttachmentBytes = useCallback(async (primaryAttachmentId: number) => (await getApi()).readPrimaryAttachmentBytes(primaryAttachmentId), [getApi]);

  const dismissPdfSelection = useCallback(() => {
    setPdfSelection(null);
    setTranslationSelection(null);
    setTranslationPopover(null);
    setTranslationError(null);
    setTranslationLoading(false);
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {
      // Ignore.
    }
  }, []);

  const getReaderSelectionQuote = useCallback(() => {
    return (translationSelection?.quote ?? pdfSelection?.quote ?? "").trim();
  }, [pdfSelection, translationSelection]);

  const copyReaderSelection = useCallback(async () => {
    const quote = getReaderSelectionQuote();
    if (!quote) return;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(quote);
        setStatusMessage("Copied selection.");
        return;
      } catch {
        // Fall back below.
      }
    }

    const textArea = document.createElement("textarea");
    textArea.value = quote;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const copied = document.execCommand("copy");
      setStatusMessage(copied ? "Copied selection." : "Unable to copy selection.");
    } catch {
      setStatusMessage("Unable to copy selection.");
    } finally {
      textArea.remove();
    }
  }, [getReaderSelectionQuote, setStatusMessage]);

  const searchReaderSelection = useCallback(() => {
    const quote = getReaderSelectionQuote();
    if (!quote) return;
    setReaderSearchQuery(quote);
    setReaderSearchMatchIndex(0);
    setIsFindHudOpen(true);
  }, [getReaderSelectionQuote]);

  const clearReaderSelection = useCallback(() => {
    dismissPdfSelection();
  }, [dismissPdfSelection]);

  const setReaderSelection = useCallback((selection: ReaderTextSelection | null) => {
    setTranslationSelection(selection);
    if (selection) {
      setTranslationPopover(null);
      setTranslationError(null);
    } else {
      setTranslationPopover(null);
      setTranslationError(null);
    }
  }, []);

  const requestSelectionTranslation = useCallback(async () => {
    const selection = translationSelection ?? (pdfSelection ? { quote: pdfSelection.quote, rect: pdfSelection.rect } : null);
    if (!selection?.quote.trim()) return;
    setTranslationLoading(true);
    setTranslationError(null);
    setTranslationPopover({ rect: selection.rect, translatedText: "" });
    try {
      const result = await (await getApi()).translateSelection({ text: selection.quote });
      setTranslationPopover({ rect: selection.rect, translatedText: result.translated_text });
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Translation failed.");
      setTranslationPopover({ rect: selection.rect, translatedText: "" });
    } finally {
      setTranslationLoading(false);
    }
  }, [getApi, pdfSelection, translationSelection]);

  const closeTranslationPopover = useCallback(() => {
    setTranslationPopover(null);
    setTranslationError(null);
    setTranslationLoading(false);
  }, []);

  const dismissActivePdfHighlight = useCallback(() => {
    setActivePdfHighlight(null);
  }, []);

  const addColorToPdfAnchor = useCallback((anchor: string, color: PdfHighlightColor) => {
    try {
      const parsed = JSON.parse(anchor) as { type?: string };
      if (!parsed || parsed.type !== "pdf_text") return anchor;
      return JSON.stringify({ ...parsed, color });
    } catch {
      return anchor;
    }
  }, []);

  const handleCreatePdfFocusHighlight = useCallback(async (color: PdfHighlightColor) => {
    if (!activePaper || !pdfTextToolsEnabled || !pdfSelection || workspaceMode !== "pdf_focus") return;
    const annotation = await (await getApi()).createAnnotation({
      item_id: activePaper.id,
      anchor: addColorToPdfAnchor(pdfSelection.anchor, color),
      kind: "highlight",
      body: pdfSelection.quote,
    });
    setAnnotations((current) => [...current, annotation]);
    setStatusMessage("Created highlight.");
    dismissPdfSelection();
  }, [activePaper, addColorToPdfAnchor, dismissPdfSelection, getApi, pdfSelection, pdfTextToolsEnabled, setStatusMessage, workspaceMode]);

  const handleCreatePdfFocusTextBoxAnnotation = useCallback(async (draft: PdfTextBoxAnnotationDraft) => {
    if (!activePaper || !pdfTextToolsEnabled || workspaceMode !== "pdf_focus") return;
    const body = draft.body.trim();
    if (!body) return;
    const annotation = await (await getApi()).createAnnotation({
      item_id: activePaper.id,
      anchor: draft.anchor,
      kind: "text_box",
      body,
    });
    setAnnotations((current) => [...current, annotation]);
    setStatusMessage("Created annotation.");
  }, [activePaper, getApi, pdfTextToolsEnabled, setStatusMessage, workspaceMode]);

  const handleUpdatePdfTextBoxAnnotation = useCallback(async (annotationId: number, anchor: string, body?: string) => {
    if (!pdfTextToolsEnabled || workspaceMode !== "pdf_focus") return;
    const annotation = await (await getApi()).updateAnnotation({
      annotation_id: annotationId,
      anchor,
      body,
    });
    setAnnotations((current) => current.map((entry) => entry.id === annotation.id ? annotation : entry));
    setStatusMessage("Updated annotation.");
  }, [getApi, pdfTextToolsEnabled, setStatusMessage, workspaceMode]);

  const handleRemovePdfTextBoxAnnotation = useCallback(async (annotationId: number) => {
    if (!pdfTextToolsEnabled || workspaceMode !== "pdf_focus") return;
    await (await getApi()).removeAnnotation({ annotation_id: annotationId });
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    setStatusMessage("Removed annotation.");
  }, [getApi, pdfTextToolsEnabled, setStatusMessage, workspaceMode]);

  const handleActivatePdfHighlight = useCallback((highlight: ActivePdfHighlight) => {
    dismissPdfSelection();
    setActivePdfHighlight(highlight);
  }, [dismissPdfSelection]);

  const handleRemoveActivePdfHighlight = useCallback(async () => {
    if (!activePdfHighlight) return;
    await (await getApi()).removeAnnotation({ annotation_id: activePdfHighlight.annotationId });
    setAnnotations((current) => current.filter((annotation) => annotation.id !== activePdfHighlight.annotationId));
    setActivePdfHighlight(null);
    setStatusMessage("Removed highlight.");
  }, [activePdfHighlight, getApi, setStatusMessage]);

  const cleanupAfterItemDelete = useCallback((deletedItemId: number, remainingOpenPaperIds: number[]) => {
    setOpenPaperIds(remainingOpenPaperIds);
    setActivePaperId((current) => (current === deletedItemId ? remainingOpenPaperIds[remainingOpenPaperIds.length - 1] ?? null : current));
    if (activePaperId === deletedItemId) {
      setWorkspaceMode("workspace");
      setIsSidebarVisible(true);
      setReaderView(null);
      setAnnotations([]);
      setPdfSelection(null);
      setTranslationSelection(null);
      setTranslationPopover(null);
      setTranslationError(null);
      setActivePdfHighlight(null);
    }
  }, [activePaperId, setActivePaperId, setIsSidebarVisible]);

  const cleanupAfterCollectionDelete = useCallback((deletedItemIds: Set<number>, remainingOpenPaperIds: number[]) => {
    const deletedActivePaper = activePaperId !== null && deletedItemIds.has(activePaperId);
    setOpenPaperIds(remainingOpenPaperIds);
    setActivePaperId((current) => (current !== null && deletedItemIds.has(current) ? remainingOpenPaperIds[remainingOpenPaperIds.length - 1] ?? null : current));
    if (deletedActivePaper) {
      setWorkspaceMode("workspace");
      setIsSidebarVisible(true);
      setReaderView(null);
      setAnnotations([]);
      setPdfSelection(null);
      setTranslationSelection(null);
      setTranslationPopover(null);
      setTranslationError(null);
      setActivePdfHighlight(null);
    }
  }, [activePaperId, setActivePaperId, setIsSidebarVisible]);

  return {
    activePaper,
    activePaperId,
    activePdfHighlight,
    aiCapabilitiesEnabled,
    annotations,
    closePaperTab,
    collectionArtifact,
    collectionTaskRuns,
    clearReaderSelection,
    copyReaderSelection,
    currentReaderHtml,
    dismissActivePdfHighlight,
    dismissPdfSelection,
    closeTranslationPopover,
    getPdfDocumentInfo,
    getPdfInitialPageBundle,
    getPdfPageBundle,
    getPdfPageBundlesBatch,
    getPdfPageText,
    getPdfPageTextsBatch,
    readPrimaryAttachmentBytes,
    handleActivatePdfHighlight,
    handleCreatePdfFocusHighlight,
    handleCreatePdfFocusTextBoxAnnotation,
    handleUpdatePdfTextBoxAnnotation,
    handleRemovePdfTextBoxAnnotation,
    handleRemoveActivePdfHighlight,
    highlightActionBarRef,
    isFindHudOpen,
    isPdfReader,
    ocrPdfPage,
    pdfEngineSearch,
    openFindHud: () => textToolsEnabled && setIsFindHudOpen(true),
    openPaperIds,
    openPapers,
    paperArtifact,
    paperTaskRuns,
    pdfFocusHighlightBarRef,
    pdfPageCounts,
    pdfSelection,
    pdfTextToolsEnabled,
    readerPage,
    readerPageCount,
    readerPageInput,
    readerSearchInputRef,
    readerSearchMatchCount,
    readerSearchMatchIndex,
    readerSearchQuery,
    readerView,
    readerZoom,
    readerFitMode,
    reportedActiveSearchMatchIndex,
    requestSelectionTranslation,
    searchReaderSelection,
    clampReaderZoom,
    handleReaderPageSubmit,
    setAnnotations,
    setIsFindHudOpen,
    setOpenPaperIds,
    setPdfPageCounts,
    setPdfSelection,
    setReaderSelection,
    setReaderFitMode,
    setReaderPage,
    setReaderPageInput,
    setReaderSearchMatchCount,
    setReaderSearchMatchIndex,
    setReaderSearchQuery,
    setReaderView,
    setReaderZoom,
    setReportedActiveSearchMatchIndex,
    setWorkspaceMode,
    setReaderPageClamped,
    setPdfZoomManual,
    stepNormalizedZoom,
    stepPdfZoom,
    textToolsEnabled,
    translationError,
    translationLoading,
    translationPopover,
    translationSelection,
    workspaceMode,
    activateItem,
    cleanupAfterCollectionDelete,
    cleanupAfterItemDelete,
    setActivePaperId,
  };
}
