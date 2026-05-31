import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CSSProperties } from "react";

import type {
  Annotation,
  OcrPdfPageInput,
  PdfDocumentInfo,
  PdfSearchMatch,
  PdfSearchResult,
  PdfPageText,
  ReaderView,
} from "../../lib/contracts";
import { clearChildren, safeScrollIntoView } from "../../lib/dom";
import { blobFromBytes } from "../../lib/binaryData";
import { escapeHtml } from "../../lib/htmlEscape";
import { clamp } from "../../lib/viewMath";
import { computeFitWidthZoomPct } from "./pdfFit";
import { computeActivePageIndexFromRects } from "./pdfContinuousActivePage";
import { buildOcrTextLayer } from "./pdfOcrTextLayer";
import {
  buildPdfTextSelectionFromRange,
  parsePdfTextAnchor,
  type PdfTextAnchor,
  type PdfSelectionRect,
  type PdfTextSelection,
} from "./pdfSelection";
import { installPdfJsTextLayerSelectionSupport } from "./pdfTextLayerSelectionSupport";
import { pickPdfPageTextSource, shouldFallbackToPdfOcr, type PdfPageTextSource } from "./pdfTextSource";
import { buildRustPdfTextLayer, pageWidthAtScale1FromPoints } from "./pdfRustTextLayer";
import { loadPdfJsDocument, renderPdfJsPageToPng, type PdfJsDocument } from "./pdfJsPageRenderer";
import { bucketPdfRenderWidth } from "./pdfRenderSizing";
import {
  DEFAULT_PDF_TEXT_BOX_COLOR,
  DEFAULT_PDF_TEXT_BOX_FONT_SIZE,
  normalizePdfTextBoxColor,
  normalizePdfTextBoxFontSize,
  parsePdfTextBoxAnchor,
  type PdfTextBoxAnchor,
  type PdfTextBoxColor,
} from "./pdfTextBoxAnchor";
import {
  DEFAULT_PDF_ERASER_SIZE,
  DEFAULT_PDF_INK_COLOR,
  DEFAULT_PDF_INK_WIDTH,
  normalizePdfEraserSize,
  normalizePdfInkColor,
  normalizePdfInkWidth,
  parsePdfInkAnchor,
  type PdfInkAnchor,
  type PdfInkPoint,
} from "./pdfInkAnchor";

const defaultReadPrimaryAttachmentBytes = async () => new Uint8Array();

const PREFETCH_PAGE_RADIUS = 2;
const SEARCH_TARGET_RENDER_RADIUS = 1;
const PAGE_TEXT_CACHE_LIMIT = 32;
const ACTIVE_PAGE_ANCHOR_RATIO = 0.38;
const OCR_CONFIG_VERSION = "pdf-native-fallback-v1";
const MAX_INITIAL_RASTER_SCALE = 1;
const MAX_RASTER_SCALE = 2;
const OCR_CONCURRENCY = 1;
const PAGE_GAP_PX = 12;
const VIRTUAL_WINDOW_RADIUS = 8;

type PdfContinuousReaderProps = {
  view: ReaderView;
  page: number;
  zoom: number;
  fitMode?: "manual" | "fit_width";
  getPdfDocumentInfo: (primaryAttachmentId: number) => Promise<PdfDocumentInfo>;
  getPdfInitialPageBundle?: (input: {
    primary_attachment_id: number;
    page_index0: number;
    target_width_px: number;
  }) => Promise<unknown>;
  getPdfPageBundle: (input: {
    primary_attachment_id: number;
    page_index0: number;
    target_width_px: number;
  }) => Promise<{
    png_bytes: Uint8Array;
    width_px: number;
    height_px: number;
    page_width_pt: number;
    page_height_pt: number;
    spans: Array<{ text: string; x0: number; y0: number; x1: number; y1: number }>;
  }>;
  getPdfPageText: (input: { primary_attachment_id: number; page_index0: number }) => Promise<PdfPageText>;
  getPdfPageBundlesBatch?: (input: { primary_attachment_id: number; page_indexes0: number[]; target_width_px: number }) => Promise<Array<{
    png_bytes: Uint8Array;
    width_px: number;
    height_px: number;
    page_width_pt: number;
    page_height_pt: number;
    spans: Array<{ text: string; x0: number; y0: number; x1: number; y1: number }>;
  }>>;
  getPdfPageTextsBatch?: (input: { primary_attachment_id: number; page_indexes0: number[] }) => Promise<PdfPageText[]>;
  readPrimaryAttachmentBytes?: (primaryAttachmentId: number) => Promise<Uint8Array>;
  pdfEngineSearch?: (input: { primary_attachment_id: number; query: string; max_matches?: number }) => Promise<PdfSearchResult>;
  ocrPdfPage: (input: OcrPdfPageInput) => Promise<{
    primary_attachment_id: number;
    page_index0: number;
    lang: string;
    config_version: string;
    lines: Array<{
      text: string;
      bbox: { left: number; top: number; width: number; height: number };
      confidence: number;
    }>;
  }>;
  onPageCountChange?: (pageCount: number) => void;
  onActivePageChange?: (pageIndex0: number) => void;
  onNavigateToPage?: (pageIndex0: number) => void;
  searchQuery?: string;
  activeSearchMatchIndex?: number;
  annotations?: Annotation[];
  onSelectionChange?: (selection: PdfTextSelection | null) => void;
  onHighlightActivate?: (highlight: { annotationId: number; rect: PdfSelectionRect }) => void;
  onCreateTextBoxAnnotation?: (draft: { anchor: string; body: string }) => void;
  onCreateInkAnnotation?: (draft: { anchor: string; body?: string }) => void | Promise<void>;
  onUpdateInkAnnotation?: (annotationId: number, anchor: string, body?: string) => void | Promise<void>;
  onRemoveInkAnnotation?: (annotationId: number) => void | Promise<void>;
  onUpdateTextBoxAnnotation?: (annotationId: number, anchor: string, body?: string) => void | Promise<void>;
  onRemoveTextBoxAnnotation?: (annotationId: number) => void | Promise<void>;
  textBoxToolActive?: boolean;
  textBoxDefaultColor?: PdfTextBoxColor;
  textBoxDefaultFontSize?: number;
  inkTool?: "none" | "pencil" | "eraser";
  inkColor?: string;
  inkWidth?: number;
  eraserSize?: number;
  onSearchMatchesChange?: (state: { total: number; activeIndex: number }) => void;
};

type RenderedPageState = {
  imageUrl: string;
  cssWidthPx: number;
  cssHeightPx: number;
  rasterWidthPx: number;
  rasterHeightPx: number;
  rasterScale: number;
  bucketWidthPx: number;
  requestKey: string;
  textSource: PdfPageTextSource;
};

type PageShellInfo = {
  widthCssPx: number;
  heightCssPx: number;
};

type RenderRequest = {
  pageIndex0: number;
  cssWidthPx: number;
  cssHeightPx: number;
  targetRasterWidthPx: number;
  bucketWidthPx: number;
  requestKey: string;
  priority: "immediate" | "idle";
  rasterScale: number;
};

type ScrollSyncReason = "scroll" | "observer" | "page_effect";
type SearchMatchWithHitIndex = { pageIndex: number; divIndex: number; start: number; end: number; hitIndex: number };
type TextBoxDraft = {
  id: string;
  pageIndex0: number;
  anchor: PdfTextBoxAnchor;
  body: string;
};
type TextBoxResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type TextBoxInteraction = {
  annotationId: number;
  pageIndex0: number;
  handle: TextBoxResizeHandle | "move";
  startClientX: number;
  startClientY: number;
  startAnchor: PdfTextBoxAnchor;
};
type InkStroke = {
  annotationId: number;
  anchor: PdfInkAnchor;
};
type DrawingInkStroke = {
  pageIndex0: number;
  color: string;
  width: number;
  points: PdfInkPoint[];
};

const supportsRequestIdleCallback = () =>
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function";

const scheduleIdle = (callback: () => void) => {
  if (typeof window === "undefined") return () => {};
  if (supportsRequestIdleCallback()) {
    const id = window.requestIdleCallback(() => callback(), { timeout: 180 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 24);
  return () => window.clearTimeout(id);
};

const isScrollable = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY || style.overflow;
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
  return element.scrollHeight > element.clientHeight + 1;
};

const findScrollFallbackTarget = (element: HTMLElement | null): EventTarget | null => {
  if (typeof window === "undefined" || !element) return null;
  let current = element.parentElement;
  while (current) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return window;
};

export function PdfContinuousReader({
  view,
  page,
  zoom,
  fitMode = "fit_width",
  getPdfDocumentInfo,
  getPdfInitialPageBundle: _getPdfInitialPageBundle,
  getPdfPageBundle: _getPdfPageBundle,
  getPdfPageBundlesBatch: _getPdfPageBundlesBatch,
  getPdfPageText,
  getPdfPageTextsBatch,
  readPrimaryAttachmentBytes = defaultReadPrimaryAttachmentBytes,
  pdfEngineSearch,
  ocrPdfPage,
  onPageCountChange,
  onActivePageChange,
  onNavigateToPage: _onNavigateToPage,
  searchQuery = "",
  activeSearchMatchIndex = 0,
  annotations = [],
  onSelectionChange,
  onHighlightActivate,
  onCreateTextBoxAnnotation,
  onCreateInkAnnotation,
  onUpdateInkAnnotation,
  onRemoveInkAnnotation,
  onUpdateTextBoxAnnotation,
  onRemoveTextBoxAnnotation,
  textBoxToolActive = false,
  textBoxDefaultColor = DEFAULT_PDF_TEXT_BOX_COLOR,
  textBoxDefaultFontSize = DEFAULT_PDF_TEXT_BOX_FONT_SIZE,
  inkTool = "none",
  inkColor = DEFAULT_PDF_INK_COLOR,
  inkWidth = DEFAULT_PDF_INK_WIDTH,
  eraserSize = DEFAULT_PDF_ERASER_SIZE,
  onSearchMatchesChange,
}: PdfContinuousReaderProps) {
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const pageShellByIndexRef = useRef(new Map<number, HTMLElement>());
  const textLayerHostByIndexRef = useRef(new Map<number, HTMLElement>());
  const textLayerSelectionCleanupByIndexRef = useRef(new Map<number, () => void>());
  const textDivsByIndexRef = useRef(new Map<number, HTMLElement[]>());
  const textDivStringsByIndexRef = useRef(new Map<number, string[]>());
  const pageTextOrderRef = useRef<number[]>([]);
  const imageUrlsByIndexRef = useRef(new Map<number, string>());
  const inFlightRenderPagesRef = useRef(new Set<number>());
  const inFlightRenderKeysRef = useRef(new Set<string>());
  const requestedRenderKeysRef = useRef(new Set<string>());
  const latestRequestKeyByPageRef = useRef(new Map<number, string>());
  const inFlightOcrPagesRef = useRef(new Set<number>());
  const pagesRef = useRef<Record<number, RenderedPageState>>({});
  const dominantPageIndexRef = useRef(0);
  const visiblePageIndexesRef = useRef<number[]>([]);
  const lastReportedActivePageRef = useRef(0);
  const pendingProgrammaticPageRef = useRef<number | null>(null);
  const scrollSyncRafRef = useRef<number | null>(null);
  const idleRenderCancelRef = useRef<(() => void) | null>(null);
  const programmaticPageClearRafRef = useRef<number | null>(null);

  const [pageCount, setPageCount] = useState(Math.max(1, view.page_count ?? 1));
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [stageWidth, setStageWidth] = useState(0);
  const [pdfDocumentInfo, setPdfDocumentInfo] = useState<PdfDocumentInfo | null>(null);
  const [pdfJsDocument, setPdfJsDocument] = useState<PdfJsDocument | null>(null);
  const [pageWidthAtScale1, setPageWidthAtScale1] = useState<number | null>(null);
  const [pageShells, setPageShells] = useState<Record<number, PageShellInfo>>({});
  const [pages, setPages] = useState<Record<number, RenderedPageState>>({});
  const [pageTextByIndex, setPageTextByIndex] = useState<Record<number, string[]>>({});
  const [textLayerReadyByPage, setTextLayerReadyByPage] = useState<Record<number, boolean>>({});
  const [textLayerEpoch, setTextLayerEpoch] = useState(0);
  const [dominantPageIndex, setDominantPageIndex] = useState(0);
  const [visiblePageIndexes, setVisiblePageIndexes] = useState<number[]>([]);
  const [searchMatchesFromRust, setSearchMatchesFromRust] = useState<PdfSearchMatch[]>([]);
  const [drawingTextBox, setDrawingTextBox] = useState<{
    pageIndex0: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [drawingInkStroke, setDrawingInkStroke] = useState<DrawingInkStroke | null>(null);
  const [textBoxDrafts, setTextBoxDrafts] = useState<TextBoxDraft[]>([]);
  const [selectedTextBoxAnnotationId, setSelectedTextBoxAnnotationId] = useState<number | null>(null);
  const [editingTextBoxAnnotationId, setEditingTextBoxAnnotationId] = useState<number | null>(null);
  const [textBoxBodyDrafts, setTextBoxBodyDrafts] = useState<Record<number, string>>({});
  const [textBoxAnchorOverrides, setTextBoxAnchorOverrides] = useState<Record<number, PdfTextBoxAnchor>>({});
  const [removingTextBoxAnnotationIds, setRemovingTextBoxAnnotationIds] = useState<Set<number>>(() => new Set());
  const [removingInkAnnotationIds, setRemovingInkAnnotationIds] = useState<Set<number>>(() => new Set());
  const textBoxInteractionRef = useRef<TextBoxInteraction | null>(null);
  const newestTextBoxDraftIdRef = useRef<string | null>(null);

  const onPageCountChangeRef = useRef(onPageCountChange);
  const onActivePageChangeRef = useRef(onActivePageChange);
  const onSearchMatchesChangeRef = useRef(onSearchMatchesChange);
  onPageCountChangeRef.current = onPageCountChange;
  onActivePageChangeRef.current = onActivePageChange;
  onSearchMatchesChangeRef.current = onSearchMatchesChange;

  const textEnabled = true;
  const loweredSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const rasterScale = useMemo(() => {
    if (typeof window === "undefined" || !Number.isFinite(window.devicePixelRatio)) return 1;
    return clamp(window.devicePixelRatio || 1, 1, 2);
  }, []);
  const effectiveZoom = useMemo(() => {
    if (fitMode !== "fit_width") return zoom;
    if (!pageWidthAtScale1) return zoom;
    return computeFitWidthZoomPct({
      containerWidth: stageWidth,
      pageWidthAtScale1,
      marginPx: 40,
      minZoomPct: 70,
      maxZoomPct: 180,
    });
  }, [fitMode, pageWidthAtScale1, stageWidth, zoom]);
  const desiredWidthCssPx = useMemo(() => {
    const base = pageWidthAtScale1 ?? Math.max(640, stageWidth > 0 ? stageWidth - 40 : 816);
    return Math.max(1, Math.round(base * (effectiveZoom / 100)));
  }, [effectiveZoom, pageWidthAtScale1, stageWidth]);
  const targetRasterWidthPx = useMemo(
    () => Math.max(1, Math.round(desiredWidthCssPx * rasterScale)),
    [desiredWidthCssPx, rasterScale],
  );
  const cssWidthBucketPx = useMemo(() => bucketPdfRenderWidth(desiredWidthCssPx), [desiredWidthCssPx]);
  const estimatedPageHeightCssPx = useMemo(() => {
    const firstPage = pdfDocumentInfo?.pages[0];
    if (firstPage?.width_pt && firstPage?.height_pt) {
      const baseWidth = pageWidthAtScale1FromPoints(firstPage.width_pt);
      const scale = desiredWidthCssPx / Math.max(1, baseWidth);
      return Math.max(1, Math.round(firstPage.height_pt * (96 / 72) * scale));
    }
    return Math.max(1, Math.round(desiredWidthCssPx * 1.25));
  }, [desiredWidthCssPx, pageWidthAtScale1, pdfDocumentInfo]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    visiblePageIndexesRef.current = visiblePageIndexes;
  }, [visiblePageIndexes]);

  const rememberPageText = useCallback((pageIndex0: number, strings: string[]) => {
    pageTextOrderRef.current = [...pageTextOrderRef.current.filter((entry) => entry !== pageIndex0), pageIndex0];
    const stale = pageTextOrderRef.current.length > PAGE_TEXT_CACHE_LIMIT ? pageTextOrderRef.current.shift() : undefined;
    setPageTextByIndex((current) => {
      const next = { ...current, [pageIndex0]: strings };
      if (stale !== undefined && stale !== pageIndex0) delete next[stale];
      return next;
    });
  }, []);

  const setTextLayerForPage = useCallback(
    (input: { pageIndex0: number; strings: string[]; divs: HTMLElement[]; textSource: PdfPageTextSource }) => {
      const { pageIndex0, strings, divs, textSource } = input;
      const host = textLayerHostByIndexRef.current.get(pageIndex0);
      if (!host) return;

      textLayerSelectionCleanupByIndexRef.current.get(pageIndex0)?.();
      textLayerSelectionCleanupByIndexRef.current.delete(pageIndex0);
      textDivsByIndexRef.current.set(pageIndex0, divs);
      textDivStringsByIndexRef.current.set(pageIndex0, strings);
      rememberPageText(pageIndex0, strings);
      if (divs.length > 0) {
        textLayerSelectionCleanupByIndexRef.current.set(
          pageIndex0,
          installPdfJsTextLayerSelectionSupport(host),
        );
      }
      setTextLayerReadyByPage((current) => ({ ...current, [pageIndex0]: divs.length > 0 }));
      setPages((current) => {
        const existing = current[pageIndex0];
        if (!existing || existing.textSource === textSource) return existing ? current : current;
        return {
          ...current,
          [pageIndex0]: {
            ...existing,
            textSource,
          },
        };
      });
      setTextLayerEpoch((current) => current + 1);
      void textSource;
      void strings;
    },
    [rememberPageText],
  );

  const pageLayout = useMemo(() => {
    const offsets: number[] = [];
    let cursor = 0;
    for (let pageIndex0 = 0; pageIndex0 < pageCount; pageIndex0 += 1) {
      offsets.push(cursor);
      const shell = pageShells[pageIndex0];
      cursor += (shell?.heightCssPx ?? estimatedPageHeightCssPx) + PAGE_GAP_PX;
    }
    return {
      offsets,
      totalHeight: Math.max(0, cursor - PAGE_GAP_PX),
    };
  }, [estimatedPageHeightCssPx, pageCount, pageShells]);

  const pageIndexForOffset = useCallback((offset: number) => {
    const offsets = pageLayout.offsets;
    if (offsets.length === 0) return 0;
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = offsets[mid] ?? 0;
      const next = offsets[mid + 1] ?? Number.POSITIVE_INFINITY;
      if (offset < start) high = mid - 1;
      else if (offset >= next) low = mid + 1;
      else return mid;
    }
    return clamp(low, 0, offsets.length - 1);
  }, [pageLayout.offsets]);

  const releaseRenderedPage = useCallback((pageIndex0: number) => {
    textLayerSelectionCleanupByIndexRef.current.get(pageIndex0)?.();
    textLayerSelectionCleanupByIndexRef.current.delete(pageIndex0);
    const imageUrl = imageUrlsByIndexRef.current.get(pageIndex0);
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      imageUrlsByIndexRef.current.delete(pageIndex0);
    }
    const host = textLayerHostByIndexRef.current.get(pageIndex0);
    if (host) clearChildren(host);
    textDivsByIndexRef.current.delete(pageIndex0);
    textDivStringsByIndexRef.current.delete(pageIndex0);
    inFlightRenderPagesRef.current.delete(pageIndex0);
    inFlightOcrPagesRef.current.delete(pageIndex0);
    if (pagesRef.current[pageIndex0]) {
      const nextPages = { ...pagesRef.current };
      requestedRenderKeysRef.current.delete(nextPages[pageIndex0]!.requestKey);
      delete nextPages[pageIndex0];
      pagesRef.current = nextPages;
    }
  }, []);

  const syncActivePageFromViewport = useCallback(
    (reason: ScrollSyncReason) => {
      const root = scrollRootRef.current;
      if (!root) return;
      const scrollFallback = findScrollFallbackTarget(root);
      const scrollTop = scrollFallback instanceof HTMLElement ? scrollFallback.scrollTop : root.scrollTop;
      const viewportHeight = scrollFallback instanceof HTMLElement ? scrollFallback.clientHeight : window.innerHeight;
      const offsetNext = pageIndexForOffset(scrollTop + viewportHeight * ACTIVE_PAGE_ANCHOR_RATIO);
      if (pendingProgrammaticPageRef.current === offsetNext) pendingProgrammaticPageRef.current = null;
      if (offsetNext !== dominantPageIndexRef.current) {
        dominantPageIndexRef.current = offsetNext;
        setDominantPageIndex(offsetNext);
      }
      if (offsetNext !== lastReportedActivePageRef.current) {
        lastReportedActivePageRef.current = offsetNext;
        onActivePageChangeRef.current?.(offsetNext);
      }
      if (reason === "scroll" || !pageShellByIndexRef.current.has(offsetNext)) return;
      const rootRect =
        scrollFallback instanceof HTMLElement
          ? scrollFallback.getBoundingClientRect()
          : { top: 0, bottom: window.innerHeight };
      const candidateIndexes = new Set<number>();
      const addRange = (center: number | null | undefined, radius: number) => {
        if (center === null || center === undefined || center < 0) return;
        for (let index = Math.max(0, center - radius); index <= Math.min(pageCount - 1, center + radius); index += 1) {
          candidateIndexes.add(index);
        }
      };
      for (const index of visiblePageIndexesRef.current) candidateIndexes.add(index);
      addRange(dominantPageIndexRef.current, 2);
      addRange(lastReportedActivePageRef.current, 2);
      addRange(pendingProgrammaticPageRef.current, 1);
      addRange(page, 1);
      if (candidateIndexes.size === 0) addRange(0, 1);

      const pageRects = Array.from(candidateIndexes)
        .map((pageIndex0) => {
          const shell = pageShellByIndexRef.current.get(pageIndex0);
          if (!shell) return null;
          const rect = shell.getBoundingClientRect();
          return { pageIndex0, top: rect.top, bottom: rect.bottom };
        })
        .filter((rect): rect is { pageIndex0: number; top: number; bottom: number } => rect !== null)
        .filter((rect) => Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.bottom > rect.top);
      const next = computeActivePageIndexFromRects({
        rootRect: { top: rootRect.top, bottom: rootRect.bottom },
        pageRects,
        anchorRatio: ACTIVE_PAGE_ANCHOR_RATIO,
      });
      if (next === null) return;
      if (pendingProgrammaticPageRef.current === next) pendingProgrammaticPageRef.current = null;

      if (next !== dominantPageIndexRef.current) {
        dominantPageIndexRef.current = next;
        setDominantPageIndex(next);
      }
      if (next !== lastReportedActivePageRef.current) {
        lastReportedActivePageRef.current = next;
        onActivePageChangeRef.current?.(next);
      }
    },
    [page, pageCount, pageIndexForOffset],
  );

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setStageWidth(width);
    });
    observer.observe(root);
    setStageWidth(root.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const primaryAttachmentId = view.primary_attachment_id;
    if (!primaryAttachmentId) return;

    setStatus("loading");
    setErrorMessage("");
    setPdfDocumentInfo(null);
    setPdfJsDocument(null);
    setPageWidthAtScale1(null);
    setTextLayerReadyByPage({});
    setPages({});
    setPageTextByIndex({});
    setPageShells({});
    pageTextOrderRef.current = [];
    inFlightRenderPagesRef.current.clear();
    inFlightRenderKeysRef.current.clear();
    requestedRenderKeysRef.current.clear();
    inFlightOcrPagesRef.current.clear();
    dominantPageIndexRef.current = 0;
    lastReportedActivePageRef.current = 0;
    pendingProgrammaticPageRef.current = null;
    setDominantPageIndex(0);
    setTextLayerEpoch((current) => current + 1);

    for (const cleanup of textLayerSelectionCleanupByIndexRef.current.values()) cleanup();
    textLayerSelectionCleanupByIndexRef.current.clear();
    for (const url of imageUrlsByIndexRef.current.values()) URL.revokeObjectURL(url);
    imageUrlsByIndexRef.current.clear();
    textDivsByIndexRef.current.clear();
    textDivStringsByIndexRef.current.clear();

    void (async () => {
      try {
        const [infoResult, bytes] = await Promise.all([
          getPdfDocumentInfo(primaryAttachmentId).catch((error) => {
            void error;
            return null;
          }),
          readPrimaryAttachmentBytes(primaryAttachmentId),
        ]);
        if (cancelled) return;
        const pdfJs = await loadPdfJsDocument(bytes);
        if (cancelled) {
          void pdfJs.destroy?.();
          return;
        }
        setPdfJsDocument(pdfJs);
        const info = infoResult ?? {
          page_count: Math.max(1, pdfJs.numPages || view.page_count || 1),
          pages: [],
        };
        setPdfDocumentInfo(info);
        const nextPageCount = Math.max(1, info.page_count || view.page_count || 1);
        setPageCount(nextPageCount);
        onPageCountChangeRef.current?.(nextPageCount);
        const firstPage = info.pages[0];
        if (firstPage?.width_pt) {
          setPageWidthAtScale1(pageWidthAtScale1FromPoints(firstPage.width_pt));
        } else {
          const page1 = await pdfJs.getPage(1);
          if (!cancelled) setPageWidthAtScale1(page1.getViewport({ scale: 1 }).width);
        }
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to load PDF metadata.");
      }
    })();

    return () => {
      cancelled = true;
      setPdfJsDocument((current) => {
        void current?.destroy?.();
        return null;
      });
    };
  }, [getPdfDocumentInfo, readPrimaryAttachmentBytes, view.page_count, view.primary_attachment_id]);

  useEffect(() => {
    if (!pdfDocumentInfo) return;
    const nextShells: Record<number, PageShellInfo> = {};
    for (let pageIndex0 = 0; pageIndex0 < pageCount; pageIndex0 += 1) {
      const pageInfo = pdfDocumentInfo.pages[pageIndex0] ?? pdfDocumentInfo.pages[0];
      if (pageInfo?.width_pt && pageInfo?.height_pt) {
        const baseWidth = pageWidthAtScale1FromPoints(pageInfo.width_pt);
        const scale = desiredWidthCssPx / Math.max(1, baseWidth);
        nextShells[pageIndex0] = {
          widthCssPx: desiredWidthCssPx,
          heightCssPx: Math.max(1, Math.round(pageInfo.height_pt * (96 / 72) * scale)),
        };
      } else {
        nextShells[pageIndex0] = {
          widthCssPx: desiredWidthCssPx,
          heightCssPx: estimatedPageHeightCssPx,
        };
      }
    }
    setPageShells(nextShells);
  }, [desiredWidthCssPx, estimatedPageHeightCssPx, pageCount, pdfDocumentInfo]);

  const searchMatches = useMemo((): SearchMatchWithHitIndex[] => {
    if (!textEnabled || loweredSearch.length === 0) return [];
    const rawMatches: Array<{ pageIndex: number; divIndex: number; start: number; end: number }> = [];
    if (!pdfEngineSearch) {
      for (const [pageIndexText, divStrings] of Object.entries(pageTextByIndex)) {
        const pageIndex = Number(pageIndexText);
        for (let divIndex = 0; divIndex < divStrings.length; divIndex += 1) {
          const text = divStrings[divIndex] ?? "";
          const lowered = text.toLowerCase();
          let cursor = 0;
          while (cursor < lowered.length) {
            const index = lowered.indexOf(loweredSearch, cursor);
            if (index === -1) break;
            rawMatches.push({ pageIndex, divIndex, start: index, end: index + loweredSearch.length });
            cursor = index + Math.max(1, loweredSearch.length);
          }
        }
      }
      return rawMatches.map((match, hitIndex) => ({ ...match, hitIndex }));
    }

    // Rust returns match coordinates relative to the span text, not the DOM divs.
    // We map 1:1 spans -> divs in `buildRustPdfTextLayer`, so span_index is the div index.
    return searchMatchesFromRust.map((match, hitIndex) => ({
      pageIndex: match.page_index0,
      divIndex: match.span_index,
      start: match.start,
      end: match.end,
      hitIndex,
    }));
  }, [loweredSearch, pdfEngineSearch, pageTextByIndex, searchMatchesFromRust, textEnabled, textLayerEpoch]);

  const activeSearchTargetPage = useMemo(() => {
    if (searchMatches.length === 0) return null;
    const normalized = ((activeSearchMatchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    return searchMatches[normalized]?.pageIndex ?? null;
  }, [activeSearchMatchIndex, searchMatches]);

  const searchMatchesByPageAndDiv = useMemo(() => {
    const byPage = new Map<number, Map<number, SearchMatchWithHitIndex[]>>();
    for (const match of searchMatches) {
      const byDiv = byPage.get(match.pageIndex) ?? new Map<number, SearchMatchWithHitIndex[]>();
      const matchesForDiv = byDiv.get(match.divIndex) ?? [];
      matchesForDiv.push(match);
      byDiv.set(match.divIndex, matchesForDiv);
      byPage.set(match.pageIndex, byDiv);
    }
    return byPage;
  }, [searchMatches]);

  const visiblePageSet = useMemo(() => new Set(visiblePageIndexes), [visiblePageIndexes]);

  const requestedRenderPages = useMemo(() => {
    const immediate = new Set<number>();
    const idle = new Set<number>();
    const addRange = (target: Set<number>, center: number | null, radius: number) => {
      if (center === null || center < 0) return;
      for (let pageIndex0 = Math.max(0, center - radius); pageIndex0 <= Math.min(pageCount - 1, center + radius); pageIndex0 += 1) {
        target.add(pageIndex0);
      }
    };

    addRange(immediate, page, 1);
    addRange(immediate, dominantPageIndex, 1);
    for (const visiblePageIndex of visiblePageIndexes) addRange(immediate, visiblePageIndex, 0);
    addRange(immediate, activeSearchTargetPage, SEARCH_TARGET_RENDER_RADIUS);

    addRange(idle, page, PREFETCH_PAGE_RADIUS);
    addRange(idle, dominantPageIndex, PREFETCH_PAGE_RADIUS);
    for (const pageIndex0 of immediate) idle.delete(pageIndex0);

    return {
      immediate: Array.from(immediate).sort((left, right) => left - right),
      idle: Array.from(idle).sort((left, right) => left - right),
    };
  }, [activeSearchTargetPage, dominantPageIndex, page, pageCount, visiblePageIndexes]);

  const renderRequests = useMemo(() => {
    if (!pdfDocumentInfo) return [];
    const requests: RenderRequest[] = [];
    const pushRequest = (pageIndex0: number, priority: "immediate" | "idle", scale: number) => {
      const shell = pageShells[pageIndex0];
      if (!shell) return;
      const bucketWidthPx = bucketPdfRenderWidth(Math.max(1, Math.round(shell.widthCssPx * scale)));
      requests.push({
        pageIndex0,
        cssWidthPx: shell.widthCssPx,
        cssHeightPx: shell.heightCssPx,
        targetRasterWidthPx: Math.max(1, Math.round(shell.widthCssPx * scale)),
        bucketWidthPx,
        requestKey: `${pageIndex0}:${cssWidthBucketPx}:${scale}`,
        priority,
        rasterScale: scale,
      });
    };

    const highPriorityPages = new Set([page, dominantPageIndex, ...visiblePageIndexes].filter((entry) => entry >= 0));
    for (const pageIndex0 of requestedRenderPages.immediate) pushRequest(pageIndex0, "immediate", MAX_INITIAL_RASTER_SCALE);
    if (rasterScale > MAX_INITIAL_RASTER_SCALE) {
      for (const pageIndex0 of requestedRenderPages.immediate) {
        if (highPriorityPages.has(pageIndex0)) pushRequest(pageIndex0, "idle", rasterScale);
      }
    }
    for (const pageIndex0 of requestedRenderPages.idle) pushRequest(pageIndex0, "idle", MAX_INITIAL_RASTER_SCALE);
    return requests;
  }, [cssWidthBucketPx, dominantPageIndex, page, pageShells, pdfDocumentInfo, rasterScale, requestedRenderPages, visiblePageIndexes]);

  useEffect(() => {
    const keep = new Set([...requestedRenderPages.immediate, ...requestedRenderPages.idle]);
    const stalePages = Object.keys(pages)
      .map(Number)
      .filter((pageIndex0) => !keep.has(pageIndex0));
    if (stalePages.length === 0) return;
    for (const pageIndex0 of stalePages) releaseRenderedPage(pageIndex0);
    setPages((current) =>
      Object.fromEntries(Object.entries(current).filter(([pageIndex]) => keep.has(Number(pageIndex)))),
    );
    setTextLayerReadyByPage((current) =>
      Object.fromEntries(Object.entries(current).filter(([pageIndex]) => keep.has(Number(pageIndex)))),
    );
    setTextLayerEpoch((current) => current + 1);
  }, [pages, releaseRenderedPage, requestedRenderPages]);

  useEffect(() => {
    let cancelled = false;
    const primaryAttachmentId = view.primary_attachment_id;
    if (!primaryAttachmentId || renderRequests.length === 0 || !pdfDocumentInfo || !pdfJsDocument) return;

    const pageSizePoints = (pageIndex0: number) => {
      const info = pdfDocumentInfo.pages[pageIndex0] ?? pdfDocumentInfo.pages[0];
      return {
        pageWidthPt: Math.max(1, info?.width_pt ?? 612),
        pageHeightPt: Math.max(1, info?.height_pt ?? 792),
      };
    };

    const applyPage = (
      request: RenderRequest,
      rendered: Awaited<ReturnType<typeof renderPdfJsPageToPng>>,
      text: PdfPageText,
      runOcrFallback: boolean,
    ) => {
      if (cancelled) return;
      if (latestRequestKeyByPageRef.current.get(request.pageIndex0) !== request.requestKey) {
        const url = URL.createObjectURL(blobFromBytes(rendered.pngBytes, "image/png"));
        URL.revokeObjectURL(url);
        return;
      }

      const previousUrl = imageUrlsByIndexRef.current.get(request.pageIndex0);
      const blobUrl = URL.createObjectURL(blobFromBytes(rendered.pngBytes, "image/png"));
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      imageUrlsByIndexRef.current.set(request.pageIndex0, blobUrl);

      const nativeStrings = text.spans.map((span) => span.text ?? "");
      const nextRenderedState: RenderedPageState = {
        imageUrl: blobUrl,
        cssWidthPx: request.cssWidthPx,
        cssHeightPx: rendered.cssHeightPx,
        rasterWidthPx: rendered.widthPx,
        rasterHeightPx: rendered.heightPx,
        rasterScale: request.rasterScale,
        bucketWidthPx: request.bucketWidthPx,
        requestKey: request.requestKey,
        textSource: pickPdfPageTextSource(nativeStrings),
      };
      pagesRef.current = {
        ...pagesRef.current,
        [request.pageIndex0]: nextRenderedState,
      };
      setPages((current) => ({
        ...current,
        [request.pageIndex0]: nextRenderedState,
      }));
      setPageShells((current) => ({
        ...current,
        [request.pageIndex0]: {
          widthCssPx: request.cssWidthPx,
          heightCssPx: rendered.cssHeightPx,
        },
      }));

      const currentHost = textLayerHostByIndexRef.current.get(request.pageIndex0);
      if (!currentHost) return;
      const { pageWidthPt, pageHeightPt } = pageSizePoints(request.pageIndex0);
      const nativeLayer = buildRustPdfTextLayer({
        host: currentHost,
        spans: text.spans,
        pageWidthPt,
        pageHeightPt,
        renderedWidthCssPx: request.cssWidthPx,
        renderedHeightCssPx: rendered.cssHeightPx,
      });
      setTextLayerForPage({
        pageIndex0: request.pageIndex0,
        divs: nativeLayer.divs,
        strings: nativeLayer.strings,
        textSource: pickPdfPageTextSource(nativeLayer.strings),
      });
      if (request.pageIndex0 === page) setStatus("ready");

      const ocrEligible =
        runOcrFallback &&
        shouldFallbackToPdfOcr(nativeLayer.strings) &&
        (request.pageIndex0 === page || visiblePageIndexesRef.current.includes(request.pageIndex0)) &&
        !inFlightOcrPagesRef.current.has(request.pageIndex0) &&
        inFlightOcrPagesRef.current.size < OCR_CONCURRENCY;
      if (ocrEligible) {
        inFlightOcrPagesRef.current.add(request.pageIndex0);
        void (async () => {
          try {
            const result = await ocrPdfPage({
              primary_attachment_id: primaryAttachmentId,
              page_index0: request.pageIndex0,
              png_bytes: rendered.pngBytes,
              lang: "eng+chi_sim",
              config_version: OCR_CONFIG_VERSION,
              source_resolution: Math.max(72, Math.round((rendered.widthPx / Math.max(1, request.cssWidthPx)) * 96)),
            });
            if (cancelled) return;
            const ocrHost = textLayerHostByIndexRef.current.get(request.pageIndex0);
            if (!ocrHost) return;
            const built = buildOcrTextLayer({
              host: ocrHost,
              viewportWidth: request.cssWidthPx,
              viewportHeight: rendered.cssHeightPx,
              lines: result.lines,
            });
            setTextLayerForPage({
              pageIndex0: request.pageIndex0,
              divs: built.divs,
              strings: built.strings,
              textSource: built.divs.length > 0 ? "ocr" : pickPdfPageTextSource(nativeLayer.strings),
            });
            void result;
          } catch (error) {
            void error;
          } finally {
            inFlightOcrPagesRef.current.delete(request.pageIndex0);
          }
        })();
      }
    };

    const processRequest = async (request: RenderRequest) => {
      const existing = pagesRef.current[request.pageIndex0];
      if (existing && existing.requestKey === request.requestKey) return;
      if (requestedRenderKeysRef.current.has(request.requestKey)) return;
      if (inFlightRenderKeysRef.current.has(request.requestKey)) return;
      if (inFlightRenderPagesRef.current.has(request.pageIndex0) && request.priority === "idle") return;
      requestedRenderKeysRef.current.add(request.requestKey);
      latestRequestKeyByPageRef.current.set(request.pageIndex0, request.requestKey);
      inFlightRenderPagesRef.current.add(request.pageIndex0);
      inFlightRenderKeysRef.current.add(request.requestKey);
      try {
        const host = textLayerHostByIndexRef.current.get(request.pageIndex0);
        if (host) clearChildren(host);

        void effectiveZoom;
        const [rendered, text] = await Promise.all([
          renderPdfJsPageToPng({
            document: pdfJsDocument,
            pageIndex0: request.pageIndex0,
            cssWidthPx: request.cssWidthPx,
            rasterScale: request.rasterScale,
          }),
          getPdfPageText({
            primary_attachment_id: primaryAttachmentId,
            page_index0: request.pageIndex0,
          }),
        ]);
        if (cancelled) return;
        applyPage(request, rendered, text, true);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unknown PDF rendering error.");
      } finally {
        inFlightRenderPagesRef.current.delete(request.pageIndex0);
        inFlightRenderKeysRef.current.delete(request.requestKey);
      }
    };

    const processBatch = async (batch: RenderRequest[]) => {
      batch = batch.filter((request) => {
        const existing = pagesRef.current[request.pageIndex0];
        if (existing && existing.requestKey === request.requestKey) return false;
        if (requestedRenderKeysRef.current.has(request.requestKey)) return false;
        if (inFlightRenderKeysRef.current.has(request.requestKey)) return false;
        return true;
      });
      if (batch.length === 0) return;
      const uniquePages = Array.from(new Set(batch.map((r) => r.pageIndex0)));
      for (const request of batch) {
        latestRequestKeyByPageRef.current.set(request.pageIndex0, request.requestKey);
        requestedRenderKeysRef.current.add(request.requestKey);
        inFlightRenderPagesRef.current.add(request.pageIndex0);
        inFlightRenderKeysRef.current.add(request.requestKey);
        const host = textLayerHostByIndexRef.current.get(request.pageIndex0);
        if (host) clearChildren(host);
      }

      try {
        const [renderedPages, textPages] = await Promise.all([
          Promise.all(
            uniquePages.map((pageIndex0) => {
              const request = batch.find((entry) => entry.pageIndex0 === pageIndex0);
              return renderPdfJsPageToPng({
                document: pdfJsDocument,
                pageIndex0,
                cssWidthPx: request?.cssWidthPx ?? desiredWidthCssPx,
                rasterScale: request?.rasterScale ?? MAX_INITIAL_RASTER_SCALE,
              });
            }),
          ),
          getPdfPageTextsBatch
            ? getPdfPageTextsBatch({
              primary_attachment_id: primaryAttachmentId,
              page_indexes0: uniquePages,
            })
            : Promise.all(uniquePages.map((page_index0) => getPdfPageText({ primary_attachment_id: primaryAttachmentId, page_index0 }))),
        ]);
        if (cancelled) return;
        for (let i = 0; i < uniquePages.length; i += 1) {
          const pageIndex0 = uniquePages[i]!;
          const request = batch.find((r) => r.pageIndex0 === pageIndex0);
          const rendered = renderedPages[i];
          const text = textPages[i];
          if (!request || !rendered || !text) continue;
          applyPage(request, rendered, text, false);
        }
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unknown PDF rendering error.");
      } finally {
        for (const request of batch) {
          inFlightRenderPagesRef.current.delete(request.pageIndex0);
          inFlightRenderKeysRef.current.delete(request.requestKey);
        }
      }
    };

    const MAX_FRONTEND_RENDER_INFLIGHT = 2;
    const chunk = <T,>(items: T[], size: number) => {
      const out: T[][] = [];
      for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
      return out;
    };

    const runBatches = (requests: RenderRequest[]) => {
      const groups = new Map<string, RenderRequest[]>();
      for (const req of requests) {
        const key = String(req.targetRasterWidthPx);
        const existing = groups.get(key) ?? [];
        existing.push(req);
        groups.set(key, existing);
      }
      const allBatches: RenderRequest[][] = [];
      for (const group of groups.values()) {
        group.sort((a, b) => Math.abs(a.pageIndex0 - page) - Math.abs(b.pageIndex0 - page));
        allBatches.push(...chunk(group, 4));
      }

      let cursor = 0;
      let inflight = 0;
      const pump = () => {
        if (cancelled) return;
        while (inflight < MAX_FRONTEND_RENDER_INFLIGHT && cursor < allBatches.length) {
          const nextBatch = allBatches[cursor++]!;
          inflight += 1;
          void (async () => {
            await processBatch(nextBatch);
          })().finally(() => {
            inflight -= 1;
            pump();
          });
        }
      };
      pump();
    };

    const immediateRequests = renderRequests.filter((request) => request.priority === "immediate");
    const idleRequests = renderRequests.filter((request) => request.priority === "idle");

    // Current page always rendered via the single-page API to minimize time-to-first-paint.
    const currentPageImmediate = immediateRequests.find((r) => r.pageIndex0 === page);
    if (currentPageImmediate) void processRequest(currentPageImmediate);
    const otherImmediate = immediateRequests.filter((r) => r.pageIndex0 !== page);
    runBatches(otherImmediate);

    if (idleRequests.length > 0) {
      idleRenderCancelRef.current?.();
      idleRenderCancelRef.current = scheduleIdle(() => runBatches(idleRequests));
    }

    return () => {
      cancelled = true;
      idleRenderCancelRef.current?.();
      idleRenderCancelRef.current = null;
      requestedRenderKeysRef.current.clear();
      inFlightRenderKeysRef.current.clear();
      inFlightRenderPagesRef.current.clear();
    };
  }, [
    desiredWidthCssPx,
    effectiveZoom,
    getPdfPageText,
    getPdfPageTextsBatch,
    ocrPdfPage,
    page,
    pdfDocumentInfo,
    pdfJsDocument,
    renderRequests,
    setTextLayerForPage,
    view.primary_attachment_id,
  ]);

  useEffect(() => {
    const rendered = pages[page];
    const targetScale = rasterScale > MAX_INITIAL_RASTER_SCALE && (page === dominantPageIndex || visiblePageSet.has(page))
      ? rasterScale
      : MAX_INITIAL_RASTER_SCALE;
    const targetKey = `${page}:${cssWidthBucketPx}:${targetScale}`;
    const minimumKey = `${page}:${cssWidthBucketPx}:${MAX_INITIAL_RASTER_SCALE}`;
    if (rendered && (rendered.requestKey === targetKey || rendered.requestKey === minimumKey)) {
      setStatus("ready");
      return;
    }
    if (view.primary_attachment_id) setStatus("loading");
  }, [cssWidthBucketPx, dominantPageIndex, page, pages, rasterScale, view.primary_attachment_id, visiblePageSet]);

  useEffect(() => {
    return () => {
      if (scrollSyncRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(scrollSyncRafRef.current);
      }
      if (programmaticPageClearRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(programmaticPageClearRafRef.current);
      }
      idleRenderCancelRef.current?.();
      for (const cleanup of textLayerSelectionCleanupByIndexRef.current.values()) cleanup();
      for (const url of imageUrlsByIndexRef.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || typeof window === "undefined") return;
    const fallbackTarget = findScrollFallbackTarget(root);

    const onScroll = () => {
      if (!textBoxInteractionRef.current) {
        setSelectedTextBoxAnnotationId(null);
        setEditingTextBoxAnnotationId(null);
      }
      if (scrollSyncRafRef.current !== null) return;
      scrollSyncRafRef.current = window.requestAnimationFrame(() => {
        scrollSyncRafRef.current = null;
        const scrollTop = fallbackTarget instanceof HTMLElement ? fallbackTarget.scrollTop : root.scrollTop;
        const viewportHeight = fallbackTarget instanceof HTMLElement ? fallbackTarget.clientHeight : window.innerHeight;
        const first = pageIndexForOffset(Math.max(0, scrollTop - viewportHeight));
        const last = pageIndexForOffset(scrollTop + viewportHeight * 2);
        const nextVisible: number[] = [];
        for (let index = first; index <= last; index += 1) nextVisible.push(index);
        setVisiblePageIndexes(nextVisible);
        syncActivePageFromViewport("scroll");
      });
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    if (fallbackTarget && fallbackTarget !== root) fallbackTarget.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (fallbackTarget && fallbackTarget !== root) {
        fallbackTarget.removeEventListener("scroll", onScroll);
      }
      if (scrollSyncRafRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncRafRef.current);
        scrollSyncRafRef.current = null;
      }
    };
  }, [pageIndexForOffset, syncActivePageFromViewport]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => ({
            ratio: entry.intersectionRatio,
            index: Number((entry.target as HTMLElement).dataset.pageIndex),
          }))
          .filter((entry) => Number.isFinite(entry.index));
        if (visible.length === 0) return;
        visible.sort((a, b) => b.ratio - a.ratio);
        setVisiblePageIndexes(visible.map((entry) => entry.index).sort((a, b) => a - b));
        const next = visible[0]?.index ?? 0;
        if (next !== dominantPageIndexRef.current) {
          dominantPageIndexRef.current = next;
          setDominantPageIndex(next);
        }
        syncActivePageFromViewport("observer");
      },
      { root, threshold: [0.2, 0.55, 0.7], rootMargin: "280px 0px" },
    );
    for (const shell of pageShellByIndexRef.current.values()) observer.observe(shell);
    return () => {
      setVisiblePageIndexes([]);
      observer.disconnect();
    };
  }, [pageCount, syncActivePageFromViewport]);

  useEffect(() => {
    const shell = pageShellByIndexRef.current.get(page);
    pendingProgrammaticPageRef.current = page;
    if (shell && dominantPageIndexRef.current !== page) {
      safeScrollIntoView(shell, { block: "start" });
    } else if (!shell) {
      const root = scrollRootRef.current;
      const fallbackTarget = findScrollFallbackTarget(root);
      const targetTop = pageLayout.offsets[page] ?? 0;
      if (fallbackTarget instanceof HTMLElement) fallbackTarget.scrollTop = targetTop;
      else if (root) root.scrollTop = targetTop;
      setVisiblePageIndexes((current) => {
        const next = new Set(current);
        for (let index = Math.max(0, page - VIRTUAL_WINDOW_RADIUS); index <= Math.min(pageCount - 1, page + VIRTUAL_WINDOW_RADIUS); index += 1) next.add(index);
        return Array.from(next).sort((a, b) => a - b);
      });
    }
    if (programmaticPageClearRafRef.current !== null) window.cancelAnimationFrame(programmaticPageClearRafRef.current);
    window.requestAnimationFrame(() => syncActivePageFromViewport("page_effect"));
    programmaticPageClearRafRef.current = window.requestAnimationFrame(() => {
      pendingProgrammaticPageRef.current = null;
      programmaticPageClearRafRef.current = null;
    });
  }, [page, pageCount, pageLayout.offsets, syncActivePageFromViewport]);

  useEffect(() => {
    let cancelled = false;
    const primaryAttachmentId = view.primary_attachment_id;
    if (!primaryAttachmentId) {
      setSearchMatchesFromRust([]);
      return;
    }
    if (!textEnabled || loweredSearch.length === 0) {
      setSearchMatchesFromRust([]);
      return;
    }
    if (!pdfEngineSearch) {
      // Legacy fallback used by some tests/mocks.
      void (async () => {
        const scanOrder = Array.from({ length: pageCount }, (_, offset) => (page + offset) % pageCount);
        for (const pageIndex0 of scanOrder) {
          if (pageTextByIndex[pageIndex0]) continue;
          try {
            const result = await getPdfPageText({
              primary_attachment_id: primaryAttachmentId,
              page_index0: pageIndex0,
            });
            if (cancelled) return;
            rememberPageText(pageIndex0, result.spans.map((span) => span.text));
          } catch {
            return;
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await pdfEngineSearch({
            primary_attachment_id: primaryAttachmentId,
            query: loweredSearch,
          });
          if (cancelled) return;
          setSearchMatchesFromRust(result.matches ?? []);
        } catch {
          if (cancelled) return;
          setSearchMatchesFromRust([]);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    getPdfPageText,
    loweredSearch,
    page,
    pageCount,
    pageTextByIndex,
    pdfEngineSearch,
    rememberPageText,
    textEnabled,
    view.primary_attachment_id,
  ]);

  useEffect(() => {
    const report = onSearchMatchesChangeRef.current;
    if (!report) return;
    if (!textEnabled || loweredSearch.length === 0 || searchMatches.length === 0) {
      report({ total: 0, activeIndex: -1 });
      return;
    }
    const total = searchMatches.length;
    const normalized = total > 0 ? ((activeSearchMatchIndex % total) + total) % total : -1;
    report({ total, activeIndex: normalized });
  }, [activeSearchMatchIndex, loweredSearch, searchMatches.length, textEnabled]);

  const anchorsForActivePage = useMemo(() => {
    if (!textEnabled) return [];
    return annotations
      .map((annotation) => ({ annotation, anchor: parsePdfTextAnchor(annotation.anchor) }))
      .filter((entry) => entry.anchor && entry.annotation.kind === "highlight")
      .map((entry) => ({
        annotationId: entry.annotation.id,
        anchor: entry.anchor as PdfTextAnchor,
      }));
  }, [annotations, textEnabled]);

  const textBoxesByPage = useMemo(() => {
    const grouped = new Map<number, Array<{ id: string; annotationId?: number; anchor: PdfTextBoxAnchor; body: string; persisted: boolean }>>();
    for (const annotation of annotations) {
      if (annotation.kind !== "text_box") continue;
      const anchor = parsePdfTextBoxAnchor(annotation.anchor);
      if (!anchor) continue;
      const pageIndex0 = anchor.page - 1;
      const current = grouped.get(pageIndex0) ?? [];
      current.push({ id: `annotation-${annotation.id}`, annotationId: annotation.id, anchor: textBoxAnchorOverrides[annotation.id] ?? anchor, body: annotation.body, persisted: true });
      grouped.set(pageIndex0, current);
    }
    for (const draft of textBoxDrafts) {
      const current = grouped.get(draft.pageIndex0) ?? [];
      current.push({ id: draft.id, anchor: draft.anchor, body: draft.body, persisted: false });
      grouped.set(draft.pageIndex0, current);
    }
    return grouped;
  }, [annotations, textBoxAnchorOverrides, textBoxDrafts]);

  const inkStrokesByPage = useMemo(() => {
    const grouped = new Map<number, InkStroke[]>();
    for (const annotation of annotations) {
      if (annotation.kind !== "ink") continue;
      const anchor = parsePdfInkAnchor(annotation.anchor);
      if (!anchor) continue;
      const pageIndex0 = anchor.page - 1;
      const current = grouped.get(pageIndex0) ?? [];
      current.push({ annotationId: annotation.id, anchor });
      grouped.set(pageIndex0, current);
    }
    return grouped;
  }, [annotations]);

  useEffect(() => {
    const ids = new Set(annotations.filter((annotation) => annotation.kind === "text_box").map((annotation) => annotation.id));
    setTextBoxAnchorOverrides((current) => {
      let changed = false;
      const next: Record<number, PdfTextBoxAnchor> = {};
      for (const [key, value] of Object.entries(current)) {
        const annotationId = Number(key);
        if (!ids.has(annotationId)) {
          changed = true;
          continue;
        }
        next[annotationId] = value;
      }
      return changed ? next : current;
    });
    setSelectedTextBoxAnnotationId((current) => current !== null && !ids.has(current) ? null : current);
    setEditingTextBoxAnnotationId((current) => current !== null && !ids.has(current) ? null : current);
    setRemovingTextBoxAnnotationIds((current) => {
      let changed = false;
      const next = new Set<number>();
      for (const annotationId of current) {
        if (!ids.has(annotationId)) {
          changed = true;
          continue;
        }
        next.add(annotationId);
      }
      return changed ? next : current;
    });
    setTextBoxBodyDrafts((current) => {
      let changed = false;
      const next: Record<number, string> = {};
      for (const [key, value] of Object.entries(current)) {
        const annotationId = Number(key);
        if (!ids.has(annotationId)) {
          changed = true;
          continue;
        }
        next[annotationId] = value;
      }
      return changed ? next : current;
    });
  }, [annotations]);

  useEffect(() => {
    if (!textBoxToolActive) return;
    setSelectedTextBoxAnnotationId(null);
    setEditingTextBoxAnnotationId(null);
  }, [textBoxToolActive]);

  useEffect(() => {
    if (inkTool === "none") {
      setDrawingInkStroke(null);
      return;
    }
    setSelectedTextBoxAnnotationId(null);
    setEditingTextBoxAnnotationId(null);
    if (inkTool === "eraser") setDrawingTextBox(null);
  }, [inkTool]);

  const fullPageMountSet = useMemo(() => {
    const mounted = new Set<number>();
    const addRange = (center: number | null, radius: number) => {
      if (center === null || center < 0) return;
      for (let pageIndex0 = Math.max(0, center - radius); pageIndex0 <= Math.min(pageCount - 1, center + radius); pageIndex0 += 1) {
        mounted.add(pageIndex0);
      }
    };
    addRange(page, 1);
    addRange(dominantPageIndex, 1);
    for (const visiblePageIndex of visiblePageIndexes) addRange(visiblePageIndex, 1);
    addRange(activeSearchTargetPage, SEARCH_TARGET_RENDER_RADIUS);
    for (const pageIndex0 of textBoxesByPage.keys()) mounted.add(pageIndex0);
    for (const pageIndex0 of inkStrokesByPage.keys()) mounted.add(pageIndex0);
    if (drawingTextBox) mounted.add(drawingTextBox.pageIndex0);
    if (drawingInkStroke) mounted.add(drawingInkStroke.pageIndex0);
    return mounted;
  }, [activeSearchTargetPage, dominantPageIndex, drawingInkStroke, drawingTextBox, inkStrokesByPage, page, pageCount, textBoxesByPage, visiblePageIndexes]);

  const mountedPageIndexes = useMemo(() => {
    const mounted = new Set<number>(fullPageMountSet);
    const addRange = (center: number | null, radius: number) => {
      if (center === null || center < 0) return;
      for (let pageIndex0 = Math.max(0, center - radius); pageIndex0 <= Math.min(pageCount - 1, center + radius); pageIndex0 += 1) {
        mounted.add(pageIndex0);
      }
    };
    addRange(page, VIRTUAL_WINDOW_RADIUS);
    addRange(dominantPageIndex, VIRTUAL_WINDOW_RADIUS);
    for (const visiblePageIndex of visiblePageIndexes) addRange(visiblePageIndex, 2);
    return Array.from(mounted).filter((index) => index >= 0 && index < pageCount).sort((left, right) => left - right);
  }, [dominantPageIndex, fullPageMountSet, page, pageCount, visiblePageIndexes]);

  useEffect(() => {
    const id = newestTextBoxDraftIdRef.current;
    if (!id) return;
    const element = document.querySelector(`[data-text-box-draft-id="${id}"] textarea`) as HTMLTextAreaElement | null;
    if (!element) return;
    newestTextBoxDraftIdRef.current = null;
    element.focus();
  }, [textBoxDrafts]);

  useEffect(() => {
    if (!textBoxToolActive) setDrawingTextBox(null);
  }, [textBoxToolActive]);

  const pointFromPageEvent = useCallback((event: PointerEvent | MouseEvent | ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, pageIndex0: number) => {
    const shell = pageShellByIndexRef.current.get(pageIndex0);
    if (!shell) return null;
    const rect = shell.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  }, []);

  const pageSvgPathFromPoints = useCallback((points: PdfInkPoint[], width: number, height: number) =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${Math.round(point.x * width * 10) / 10} ${Math.round(point.y * height * 10) / 10}`)
      .join(" "), []);

  const distanceToSegmentPx = useCallback((point: PdfInkPoint, start: PdfInkPoint, end: PdfInkPoint, width: number, height: number) => {
    const px = point.x * width;
    const py = point.y * height;
    const x1 = start.x * width;
    const y1 = start.y * height;
    const x2 = end.x * width;
    const y2 = end.y * height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }, []);

  const splitInkStrokeByEraser = useCallback((anchor: PdfInkAnchor, point: PdfInkPoint, width: number, height: number, radiusPx: number) => {
    const segments: PdfInkPoint[][] = [];
    let current: PdfInkPoint[] = [];
    for (let index = 1; index < anchor.points.length; index += 1) {
      const start = anchor.points[index - 1]!;
      const end = anchor.points[index]!;
      const hit = distanceToSegmentPx(point, start, end, width, height) <= radiusPx + anchor.width / 2;
      if (hit) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }
      if (current.length === 0) current.push(start);
      current.push(end);
    }
    if (current.length >= 2) segments.push(current);
    return segments;
  }, [distanceToSegmentPx]);

  const eraseInkAtPoint = useCallback((pageIndex0: number, point: PdfInkPoint) => {
    const shell = pageShellByIndexRef.current.get(pageIndex0);
    if (!shell || !onRemoveInkAnnotation) return;
    const rect = shell.getBoundingClientRect();
    const radiusPx = normalizePdfEraserSize(eraserSize) / 2;
    const strokes = inkStrokesByPage.get(pageIndex0) ?? [];
    for (const stroke of strokes) {
      if (removingInkAnnotationIds.has(stroke.annotationId)) continue;
      const remainingSegments = splitInkStrokeByEraser(stroke.anchor, point, rect.width, rect.height, radiusPx);
      if (remainingSegments.length === 1 && remainingSegments[0]!.length === stroke.anchor.points.length) continue;
      const annotationId = stroke.annotationId;
      setRemovingInkAnnotationIds((current) => new Set(current).add(annotationId));
      void (async () => {
        try {
          if (remainingSegments.length === 0 || !onUpdateInkAnnotation) {
            await onRemoveInkAnnotation(annotationId);
          } else {
            const [firstSegment, ...extraSegments] = remainingSegments;
            if (!firstSegment) return;
            await onUpdateInkAnnotation(annotationId, JSON.stringify({ ...stroke.anchor, points: firstSegment }));
            await Promise.all(extraSegments.map((points) => onCreateInkAnnotation?.({
              anchor: JSON.stringify({ ...stroke.anchor, points }),
              body: "",
            })));
          }
        } finally {
          setRemovingInkAnnotationIds((current) => {
            const next = new Set(current);
            next.delete(annotationId);
            return next;
          });
        }
      })();
      return;
    }
  }, [eraserSize, inkStrokesByPage, onCreateInkAnnotation, onRemoveInkAnnotation, onUpdateInkAnnotation, removingInkAnnotationIds, splitInkStrokeByEraser]);

  const startInkTool = useCallback((event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>, pageIndex0: number) => {
    if (inkTool === "none") return false;
    if (event.button !== 0) return false;
    const point = pointFromPageEvent(event, pageIndex0);
    if (!point) return false;
    event.preventDefault();
    event.stopPropagation();
    if (inkTool === "eraser") {
      eraseInkAtPoint(pageIndex0, point);
      return true;
    }
    setDrawingInkStroke({
      pageIndex0,
      color: normalizePdfInkColor(inkColor),
      width: normalizePdfInkWidth(inkWidth),
      points: [point],
    });
    return true;
  }, [eraseInkAtPoint, inkColor, inkTool, inkWidth, pointFromPageEvent]);

  useEffect(() => {
    if (inkTool !== "eraser") return;
    const onMove = (event: PointerEvent | MouseEvent) => {
      if ((event.buttons & 1) !== 1) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const shell = target?.closest?.("[data-page-index]") as HTMLElement | null;
      const pageIndex0 = Number(shell?.dataset.pageIndex);
      if (!Number.isFinite(pageIndex0)) return;
      const point = pointFromPageEvent(event, pageIndex0);
      if (point) eraseInkAtPoint(pageIndex0, point);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mousemove", onMove);
    };
  }, [eraseInkAtPoint, inkTool, pointFromPageEvent]);

  useEffect(() => {
    if (!drawingInkStroke) return;
    const onMove = (event: PointerEvent | MouseEvent) => {
      const point = pointFromPageEvent(event, drawingInkStroke.pageIndex0);
      if (!point) return;
      setDrawingInkStroke((current) => {
        if (!current) return current;
        const previous = current.points[current.points.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0025) return current;
        return { ...current, points: [...current.points, point] };
      });
    };
    const onUp = () => {
      const stroke = drawingInkStroke;
      if (stroke.points.length >= 2) {
        onCreateInkAnnotation?.({
          anchor: JSON.stringify({
            type: "pdf_ink",
            page: stroke.pageIndex0 + 1,
            color: stroke.color,
            width: stroke.width,
            points: stroke.points,
          }),
          body: "",
        });
      }
      setDrawingInkStroke(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drawingInkStroke, onCreateInkAnnotation, pointFromPageEvent]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const target = event.target;
        if (target instanceof Element && target.closest(".pdf-text-box-annotation")) return;
        setSelectedTextBoxAnnotationId(null);
        setEditingTextBoxAnnotationId(null);
        return;
      }
      if ((event.key === "Enter" || event.key === "F2") && selectedTextBoxAnnotationId !== null && editingTextBoxAnnotationId === null) {
        const target = event.target;
        const isEditable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (isEditable) return;
        event.preventDefault();
        const annotation = annotations.find((entry) => entry.id === selectedTextBoxAnnotationId && entry.kind === "text_box");
        if (!annotation) return;
        setTextBoxBodyDrafts((current) => ({ ...current, [annotation.id]: annotation.body }));
        setEditingTextBoxAnnotationId(annotation.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotations, editingTextBoxAnnotationId, selectedTextBoxAnnotationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedTextBoxAnnotationId === null || editingTextBoxAnnotationId !== null) return;
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (isEditable) return;
      const annotationId = selectedTextBoxAnnotationId;
      const annotation = annotations.find((entry) => entry.id === annotationId && entry.kind === "text_box");
      if (!annotation || removingTextBoxAnnotationIds.has(annotationId)) return;
      event.preventDefault();
      setRemovingTextBoxAnnotationIds((current) => new Set(current).add(annotationId));
      void (async () => {
        try {
          await onRemoveTextBoxAnnotation?.(annotationId);
          setSelectedTextBoxAnnotationId((current) => current === annotationId ? null : current);
          setEditingTextBoxAnnotationId((current) => current === annotationId ? null : current);
        } finally {
          setRemovingTextBoxAnnotationIds((current) => {
            const next = new Set(current);
            next.delete(annotationId);
            return next;
          });
        }
      })();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotations, editingTextBoxAnnotationId, onRemoveTextBoxAnnotation, removingTextBoxAnnotationIds, selectedTextBoxAnnotationId]);

  useEffect(() => {
    if (editingTextBoxAnnotationId === null) return;
    const element = document.querySelector(`[data-annotation-id="${editingTextBoxAnnotationId}"] textarea`) as HTMLTextAreaElement | null;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [editingTextBoxAnnotationId]);

  const startTextBoxDraw = useCallback((event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>, pageIndex0: number) => {
    if (!textBoxToolActive) return;
    if (event.button !== 0) return;
    const shell = pageShellByIndexRef.current.get(pageIndex0);
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    setDrawingTextBox({
      pageIndex0,
      startX: clamp(event.clientX - rect.left, 0, rect.width),
      startY: clamp(event.clientY - rect.top, 0, rect.height),
      currentX: clamp(event.clientX - rect.left, 0, rect.width),
      currentY: clamp(event.clientY - rect.top, 0, rect.height),
    });
  }, [textBoxToolActive]);

  useEffect(() => {
    if (!drawingTextBox) return;
    const onMove = (event: PointerEvent | MouseEvent) => {
      const shell = pageShellByIndexRef.current.get(drawingTextBox.pageIndex0);
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      setDrawingTextBox((current) => current ? {
        ...current,
        currentX: clamp(event.clientX - rect.left, 0, rect.width),
        currentY: clamp(event.clientY - rect.top, 0, rect.height),
      } : current);
    };
    const onUp = () => {
      const shell = pageShellByIndexRef.current.get(drawingTextBox.pageIndex0);
      if (shell) {
        const rect = shell.getBoundingClientRect();
        const left = Math.min(drawingTextBox.startX, drawingTextBox.currentX);
        const top = Math.min(drawingTextBox.startY, drawingTextBox.currentY);
        const width = Math.abs(drawingTextBox.currentX - drawingTextBox.startX);
        const height = Math.abs(drawingTextBox.currentY - drawingTextBox.startY);
        if (width >= 24 && height >= 24) {
          const id = `draft-${Date.now()}-${Math.round(left)}-${Math.round(top)}`;
          newestTextBoxDraftIdRef.current = id;
          setTextBoxDrafts((current) => [...current, {
            id,
            pageIndex0: drawingTextBox.pageIndex0,
            anchor: {
              type: "pdf_text_box",
              page: drawingTextBox.pageIndex0 + 1,
              x: left / Math.max(1, rect.width),
              y: top / Math.max(1, rect.height),
              width: width / Math.max(1, rect.width),
              height: height / Math.max(1, rect.height),
              color: normalizePdfTextBoxColor(textBoxDefaultColor),
              fontSize: normalizePdfTextBoxFontSize(textBoxDefaultFontSize),
            },
            body: "",
          }]);
        }
      }
      setDrawingTextBox(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drawingTextBox, textBoxDefaultColor, textBoxDefaultFontSize]);

  const commitTextBoxDraft = useCallback((draft: TextBoxDraft) => {
    const body = draft.body.trim();
    if (!body) {
      setTextBoxDrafts((current) => current.filter((entry) => entry.id !== draft.id));
      return;
    }
    onCreateTextBoxAnnotation?.({ anchor: JSON.stringify(draft.anchor), body });
    setTextBoxDrafts((current) => current.filter((entry) => entry.id !== draft.id));
  }, [onCreateTextBoxAnnotation]);

  const startEditingTextBoxAnnotation = useCallback((annotationId: number, body: string) => {
    setSelectedTextBoxAnnotationId(annotationId);
    setEditingTextBoxAnnotationId(annotationId);
    setTextBoxBodyDrafts((current) => ({ ...current, [annotationId]: current[annotationId] ?? body }));
  }, []);

  const commitPersistedTextBoxBody = useCallback(async (input: {
    annotationId: number;
    anchor: PdfTextBoxAnchor;
    originalBody: string;
    nextBody: string;
  }) => {
    const { annotationId, anchor, originalBody, nextBody } = input;
    setEditingTextBoxAnnotationId((current) => current === annotationId ? null : current);
    if (nextBody === originalBody) {
      setTextBoxBodyDrafts((current) => {
        const next = { ...current };
        delete next[annotationId];
        return next;
      });
      return;
    }
    try {
      await onUpdateTextBoxAnnotation?.(annotationId, JSON.stringify(anchor), nextBody);
      setTextBoxBodyDrafts((current) => {
        const next = { ...current };
        delete next[annotationId];
        return next;
      });
    } catch {
      setTextBoxBodyDrafts((current) => {
        const next = { ...current };
        delete next[annotationId];
        return next;
      });
    }
  }, [onUpdateTextBoxAnnotation]);

  const clampTextBoxAnchorToPage = useCallback((anchor: PdfTextBoxAnchor, pageIndex0: number, shellRect: DOMRect) => {
    const minWidth = Math.min(1, 24 / Math.max(1, shellRect.width));
    const minHeight = Math.min(1, 24 / Math.max(1, shellRect.height));
    const width = clamp(anchor.width, minWidth, 1);
    const height = clamp(anchor.height, minHeight, 1);
    return {
      ...anchor,
      page: pageIndex0 + 1,
      x: clamp(anchor.x, 0, Math.max(0, 1 - width)),
      y: clamp(anchor.y, 0, Math.max(0, 1 - height)),
      width,
      height,
    };
  }, []);

  const calculateTextBoxInteractionAnchor = useCallback((interaction: TextBoxInteraction, event: PointerEvent | MouseEvent) => {
    const shell = pageShellByIndexRef.current.get(interaction.pageIndex0);
    if (!shell) return interaction.startAnchor;
    const rect = shell.getBoundingClientRect();
    const dx = (event.clientX - interaction.startClientX) / Math.max(1, rect.width);
    const dy = (event.clientY - interaction.startClientY) / Math.max(1, rect.height);
    const start = interaction.startAnchor;
    let next: PdfTextBoxAnchor = { ...start };
    if (interaction.handle === "move") {
      next = { ...next, x: start.x + dx, y: start.y + dy };
    } else {
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;
      if (interaction.handle.includes("w")) left += dx;
      if (interaction.handle.includes("e")) right += dx;
      if (interaction.handle.includes("n")) top += dy;
      if (interaction.handle.includes("s")) bottom += dy;
      const minWidth = Math.min(1, 24 / Math.max(1, rect.width));
      const minHeight = Math.min(1, 24 / Math.max(1, rect.height));
      if (right - left < minWidth) {
        if (interaction.handle.includes("w")) left = right - minWidth;
        else right = left + minWidth;
      }
      if (bottom - top < minHeight) {
        if (interaction.handle.includes("n")) top = bottom - minHeight;
        else bottom = top + minHeight;
      }
      next = { ...next, x: left, y: top, width: right - left, height: bottom - top };
    }
    return clampTextBoxAnchorToPage(next, interaction.pageIndex0, rect);
  }, [clampTextBoxAnchorToPage]);

  const updateTextBoxInteractionPreview = useCallback((event: PointerEvent | MouseEvent) => {
    const interaction = textBoxInteractionRef.current;
    if (!interaction) return;
    const clamped = calculateTextBoxInteractionAnchor(interaction, event);
    setTextBoxAnchorOverrides((current) => ({ ...current, [interaction.annotationId]: clamped }));
  }, [calculateTextBoxInteractionAnchor]);

  const startTextBoxInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
    input: { annotationId: number; pageIndex0: number; anchor: PdfTextBoxAnchor; handle: TextBoxResizeHandle | "move" },
  ) => {
    if (event.button !== 0 && event.button !== -1) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedTextBoxAnnotationId(input.annotationId);
    setEditingTextBoxAnnotationId(null);
    textBoxInteractionRef.current = {
      annotationId: input.annotationId,
      pageIndex0: input.pageIndex0,
      handle: input.handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startAnchor: input.anchor,
    };
    const onMove = (moveEvent: PointerEvent | MouseEvent) => updateTextBoxInteractionPreview(moveEvent);
    const onUp = async (upEvent: PointerEvent | MouseEvent) => {
      const interaction = textBoxInteractionRef.current;
      textBoxInteractionRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!interaction) return;
      const finalAnchor = calculateTextBoxInteractionAnchor(interaction, upEvent);
      setTextBoxAnchorOverrides((current) => ({ ...current, [interaction.annotationId]: finalAnchor }));
      try {
        await onUpdateTextBoxAnnotation?.(interaction.annotationId, JSON.stringify(finalAnchor));
      } catch {
        setTextBoxAnchorOverrides((current) => ({ ...current, [interaction.annotationId]: interaction.startAnchor }));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [calculateTextBoxInteractionAnchor, onUpdateTextBoxAnnotation, updateTextBoxInteractionPreview]);

  useEffect(() => {
    if (!textEnabled) return;
    const renderedPages = Object.keys(textLayerReadyByPage).map(Number).filter((p) => textLayerReadyByPage[p]);
    if (renderedPages.length === 0) return;

    const totalMatches = searchMatches.length;
    const normalizedActive = totalMatches > 0 ? ((activeSearchMatchIndex % totalMatches) + totalMatches) % totalMatches : -1;
    let activeMatchPageIndex: number | null = null;

    for (const pageIndex of renderedPages) {
      const host = textLayerHostByIndexRef.current.get(pageIndex);
      const divs = textDivsByIndexRef.current.get(pageIndex) ?? [];
      const plain = textDivStringsByIndexRef.current.get(pageIndex) ?? [];
      if (!host || divs.length === 0 || plain.length === 0) continue;

      const annotationRangesByDiv = new Map<
        number,
        Array<{ start: number; end: number; color?: string; annotationId: number }>
      >();
      for (const entry of anchorsForActivePage) {
        const anchor = entry.anchor;
        const anchorPage = anchor.page - 1;
        if (anchorPage !== pageIndex) continue;
        const startDiv = Math.max(0, Math.min(anchor.startDivIndex, divs.length - 1));
        const endDiv = Math.max(0, Math.min(anchor.endDivIndex, divs.length - 1));
        const fromDiv = Math.min(startDiv, endDiv);
        const toDiv = Math.max(startDiv, endDiv);
        for (let divIndex = fromDiv; divIndex <= toDiv; divIndex += 1) {
          const text = plain[divIndex] ?? "";
          const len = text.length;
          const start = divIndex === startDiv ? Math.max(0, Math.min(anchor.startOffset, len)) : 0;
          const end = divIndex === endDiv ? Math.max(0, Math.min(anchor.endOffset, len)) : len;
          if (end <= start) continue;
          const current = annotationRangesByDiv.get(divIndex) ?? [];
          current.push({ start, end, color: anchor.color, annotationId: entry.annotationId });
          annotationRangesByDiv.set(divIndex, current);
        }
      }

      const pageMatchesByDiv = searchMatchesByPageAndDiv.get(pageIndex);
      for (let divIndex = 0; divIndex < divs.length; divIndex += 1) {
        const div = divs[divIndex];
        const text = plain[divIndex] ?? "";
        const paints = new Array<{ color?: string; annotationId: number } | null>(text.length).fill(null);
        for (const range of annotationRangesByDiv.get(divIndex) ?? []) {
          const start = Math.max(0, Math.min(range.start, text.length));
          const end = Math.max(0, Math.min(range.end, text.length));
          for (let i = start; i < end; i += 1) paints[i] = { color: range.color, annotationId: range.annotationId };
        }

        const annotationRanges: Array<{ start: number; end: number; color?: string; annotationId: number }> = [];
        let paintCursor = 0;
        while (paintCursor < paints.length) {
          const paint = paints[paintCursor];
          if (!paint) {
            paintCursor += 1;
            continue;
          }
          let end = paintCursor + 1;
          while (
            end < paints.length &&
            paints[end]?.annotationId === paint.annotationId &&
            paints[end]?.color === paint.color
          ) {
            end += 1;
          }
          annotationRanges.push({
            start: paintCursor,
            end,
            color: paint.color,
            annotationId: paint.annotationId,
          });
          paintCursor = end;
        }

        const searchRanges: Array<{ start: number; end: number; hitIndex: number }> = [];
        for (const match of pageMatchesByDiv?.get(divIndex) ?? []) {
          let overlapsAnnotation = false;
          for (let i = Math.max(0, match.start); i < Math.min(text.length, match.end); i += 1) {
            if (paints[i]) {
              overlapsAnnotation = true;
              break;
            }
          }
          if (overlapsAnnotation) continue;
          if (match.hitIndex === normalizedActive) activeMatchPageIndex = pageIndex;
          searchRanges.push({ start: match.start, end: match.end, hitIndex: match.hitIndex });
        }

        const segments: Array<
          | { kind: "text"; value: string }
          | { kind: "annotation"; value: string; color?: string; annotationId: number }
          | { kind: "search"; value: string; hitIndex: number }
        > = [];
        const pushText = (value: string) => {
          if (value.length > 0) segments.push({ kind: "text", value });
        };

        const all = [
          ...annotationRanges.map((range) => ({ ...range, kind: "annotation" as const })),
          ...searchRanges.map((range) => ({ ...range, kind: "search" as const })),
        ].sort((a, b) => a.start - b.start || a.end - b.end);

        let cursor = 0;
        for (const range of all) {
          if (range.start > cursor) pushText(text.slice(cursor, range.start));
          const slice = text.slice(range.start, range.end);
          if (!slice) continue;
          if (range.kind === "annotation") {
            segments.push({
              kind: "annotation",
              value: slice,
              color: range.color,
              annotationId: range.annotationId,
            });
          }
          else segments.push({ kind: "search", value: slice, hitIndex: range.hitIndex });
          cursor = range.end;
        }
        if (cursor < text.length) pushText(text.slice(cursor));

        div.innerHTML = segments
          .map((segment) => {
            if (segment.kind === "text") return escapeHtml(segment.value);
            if (segment.kind === "annotation") {
              const colorAttr = segment.color ? ` data-color="${escapeHtml(segment.color)}"` : "";
              return `<span class="pdf-annotation-highlight" data-annotation-id="${segment.annotationId}"${colorAttr}>${escapeHtml(segment.value)}</span>`;
            }
            const active = segment.hitIndex === normalizedActive ? " pdf-search-hit-active" : "";
            return `<span class="pdf-search-hit${active}" data-hit-index="${segment.hitIndex}">${escapeHtml(segment.value)}</span>`;
          })
          .join("");
        div.dataset.divIndex = String(divIndex);
      }
    }

    if (normalizedActive >= 0 && activeMatchPageIndex !== null) {
      const activeHost = textLayerHostByIndexRef.current.get(activeMatchPageIndex);
      const active = activeHost?.querySelector(".pdf-search-hit-active") as HTMLElement | null;
      if (active) {
        safeScrollIntoView(active, { block: "center" });
        if (activeMatchPageIndex !== dominantPageIndexRef.current) onActivePageChangeRef.current?.(activeMatchPageIndex);
      }
    }
  }, [activeSearchMatchIndex, anchorsForActivePage, searchMatches.length, searchMatchesByPageAndDiv, textEnabled, textLayerEpoch, textLayerReadyByPage]);

  useEffect(() => {
    if (!onHighlightActivate) return;
    const hosts = Array.from(textLayerHostByIndexRef.current.values());
    if (hosts.length === 0) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const highlight = target.closest(".pdf-annotation-highlight[data-annotation-id]") as HTMLElement | null;
      if (!highlight) return;
      const annotationId = Number(highlight.dataset.annotationId);
      if (!Number.isFinite(annotationId)) return;
      const rect = highlight.getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      onHighlightActivate({
        annotationId,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    };

    for (const host of hosts) host.addEventListener("click", onClick);
    return () => {
      for (const host of hosts) host.removeEventListener("click", onClick);
    };
  }, [onHighlightActivate, textLayerEpoch, textLayerReadyByPage]);

  const closestPageIndex = (node: Node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const shell = element?.closest?.("[data-page-index]") as HTMLElement | null;
    const index = shell?.dataset.pageIndex ? Number(shell.dataset.pageIndex) : NaN;
    return Number.isFinite(index) ? index : null;
  };

  useEffect(() => {
    if (!onSelectionChange) return;
    const keyFor = (selection: PdfTextSelection | null) => {
      if (!selection) return "";
      const { left, top, right, bottom } = selection.rect;
      return `${selection.anchor}|${selection.quote}|${left},${top},${right},${bottom}`;
    };
    let lastKey = "";
    const onSelectionChangeEvent = () => {
      const selection = window.getSelection?.();
      let next: PdfTextSelection | null = null;
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const quote = selection.toString();
        const startPage = closestPageIndex(range.startContainer);
        const endPage = closestPageIndex(range.endContainer);
        if (quote.trim() && startPage !== null && startPage === endPage) {
          const host = textLayerHostByIndexRef.current.get(startPage);
          const divs = textDivsByIndexRef.current.get(startPage) ?? [];
          if (host && host.contains(range.commonAncestorContainer)) {
            next = buildPdfTextSelectionFromRange({ quote, range, host, divs, pageNumber1: startPage + 1 });
          }
        }
      }
      const nextKey = keyFor(next);
      if (nextKey === lastKey) return;
      lastKey = nextKey;

      let insideTextLayer = false;
      let nearestDivIndex: string | null = null;
      let pageIndex0: number | null = null;
      try {
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          pageIndex0 = closestPageIndex(range.startContainer);
          if (pageIndex0 !== null) {
            const host = textLayerHostByIndexRef.current.get(pageIndex0);
            insideTextLayer = host ? host.contains(range.commonAncestorContainer) : false;
          }
          const element =
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? (range.startContainer as Element)
              : range.startContainer.parentElement;
          const nearest = element?.closest?.("[data-div-index]") as HTMLElement | null;
          nearestDivIndex = nearest?.dataset.divIndex ?? null;
        }
      } catch {
        // ignore
      }
      void insideTextLayer;
      void nearestDivIndex;
      void pageIndex0;
      onSelectionChange(next);
    };
    document.addEventListener("selectionchange", onSelectionChangeEvent);
    return () => document.removeEventListener("selectionchange", onSelectionChangeEvent);
  }, [onSelectionChange]);

  return (
    <section
      className={`pdf-reader pdf-reader-focus${inkTool === "pencil" ? " pdf-reader-ink-pencil" : ""}${inkTool === "eraser" ? " pdf-reader-ink-eraser" : ""}`}
      data-testid="pdf-reader"
      ref={scrollRootRef}
      onPointerDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".pdf-text-box-annotation")) return;
        setSelectedTextBoxAnnotationId(null);
        setEditingTextBoxAnnotationId(null);
      }}
    >
      <div className="pdf-stage">
        {status === "loading" && !pages[page] ? <p className="pdf-reader-loading">Loading PDF...</p> : null}
        {status === "error" ? <p>Unable to load this PDF. {errorMessage}</p> : null}

        {mountedPageIndexes[0] ? <div aria-hidden="true" style={{ height: `${pageLayout.offsets[mountedPageIndexes[0]] ?? 0}px`, width: "1px" }} /> : null}
        {mountedPageIndexes.map((index) => {
          const rendered = pages[index];
          const shell = pageShells[index];
          const width = rendered?.cssWidthPx ?? shell?.widthCssPx ?? desiredWidthCssPx;
          const height = rendered?.cssHeightPx ?? shell?.heightCssPx;
          const shouldMountFullPage = fullPageMountSet.has(index);
          return (
            <div
              key={index}
              className={`pdf-page-shell${shouldMountFullPage ? "" : " pdf-page-shell-spacer"}`}
              data-page-index={index}
              ref={(element) => {
                if (!element) {
                  pageShellByIndexRef.current.delete(index);
                  return;
                }
                pageShellByIndexRef.current.set(index, element);
              }}
              style={{
                width: width > 0 ? `${width}px` : undefined,
                minHeight: height ? `${height}px` : undefined,
              }}
              onPointerDown={(event) => {
                if (startInkTool(event, index)) return;
                startTextBoxDraw(event, index);
              }}
              onMouseDown={(event) => {
                if (startInkTool(event, index)) return;
                startTextBoxDraw(event, index);
              }}
            >
              {shouldMountFullPage ? (
                <div style={{ position: "relative" }}>
                  {rendered ? (
                    <img
                      alt={`PDF page ${index + 1}`}
                      aria-label={`PDF page ${index + 1} image`}
                      src={rendered.imageUrl}
                      style={{ display: "block", width: `${rendered.cssWidthPx}px`, height: `${rendered.cssHeightPx}px` }}
                    />
                  ) : height ? (
                    <div
                      aria-hidden="true"
                      className="pdf-page-skeleton"
                      style={{ width: `${width}px`, height: `${height}px` }}
                    />
                  ) : null}
                  <div
                    aria-label={`PDF page ${index + 1} text layer`}
                    className="pdf-text-layer textLayer"
                    ref={(element) => {
                      if (!element) {
                        textLayerSelectionCleanupByIndexRef.current.get(index)?.();
                        textLayerSelectionCleanupByIndexRef.current.delete(index);
                        textLayerHostByIndexRef.current.delete(index);
                        return;
                      }
                      textLayerHostByIndexRef.current.set(index, element);
                    }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: width > 0 ? `${width}px` : undefined,
                      height: height ? `${height}px` : undefined,
                      pointerEvents: textEnabled && textLayerReadyByPage[index] ? "auto" : "none",
                      userSelect: textEnabled && textLayerReadyByPage[index] ? "text" : "none",
                      WebkitUserSelect: textEnabled && textLayerReadyByPage[index] ? "text" : "none",
                    }}
                  />
                  {inkStrokesByPage.has(index) || drawingInkStroke?.pageIndex0 === index ? (
                    <svg
                      aria-label={`PDF page ${index + 1} ink annotations`}
                      className={`pdf-ink-layer${inkTool === "pencil" ? " pdf-ink-layer-pencil" : ""}${inkTool === "eraser" ? " pdf-ink-layer-eraser" : ""}`}
                      style={{
                        width: width > 0 ? `${width}px` : undefined,
                        height: height ? `${height}px` : undefined,
                      }}
                      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height ?? 1)}`}
                    >
                      {(inkStrokesByPage.get(index) ?? []).map((stroke) => (
                        <path
                          key={stroke.annotationId}
                          className="pdf-ink-stroke"
                          d={pageSvgPathFromPoints(stroke.anchor.points, width, height ?? 1)}
                          stroke={stroke.anchor.color}
                          strokeWidth={stroke.anchor.width}
                        />
                      ))}
                      {drawingInkStroke?.pageIndex0 === index ? (
                        <path
                          className="pdf-ink-stroke pdf-ink-stroke-drawing"
                          d={pageSvgPathFromPoints(drawingInkStroke.points, width, height ?? 1)}
                          stroke={drawingInkStroke.color}
                          strokeWidth={drawingInkStroke.width}
                        />
                      ) : null}
                    </svg>
                  ) : null}
                  {textBoxesByPage.get(index)?.map((textBox) => {
                    const selected = textBox.persisted && textBox.annotationId === selectedTextBoxAnnotationId;
                    const editing = textBox.persisted && textBox.annotationId === editingTextBoxAnnotationId;
                    const displayedBody = editing && textBox.annotationId !== undefined ? textBoxBodyDrafts[textBox.annotationId] ?? textBox.body : textBox.body;
                    const resizeHandles: TextBoxResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
                    return (
                      <div
                        key={textBox.id}
                        className={`pdf-text-box-annotation ${textBox.persisted ? "pdf-text-box-annotation-persisted" : "pdf-text-box-annotation-draft"}${selected && !editing ? " pdf-text-box-annotation-selected" : ""}${editing ? " pdf-text-box-annotation-editing" : ""}`}
                        data-annotation-id={textBox.annotationId}
                        data-text-box-draft-id={textBox.persisted ? undefined : textBox.id}
                        style={{
                          left: `${textBox.anchor.x * 100}%`,
                          top: `${textBox.anchor.y * 100}%`,
                          width: `${textBox.anchor.width * 100}%`,
                          height: `${textBox.anchor.height * 100}%`,
                          color: textBox.anchor.color,
                          fontSize: `${textBox.anchor.fontSize}px`,
                        }}
                        onContextMenu={(event) => {
                          if (!textBox.persisted) return;
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => {
                          if (!textBox.persisted || textBox.annotationId === undefined) {
                            event.stopPropagation();
                            return;
                          }
                          if (editing) {
                            event.stopPropagation();
                            return;
                          }
                          startTextBoxInteraction(event, {
                            annotationId: textBox.annotationId,
                            pageIndex0: index,
                            anchor: textBox.anchor,
                            handle: "move",
                          });
                        }}
                        onMouseDown={(event) => {
                          if (!textBox.persisted || textBox.annotationId === undefined) {
                            event.stopPropagation();
                            return;
                          }
                          if (editing) {
                            event.stopPropagation();
                            return;
                          }
                          startTextBoxInteraction(event, {
                            annotationId: textBox.annotationId,
                            pageIndex0: index,
                            anchor: textBox.anchor,
                            handle: "move",
                          });
                        }}
                        onDoubleClick={(event) => {
                          if (!textBox.persisted || textBox.annotationId === undefined) return;
                          event.preventDefault();
                          event.stopPropagation();
                          startEditingTextBoxAnnotation(textBox.annotationId, textBox.body);
                        }}
                      >
                        <textarea
                          aria-label="PDF text box annotation"
                          readOnly={textBox.persisted && !editing}
                          value={displayedBody}
                          onPointerDown={(event) => {
                            if (!textBox.persisted || editing || textBox.annotationId === undefined) {
                              event.stopPropagation();
                              return;
                            }
                            startTextBoxInteraction(event, {
                              annotationId: textBox.annotationId,
                              pageIndex0: index,
                              anchor: textBox.anchor,
                              handle: "move",
                            });
                          }}
                          onMouseDown={(event) => {
                            if (!textBox.persisted || editing || textBox.annotationId === undefined) {
                              event.stopPropagation();
                              return;
                            }
                            startTextBoxInteraction(event, {
                              annotationId: textBox.annotationId,
                              pageIndex0: index,
                              anchor: textBox.anchor,
                              handle: "move",
                            });
                          }}
                          onBlur={(event) => {
                            if (textBox.persisted) {
                              if (textBox.annotationId === undefined) return;
                              const hasBodyDraft = Object.prototype.hasOwnProperty.call(textBoxBodyDrafts, textBox.annotationId);
                              if (!editing && !hasBodyDraft) return;
                              void commitPersistedTextBoxBody({
                                annotationId: textBox.annotationId,
                                anchor: textBox.anchor,
                                originalBody: textBox.body,
                                nextBody: textBoxBodyDrafts[textBox.annotationId] ?? event.currentTarget.value,
                              });
                              return;
                            }
                            const draft = textBoxDrafts.find((entry) => entry.id === textBox.id);
                            if (draft) commitTextBoxDraft(draft);
                          }}
                          onChange={(event) => {
                            if (textBox.persisted) {
                              if (!editing || textBox.annotationId === undefined) return;
                              const nextBody = event.target.value;
                              setTextBoxBodyDrafts((current) => ({ ...current, [textBox.annotationId!]: nextBody }));
                              return;
                            }
                            const nextBody = event.target.value;
                            setTextBoxDrafts((current) => current.map((entry) => entry.id === textBox.id ? { ...entry, body: nextBody } : entry));
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (textBox.persisted) {
                              if (!editing || textBox.annotationId === undefined) return;
                              if (event.key !== "Escape") return;
                              event.preventDefault();
                              event.currentTarget.blur();
                              return;
                            }
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            event.currentTarget.blur();
                          }}
                        />
                        {selected && !editing && textBox.annotationId !== undefined ? (
                          <div aria-hidden="true" className="pdf-text-box-resize-handles">
                            {resizeHandles.map((handle) => (
                              <div
                                key={handle}
                                className="pdf-text-box-resize-handle"
                                data-handle={handle}
                                onPointerDown={(event) => startTextBoxInteraction(event, {
                                  annotationId: textBox.annotationId!,
                                  pageIndex0: index,
                                  anchor: textBox.anchor,
                                  handle,
                                })}
                                onMouseDown={(event) => startTextBoxInteraction(event, {
                                  annotationId: textBox.annotationId!,
                                  pageIndex0: index,
                                  anchor: textBox.anchor,
                                  handle,
                                })}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {drawingTextBox?.pageIndex0 === index ? (
                    <div
                      aria-hidden="true"
                      className="pdf-text-box-drawing"
                      style={{
                        left: `${Math.min(drawingTextBox.startX, drawingTextBox.currentX)}px`,
                        top: `${Math.min(drawingTextBox.startY, drawingTextBox.currentY)}px`,
                        width: `${Math.abs(drawingTextBox.currentX - drawingTextBox.startX)}px`,
                        height: `${Math.abs(drawingTextBox.currentY - drawingTextBox.startY)}px`,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {mountedPageIndexes.length > 0 ? (
          <div
            aria-hidden="true"
            style={{
              height: `${Math.max(0, pageLayout.totalHeight - ((pageLayout.offsets[mountedPageIndexes[mountedPageIndexes.length - 1]!] ?? 0) + (pageShells[mountedPageIndexes[mountedPageIndexes.length - 1]!]?.heightCssPx ?? estimatedPageHeightCssPx)))}px`,
              width: "1px",
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
