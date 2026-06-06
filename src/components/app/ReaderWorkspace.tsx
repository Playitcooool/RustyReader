import { FindHud } from "./FindHud";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  EraserIcon,
  FitWidthIcon,
  HighlightIcon,
  MessageIcon,
  NoteIcon,
  SaveIcon,
  SearchIcon,
  SidebarIcon,
  TranslateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./Icons";
import { PdfFocusHighlightBar } from "./PdfHighlightBars";
import { NormalizedReader } from "../readers/NormalizedReader";
import { PdfContinuousReader } from "../readers/PdfContinuousReader";
import { attachmentFormatLabel, type ReaderFitMode } from "../../lib/appView";
import type { Collection, LibraryItem, ReaderView, Annotation } from "../../lib/contracts";
import { clamp } from "../../lib/viewMath";
import type { ActivePdfHighlight, PdfTextBoxAnnotationDraft, ReaderTextSelection, TranslationPopover, WorkspaceMode } from "../../hooks/useReaderState";
import type { PdfHighlightColor, PdfTextSelection } from "../readers/pdfSelection";
import {
  DEFAULT_PDF_TEXT_BOX_COLOR,
  DEFAULT_PDF_TEXT_BOX_FONT_SIZE,
  MAX_PDF_TEXT_BOX_FONT_SIZE,
  MIN_PDF_TEXT_BOX_FONT_SIZE,
  clampPdfTextBoxFontSize,
  pdfTextBoxColors,
  type PdfTextBoxColor,
} from "../readers/pdfTextBoxAnchor";
import {
  DEFAULT_PDF_ERASER_SIZE,
  DEFAULT_PDF_INK_COLOR,
  DEFAULT_PDF_INK_WIDTH,
  MAX_PDF_ERASER_SIZE,
  MAX_PDF_INK_WIDTH,
  MIN_PDF_ERASER_SIZE,
  MIN_PDF_INK_WIDTH,
  normalizePdfEraserSize,
  normalizePdfInkWidth,
} from "../readers/pdfInkAnchor";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

const pdfHighlightColors = ["yellow", "red", "green", "blue", "purple"] as const satisfies readonly PdfHighlightColor[];

type ReaderWorkspaceData = {
  activeCollection: Collection | null;
  activePaper: LibraryItem | null;
  annotations: Annotation[];
  collectionItems: LibraryItem[];
  hasCollections: boolean;
  openPapers: LibraryItem[];
  readerView: ReaderView | null;
};

type ReaderWorkspacePdfApi = {
  getPdfDocumentInfo: (primaryAttachmentId: number) => Promise<unknown>;
  getPdfInitialPageBundle?: (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => Promise<unknown>;
  getPdfLinks?: (primaryAttachmentId: number) => Promise<unknown>;
  getPdfOutline?: (primaryAttachmentId: number) => Promise<unknown>;
  getPdfPageBundle: (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => Promise<unknown>;
  getPdfPageBundlesBatch: (input: { primary_attachment_id: number; page_indexes0: number[]; target_width_px: number }) => Promise<unknown>;
  getPdfPageText: (input: { primary_attachment_id: number; page_index0: number }) => Promise<unknown>;
  getPdfPageTextsBatch: (input: { primary_attachment_id: number; page_indexes0: number[] }) => Promise<unknown>;
  readPrimaryAttachmentBytes: (primaryAttachmentId: number) => Promise<Uint8Array>;
  pdfEngineSearch: (input: { primary_attachment_id: number; query: string; max_matches?: number }) => Promise<unknown>;
  onOcrPdfPage: (input: { primary_attachment_id: number; page_index0: number; png_bytes: Uint8Array; lang?: string; config_version: string; source_resolution?: number }) => Promise<unknown>;
};

type ReaderWorkspaceUi = {
  isAiPanelOpen: boolean;
  isFindHudOpen: boolean;
  isSidebarVisible: boolean;
  pdfFocusHighlightBarRef: RefObject<HTMLDivElement>;
  pdfSelection: PdfTextSelection | null;
  readerFitMode: ReaderFitMode;
  readerPage: number;
  readerPageCount: number;
  readerPageInput: string;
  readerSearchInputRef: RefObject<HTMLInputElement>;
  readerSearchMatchCount: number;
  readerSearchMatchIndex: number;
  readerSearchQuery: string;
  readerZoom: number;
  reportedActiveSearchMatchIndex: number;
  textToolsEnabled: boolean;
  translationError: string | null;
  translationLoading: boolean;
  translationPopover: TranslationPopover | null;
  translationSelection: ReaderTextSelection | null;
  workspaceMode: WorkspaceMode;
};

type ReaderWorkspaceActions = {
  onActivateItem: (item: LibraryItem) => void;
  onDocumentContextMenu: (event: ReactMouseEvent<HTMLElement>, item: LibraryItem) => void;
  onActivePdfHighlight: (highlight: ActivePdfHighlight) => void;
  onAiToggle: () => void | Promise<void>;
  onCloseFindHud: () => void;
  onCloseTab: (itemId: number) => void;
  onClearReaderSelection: () => void;
  onCopyReaderSelection: () => void | Promise<void>;
  onCreatePdfFocusHighlight: (color: PdfHighlightColor) => void | Promise<void>;
  onCreatePdfFocusInkAnnotation: (draft: { anchor: string; body?: string }) => void | Promise<void>;
  onAskWithSelection: () => void | Promise<void>;
  onAddHighlightToSession: () => void | Promise<void>;
  onSaveSelectionAsNote: () => void | Promise<void>;
  onUpdateActiveMarkdown: (markdown: string) => Promise<ReaderView | null>;
  onCreatePdfFocusTextBoxAnnotation: (draft: PdfTextBoxAnnotationDraft) => void | Promise<void>;
  onRemovePdfInkAnnotation: (annotationId: number) => void | Promise<void>;
  onUpdatePdfTextBoxAnnotation: (annotationId: number, anchor: string, body?: string) => void | Promise<void>;
  onRemovePdfTextBoxAnnotation: (annotationId: number) => void | Promise<void>;
  onExitFocus: () => void;
  onFindQueryChange: (value: string) => void;
  onMoveMatch: (direction: 1 | -1, source: "button" | "enter") => void;
  onReaderFitModeChange: (mode: ReaderFitMode) => void;
  onReaderPageChange: (value: number) => void;
  onReaderPageInputChange: (value: string) => void;
  onReaderPageSubmit: () => void;
  onReaderSearchMatchesChange: (state: { total: number; activeIndex: number }) => void;
  onPdfZoomChange: (value: number) => void;
  onRequestSelectionTranslation: () => void | Promise<void>;
  onSearchReaderSelection: () => void;
  onShowLibrary: () => void;
  onShowOutline: () => void;
  onStepNormalizedZoom: (direction: 1 | -1) => void;
  onSelectionChange: (selection: ReaderTextSelection | null) => void;
  onCloseTranslationPopover: () => void;
  openFindHud: () => void;
  setPdfPageCount: (pageCount: number) => void;
};

type Props = {
  data: ReaderWorkspaceData;
  pdfApi: ReaderWorkspacePdfApi;
  ui: ReaderWorkspaceUi;
  actions: ReaderWorkspaceActions;
};

export function ReaderWorkspace(props: Props) {
  const {
    activeCollection,
    activePaper,
    annotations,
    collectionItems,
    hasCollections,
    openPapers,
    readerView,
  } = props.data;
  const {
    getPdfDocumentInfo,
    getPdfInitialPageBundle,
    getPdfLinks,
    getPdfPageBundle,
    getPdfPageBundlesBatch,
    getPdfPageText,
    getPdfPageTextsBatch,
    onOcrPdfPage,
    readPrimaryAttachmentBytes,
    pdfEngineSearch,
  } = props.pdfApi;
  const {
    isAiPanelOpen,
    isFindHudOpen,
    isSidebarVisible,
    pdfFocusHighlightBarRef,
    pdfSelection,
    readerFitMode,
    readerPage,
    readerPageCount,
    readerPageInput,
    readerSearchInputRef,
    readerSearchMatchCount,
    readerSearchMatchIndex,
    readerSearchQuery,
    readerZoom,
    reportedActiveSearchMatchIndex,
    translationError,
    translationLoading,
    translationPopover,
    translationSelection,
    workspaceMode,
  } = props.ui;
  const {
    onActivateItem,
    onDocumentContextMenu,
    onActivePdfHighlight,
    onAiToggle,
    onClearReaderSelection,
    onCloseFindHud,
    onCloseTab,
    onCopyReaderSelection,
    onCreatePdfFocusHighlight,
    onCreatePdfFocusInkAnnotation,
    onAskWithSelection,
    onAddHighlightToSession,
    onSaveSelectionAsNote,
    onUpdateActiveMarkdown,
    onCreatePdfFocusTextBoxAnnotation,
    onRemovePdfInkAnnotation,
    onUpdatePdfTextBoxAnnotation,
    onRemovePdfTextBoxAnnotation,
    onFindQueryChange,
    onMoveMatch,
    onReaderFitModeChange,
    onReaderPageChange,
    onReaderPageInputChange,
    onReaderPageSubmit,
    onReaderSearchMatchesChange,
    onPdfZoomChange,
    onRequestSelectionTranslation,
    onSearchReaderSelection,
    onShowLibrary,
    onShowOutline,
    onSelectionChange,
    onCloseTranslationPopover,
    openFindHud,
    onStepNormalizedZoom,
    setPdfPageCount,
  } = props.actions;
  const readerShellRef = useRef<HTMLElement | null>(null);
  const [readerContextMenu, setReaderContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isPdfTextBoxToolActive, setIsPdfTextBoxToolActive] = useState(false);
  const [pdfInkTool, setPdfInkTool] = useState<"none" | "pencil" | "eraser">("none");
  const [pdfInkColor, setPdfInkColor] = useState(DEFAULT_PDF_INK_COLOR);
  const [pdfInkWidth, setPdfInkWidth] = useState(DEFAULT_PDF_INK_WIDTH);
  const [pdfEraserSize, setPdfEraserSize] = useState(DEFAULT_PDF_ERASER_SIZE);
  const [pdfTextBoxColor, setPdfTextBoxColor] = useState<PdfTextBoxColor>(DEFAULT_PDF_TEXT_BOX_COLOR);
  const [pdfTextBoxFontSize, setPdfTextBoxFontSize] = useState(DEFAULT_PDF_TEXT_BOX_FONT_SIZE);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [markdownSaving, setMarkdownSaving] = useState(false);
  const mdxEditorRef = useRef<MDXEditorMethods | null>(null);
  const markdownDraftRef = useRef("");
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const handleResize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const showPdfFocusHighlightBar = Boolean(workspaceMode === "pdf_focus" && activePaper?.attachment_format === "pdf" && pdfSelection);
  const pdfFocusHighlightBarStyle = useMemo(() => {
    if (!showPdfFocusHighlightBar || !pdfSelection) return {};
    const BAR_WIDTH_PX = 224;
    const BAR_HEIGHT_PX = 44;
    const GAP_PX = 10;
    const PADDING_PX = 12;
    const rect = pdfSelection.rect;
    let left = rect.right + GAP_PX;
    let top = rect.top - BAR_HEIGHT_PX - GAP_PX;
    if (top < PADDING_PX) top = rect.bottom + GAP_PX;
    left = clamp(left, PADDING_PX, viewportSize.width - BAR_WIDTH_PX - PADDING_PX);
    top = clamp(top, PADDING_PX, viewportSize.height - BAR_HEIGHT_PX - PADDING_PX);
    return { left: `${left}px`, top: `${top}px` } as const;
  }, [pdfSelection, showPdfFocusHighlightBar, viewportSize.height, viewportSize.width]);
  const selectionForActions = translationSelection ?? (pdfSelection ? { quote: pdfSelection.quote, rect: pdfSelection.rect } : null);
  const showPdfHighlightActions = workspaceMode === "pdf_focus" && Boolean(pdfSelection);
  const canEditMarkdown = Boolean(activePaper?.attachment_format === "md" && readerView?.primary_attachment_id);

  useEffect(() => {
    setMarkdownDraft("");
    markdownDraftRef.current = "";
    setMarkdownSaving(false);
  }, [activePaper?.id]);

  useEffect(() => {
    if (!canEditMarkdown || !readerView?.primary_attachment_id) return;
    let cancelled = false;
    const fallback = readerView.plain_text;
    void (async () => {
      let nextDraft = fallback;
      try {
        const bytes = await readPrimaryAttachmentBytes(readerView.primary_attachment_id!);
        nextDraft = new TextDecoder().decode(bytes);
      } catch {
        nextDraft = fallback;
      }
      if (cancelled) return;
      setMarkdownDraft(nextDraft);
      markdownDraftRef.current = nextDraft;
      mdxEditorRef.current?.setMarkdown(nextDraft);
    })();
    return () => {
      cancelled = true;
    };
  }, [canEditMarkdown, readPrimaryAttachmentBytes, readerView?.item_id, readerView?.plain_text, readerView?.primary_attachment_id]);

  const saveMarkdownEdit = useCallback(async () => {
    const markdown = markdownDraftRef.current;
    setMarkdownDraft(markdown);
    setMarkdownSaving(true);
    try {
      await onUpdateActiveMarkdown(markdown);
    } finally {
      setMarkdownSaving(false);
    }
  }, [onUpdateActiveMarkdown]);

  useEffect(() => {
    if (!selectionForActions?.quote.trim()) setReaderContextMenu(null);
  }, [selectionForActions]);

  const openReaderSelectionMenu = useCallback(
    (event: Pick<MouseEvent | PointerEvent, "target" | "clientX" | "clientY" | "preventDefault" | "stopPropagation">) => {
      if (!selectionForActions?.quote.trim()) return false;
      const target = event.target;
      if (!(target instanceof Element)) return false;
      const reader = target.closest(".pdf-reader, [data-testid='pdf-reader']");
      if (!reader) return false;
      if (reader.querySelector(".textLayer") && !target.closest(".textLayer")) return false;
      event.preventDefault();
      event.stopPropagation();
      setReaderContextMenu({ x: event.clientX, y: event.clientY });
      return true;
    },
    [selectionForActions],
  );

  useEffect(() => {
    const shell = readerShellRef.current;
    if (!shell) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return;
      openReaderSelectionMenu(event);
    };
    const onContextMenu = (event: MouseEvent) => {
      openReaderSelectionMenu(event);
    };

    shell.addEventListener("pointerdown", onPointerDown, true);
    shell.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      shell.removeEventListener("pointerdown", onPointerDown, true);
      shell.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [openReaderSelectionMenu]);

  const readerContextMenuStyle = useMemo(() => {
    if (!readerContextMenu) return {};
    const WIDTH_PX = 220;
    const HEIGHT_PX = showPdfHighlightActions ? 340 : 164;
    const PADDING_PX = 8;
    return {
      left: `${clamp(readerContextMenu.x, PADDING_PX, viewportSize.width - WIDTH_PX - PADDING_PX)}px`,
      top: `${clamp(readerContextMenu.y, PADDING_PX, viewportSize.height - HEIGHT_PX - PADDING_PX)}px`,
    } as const;
  }, [readerContextMenu, showPdfHighlightActions, viewportSize.height, viewportSize.width]);
  const translationPopoverStyle = useMemo(() => {
    if (!translationPopover) return {};
    const WIDTH_PX = 320;
    const HEIGHT_PX = 180;
    const GAP_PX = 10;
    const PADDING_PX = 12;
    const rect = translationPopover.rect;
    let left = rect.right + GAP_PX;
    let top = rect.top - GAP_PX;
    if (left + WIDTH_PX + PADDING_PX > viewportSize.width) left = rect.left - WIDTH_PX - GAP_PX;
    if (top + HEIGHT_PX + PADDING_PX > viewportSize.height) top = rect.bottom - HEIGHT_PX;
    left = clamp(left, PADDING_PX, viewportSize.width - WIDTH_PX - PADDING_PX);
    top = clamp(top, PADDING_PX, viewportSize.height - HEIGHT_PX - PADDING_PX);
    return { left: `${left}px`, top: `${top}px` } as const;
  }, [translationPopover, viewportSize.height, viewportSize.width]);

  const aiPanelToggle = (
    <button
      aria-label={isAiPanelOpen ? "Close AI panel" : "Open AI panel"}
      aria-pressed={isAiPanelOpen}
      className="icon-button reader-ai-toggle"
      title={isAiPanelOpen ? "Close AI panel" : "Open AI panel"}
      type="button"
      onClick={() => void onAiToggle()}
    >
      <MessageIcon />
    </button>
  );

  return (
    <main
      ref={readerShellRef}
      className={`reader-shell ${workspaceMode === "pdf_focus" ? "reader-shell-focus" : "reader-shell-workspace"}`}
      onClick={() => setReaderContextMenu(null)}
      onContextMenu={(event) => {
        openReaderSelectionMenu(event.nativeEvent);
      }}
    >
      <div className={`reader-tabs ${workspaceMode === "pdf_focus" ? "reader-tabs-focus" : ""}`} role="tablist" aria-label="Open papers">
        {workspaceMode === "pdf_focus" ? (
          <button aria-label="Back to library" className="reader-back-button" title="Back to library" type="button" onClick={() => activePaper && onCloseTab(activePaper.id)}>
            <ChevronLeftIcon />
          </button>
        ) : null}
        {openPapers.map((paper) => (
          <div key={paper.id} className={`reader-tab-shell ${paper.id === activePaper?.id ? "reader-tab-active" : ""}`}>
            <button aria-selected={paper.id === activePaper?.id} className="reader-tab" role="tab" type="button" onClick={() => onActivateItem(paper)}>
              {paper.title}
            </button>
            <button aria-label={`Close tab ${paper.title}`} className="tab-close-button" type="button" onClick={() => onCloseTab(paper.id)}>
              <CloseIcon />
            </button>
          </div>
        ))}
        {workspaceMode === "pdf_focus" ? null : aiPanelToggle}
      </div>

      {workspaceMode === "pdf_focus" && activePaper?.attachment_format === "pdf" ? (
        <section className="reader-panel reader-panel-focus">
          <div className="reader-toolbar reader-toolbar-focus" role="toolbar" aria-label="PDF focus toolbar">
            {!isSidebarVisible ? (
              <div className="reader-control-group reader-control-group-library">
                <button aria-label="Show outline" aria-pressed="false" className="icon-button" title="Show outline" type="button" onClick={onShowOutline}>
                  <SidebarIcon />
                </button>
              </div>
            ) : null}
            <div className="reader-control-group reader-control-group-page">
              <button aria-label="Previous Page" className="icon-button" disabled={readerPage === 0} title="Previous Page" type="button" onClick={() => onReaderPageChange(readerPage - 1)}>
                <ChevronLeftIcon />
              </button>
              <input aria-label="Reader page input" className="reader-page-input" value={readerPageInput} onChange={(event) => onReaderPageInputChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onReaderPageSubmit()} />
              <span className="reader-control-divider">/ {readerPageCount}</span>
              <button aria-label="Next Page" className="icon-button" disabled={readerPage >= readerPageCount - 1} title="Next Page" type="button" onClick={() => onReaderPageChange(readerPage + 1)}>
                <ChevronRightIcon />
              </button>
            </div>
            <div className="reader-control-group reader-control-group-zoom">
              <button aria-label="Fit width" aria-pressed={readerFitMode === "fit_width"} className="icon-button" title="Fit width" type="button" onClick={() => onReaderFitModeChange("fit_width")}>
                <FitWidthIcon />
              </button>
              <button aria-label="Zoom out" className="icon-button" title="Zoom out" type="button" onClick={() => onPdfZoomChange(readerZoom - 10)}>
                <ZoomOutIcon />
              </button>
              <span className="reader-zoom-label">{readerFitMode === "fit_width" ? "Fit width" : `${readerZoom}%`}</span>
              <button aria-label="Zoom in" className="icon-button" title="Zoom in" type="button" onClick={() => onPdfZoomChange(readerZoom + 10)}>
                <ZoomInIcon />
              </button>
            </div>
            <div className="reader-control-group">
              <button
                aria-label="Add text box annotation"
                aria-pressed={isPdfTextBoxToolActive}
                className="ghost-button reader-icon-tool"
                title="Add text box annotation"
                type="button"
                onClick={() => {
                  setPdfInkTool("none");
                  setIsPdfTextBoxToolActive((current) => !current);
                }}
              >
                T
              </button>
              <button
                aria-label="Draw with pencil"
                aria-pressed={pdfInkTool === "pencil"}
                className="ghost-button reader-icon-tool"
                title="Draw with pencil"
                type="button"
                onClick={() => {
                  setIsPdfTextBoxToolActive(false);
                  setPdfInkTool((current) => current === "pencil" ? "none" : "pencil");
                }}
              >
                <EditIcon />
              </button>
              <button
                aria-label="Erase ink annotations"
                aria-pressed={pdfInkTool === "eraser"}
                className="ghost-button reader-icon-tool"
                title="Erase ink annotations"
                type="button"
                onClick={() => {
                  setIsPdfTextBoxToolActive(false);
                  setPdfInkTool((current) => current === "eraser" ? "none" : "eraser");
                }}
              >
                <EraserIcon />
              </button>
              {pdfInkTool === "pencil" ? (
                <div className="pdf-ink-tool-options" aria-label="Pencil options">
                  <input
                    aria-label="Pencil color"
                    className="pdf-ink-color-input"
                    type="color"
                    value={pdfInkColor}
                    onChange={(event) => setPdfInkColor(event.target.value)}
                  />
                  <input
                    aria-label="Pencil width"
                    className="pdf-ink-size-input"
                    min={MIN_PDF_INK_WIDTH}
                    max={MAX_PDF_INK_WIDTH}
                    step={1}
                    type="range"
                    value={pdfInkWidth}
                    onChange={(event) => setPdfInkWidth(normalizePdfInkWidth(Number(event.target.value)))}
                  />
                  <span className="reader-zoom-label">{pdfInkWidth}px</span>
                </div>
              ) : null}
              {pdfInkTool === "eraser" ? (
                <div className="pdf-ink-tool-options" aria-label="Eraser options">
                  <input
                    aria-label="Eraser size"
                    className="pdf-ink-size-input"
                    min={MIN_PDF_ERASER_SIZE}
                    max={MAX_PDF_ERASER_SIZE}
                    step={2}
                    type="range"
                    value={pdfEraserSize}
                    onChange={(event) => setPdfEraserSize(normalizePdfEraserSize(Number(event.target.value)))}
                  />
                  <span className="reader-zoom-label">{pdfEraserSize}px</span>
                </div>
              ) : null}
              {isPdfTextBoxToolActive ? (
                <>
                  <div className="pdf-text-box-style-swatches" role="toolbar" aria-label="PDF text box text colors">
                    {pdfTextBoxColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="pdf-focus-highlight-swatch pdf-text-box-color-swatch"
                        data-color={color}
                        aria-label={`Text box color ${color}`}
                        aria-pressed={pdfTextBoxColor === color}
                        onClick={() => setPdfTextBoxColor(color)}
                      />
                    ))}
                  </div>
                  <input
                    aria-label="Text box font size"
                    className="reader-page-input pdf-text-box-font-size-input"
                    min={MIN_PDF_TEXT_BOX_FONT_SIZE}
                    max={MAX_PDF_TEXT_BOX_FONT_SIZE}
                    step={1}
                    type="number"
                    value={pdfTextBoxFontSize}
                    onChange={(event) => setPdfTextBoxFontSize(clampPdfTextBoxFontSize(Number(event.target.value)))}
                  />
                </>
              ) : null}
            </div>
            {aiPanelToggle}
          </div>
          {readerView ? (
            <>
              <PdfContinuousReader
                annotations={annotations}
                fitMode={readerFitMode}
                getPdfDocumentInfo={getPdfDocumentInfo as never}
                getPdfInitialPageBundle={getPdfInitialPageBundle as never}
                getPdfLinks={getPdfLinks as never}
                getPdfPageBundle={getPdfPageBundle as never}
                getPdfPageBundlesBatch={getPdfPageBundlesBatch as never}
                getPdfPageText={getPdfPageText as never}
                getPdfPageTextsBatch={getPdfPageTextsBatch as never}
                readPrimaryAttachmentBytes={readPrimaryAttachmentBytes}
                ocrPdfPage={onOcrPdfPage as never}
                pdfEngineSearch={pdfEngineSearch as never}
                page={readerPage}
                searchQuery={readerSearchQuery}
                activeSearchMatchIndex={readerSearchMatchIndex}
                view={readerView}
                zoom={readerZoom}
                onSearchMatchesChange={onReaderSearchMatchesChange}
                onSelectionChange={onSelectionChange}
                onHighlightActivate={onActivePdfHighlight}
                onCreateTextBoxAnnotation={(draft) => {
                  void onCreatePdfFocusTextBoxAnnotation(draft);
                  setIsPdfTextBoxToolActive(false);
                }}
                onCreateInkAnnotation={(draft) => void onCreatePdfFocusInkAnnotation(draft)}
                onUpdateInkAnnotation={(annotationId, anchor, body) => onUpdatePdfTextBoxAnnotation(annotationId, anchor, body)}
                onRemoveInkAnnotation={(annotationId) => onRemovePdfInkAnnotation(annotationId)}
                onUpdateTextBoxAnnotation={(annotationId, anchor, body) => onUpdatePdfTextBoxAnnotation(annotationId, anchor, body)}
                onRemoveTextBoxAnnotation={(annotationId) => onRemovePdfTextBoxAnnotation(annotationId)}
                inkTool={pdfInkTool}
                inkColor={pdfInkColor}
                inkWidth={pdfInkWidth}
                eraserSize={pdfEraserSize}
                textBoxToolActive={isPdfTextBoxToolActive}
                textBoxDefaultColor={pdfTextBoxColor}
                textBoxDefaultFontSize={pdfTextBoxFontSize}
                onActivePageChange={onReaderPageChange}
                onNavigateToPage={onReaderPageChange}
                onPageCountChange={setPdfPageCount}
              />
              {showPdfFocusHighlightBar ? <PdfFocusHighlightBar barRef={pdfFocusHighlightBarRef} style={pdfFocusHighlightBarStyle} onCreateHighlight={(color) => void onCreatePdfFocusHighlight(color)} /> : null}
            </>
          ) : (
            <div className="reader-focus-loading" role="status">
              Loading PDF...
            </div>
          )}
        </section>
      ) : workspaceMode === "pdf_focus" && activePaper && activePaper.attachment_format !== "pdf" && readerView ? (
        <section className="reader-panel reader-panel-focus">
          <div className="reader-toolbar reader-toolbar-focus" role="toolbar" aria-label={canEditMarkdown ? "Markdown edit toolbar" : "Reader toolbar"}>
            <div className="reader-control-group reader-control-group-zoom">
              <button aria-label="Zoom out" className="icon-button" title="Zoom out" type="button" onClick={() => onStepNormalizedZoom(-1)}>
                <ZoomOutIcon />
              </button>
              <span className="reader-zoom-label">{readerZoom}%</span>
              <button aria-label="Zoom in" className="icon-button" title="Zoom in" type="button" onClick={() => onStepNormalizedZoom(1)}>
                <ZoomInIcon />
              </button>
            </div>
            <div className="reader-control-group">
              {!canEditMarkdown ? (
                <button aria-label="Find in document" className="icon-button" title="Find in document" type="button" onClick={openFindHud}>
                  <SearchIcon />
                </button>
              ) : null}
            </div>
            {canEditMarkdown ? (
              <div className="reader-control-group">
                <button
                  aria-label="Save Markdown"
                  className="icon-button"
                  disabled={markdownSaving || markdownDraft.trim().length === 0}
                  title="Save Markdown"
                  type="button"
                  onClick={() => void saveMarkdownEdit()}
                >
                  <SaveIcon />
                </button>
              </div>
            ) : null}
            {aiPanelToggle}
          </div>
          {canEditMarkdown ? (
            <div className="markdown-focus-editor-shell">
              <MDXEditor
                key={readerView.item_id}
                ref={mdxEditorRef}
                className="markdown-mdx-editor"
                contentEditableClassName="markdown-mdx-content"
                markdown={markdownDraft}
                onChange={(value) => {
                  markdownDraftRef.current = value;
                  setMarkdownDraft(value);
                }}
                onError={({ error }) => {
                  console.error("Markdown editor parse error", error);
                }}
                plugins={[
                  headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
                  listsPlugin(),
                  quotePlugin(),
                  thematicBreakPlugin(),
                  linkPlugin(),
                  linkDialogPlugin(),
                  imagePlugin(),
                  tablePlugin(),
                  frontmatterPlugin(),
                  codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
                  codeMirrorPlugin({
                    autoLoadLanguageSupport: false,
                    codeBlockLanguages: {
                      text: "Text",
                      js: "JavaScript",
                      jsx: "JSX",
                      ts: "TypeScript",
                      tsx: "TSX",
                      rust: "Rust",
                      python: "Python",
                      bash: "Bash",
                      json: "JSON",
                      css: "CSS",
                      html: "HTML",
                    },
                  }),
                  diffSourcePlugin({ viewMode: "rich-text" }),
                  markdownShortcutPlugin(),
                  toolbarPlugin({
                    toolbarClassName: "markdown-mdx-toolbar",
                    toolbarContents: () => (
                      <DiffSourceToggleWrapper options={["rich-text", "source"]}>
                        <ConditionalContents
                          options={[
                            { when: (editor) => editor?.editorType === "codeblock", contents: () => <ChangeCodeMirrorLanguage /> },
                            {
                              fallback: () => (
                                <>
                                  <UndoRedo />
                                  <Separator />
                                  <BlockTypeSelect />
                                  <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
                                  <StrikeThroughSupSubToggles options={["Strikethrough"]} />
                                  <CodeToggle />
                                  <Separator />
                                  <ListsToggle options={["bullet", "number", "check"]} />
                                  <CreateLink />
                                  <InsertTable />
                                  <InsertThematicBreak />
                                  <InsertCodeBlock />
                                </>
                              ),
                            },
                          ]}
                        />
                      </DiffSourceToggleWrapper>
                    ),
                  }),
                ]}
              />
            </div>
          ) : (
            <NormalizedReader
              pageHtml={readerView.normalized_html}
              zoom={readerZoom}
              searchQuery={readerSearchQuery}
              activeSearchMatchIndex={readerSearchMatchIndex}
              onSearchMatchesChange={onReaderSearchMatchesChange}
              onSelectionChange={onSelectionChange}
            />
          )}
        </section>
      ) : (
        <section className="reader-panel reader-panel-workspace">
          <div className="reader-meta-row">
            <div>
              <p className="eyebrow">Collection</p>
              <h2>{activeCollection?.name ?? "No collection selected"}</h2>
              <p className="secondary-copy">
                {activeCollection
                  ? `${collectionItems.length} ${collectionItems.length === 1 ? "document" : "documents"}`
                  : hasCollections
                    ? "Select a collection from the left."
                    : "Create your first collection to start building the desktop library."}
              </p>
            </div>
          </div>
          {activeCollection ? (
            <div className="collection-document-list" role="list" aria-label={`${activeCollection.name} documents`}>
              {collectionItems.length > 0 ? collectionItems.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.title}
                  aria-current={activePaper?.id === item.id ? "true" : undefined}
                  className={`collection-document-row ${activePaper?.id === item.id ? "collection-document-row-active" : ""}`}
                  role="listitem"
                  type="button"
                  onClick={() => onActivateItem(item)}
                  onContextMenu={(event) => onDocumentContextMenu(event, item)}
                  onDoubleClick={() => onActivateItem(item)}
                >
                  <span className="collection-document-main">
                    <span className="collection-document-title">{item.title}</span>
                    <span className="collection-document-meta">{item.display_metadata}</span>
                  </span>
                  <span className="collection-document-format">{attachmentFormatLabel(item.attachment_format)}</span>
                  {item.attachment_status !== "ready" ? <span className="collection-document-status">{item.attachment_status}</span> : null}
                </button>
              )) : (
                <div className="citation-card">
                  <p className="eyebrow">Empty Collection</p>
                  <h3>No documents here yet</h3>
                  <p>Import documents into this collection to populate the list.</p>
                </div>
              )}
            </div>
          ) : null}
          {!activeCollection ? (
            <div className="citation-card">
              <p className="eyebrow">Ready for Reading</p>
              <h3>No collection selected</h3>
              <p>{hasCollections ? "Select a collection from the left." : "Create your first collection to start building the desktop library."}</p>
              <button className="ghost-button" type="button" onClick={onShowLibrary}>
                Show Library
              </button>
            </div>
          ) : null}
        </section>
      )}

      {isFindHudOpen ? <FindHud inputRef={readerSearchInputRef} query={readerSearchQuery} matchCount={readerSearchMatchCount} activeMatchIndex={reportedActiveSearchMatchIndex} onQueryChange={onFindQueryChange} onMoveMatch={onMoveMatch} onClose={onCloseFindHud} /> : null}
      {readerContextMenu && selectionForActions ? (
        <div aria-label="Reader selection actions" className="floating-menu reader-selection-menu" role="menu" style={readerContextMenuStyle}>
          <button
            aria-label="Copy"
            className="icon-button"
            role="menuitem"
            title="Copy"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onCopyReaderSelection();
            }}
          >
            <CopyIcon />
          </button>
          <button
            aria-label="Search Selection"
            className="icon-button"
            role="menuitem"
            title="Search Selection"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              onSearchReaderSelection();
            }}
          >
            <SearchIcon />
          </button>
          <button
            aria-label="Translate"
            className="icon-button"
            role="menuitem"
            title="Translate"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onRequestSelectionTranslation();
            }}
          >
            <TranslateIcon />
          </button>
          <button
            aria-label="Ask with Selection"
            className="icon-button"
            role="menuitem"
            title="Ask with Selection"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onAskWithSelection();
            }}
          >
            <MessageIcon />
          </button>
          <button
            aria-label="Add Highlight to Session"
            className="icon-button"
            role="menuitem"
            title="Add Highlight to Session"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onAddHighlightToSession();
            }}
          >
            <HighlightIcon />
          </button>
          <button
            aria-label="Save as Note"
            className="icon-button"
            role="menuitem"
            title="Save as Note"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onSaveSelectionAsNote();
            }}
          >
            <NoteIcon />
          </button>
          {showPdfHighlightActions
            ? pdfHighlightColors.map((color) => (
                <button
                  key={color}
                  aria-label={`Highlight ${color}`}
                  className="icon-button reader-selection-color-item"
                  role="menuitem"
                  title={`Highlight ${color}`}
                  type="button"
                  onClick={() => {
                    setReaderContextMenu(null);
                    void onCreatePdfFocusHighlight(color);
                  }}
                >
                  <span className="pdf-focus-highlight-swatch reader-selection-color-swatch" data-color={color} aria-hidden="true" />
                </button>
              ))
            : null}
          <button
            aria-label="Clear Selection"
            className="icon-button"
            role="menuitem"
            title="Clear Selection"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              onClearReaderSelection();
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {translationPopover ? (
        <div className="translation-popover" role="dialog" aria-label="Translation" style={translationPopoverStyle}>
          <div className="translation-popover-header">
            <span>Translate</span>
            <button aria-label="Close translation" className="icon-button" type="button" onClick={onCloseTranslationPopover}>
              <CloseIcon />
            </button>
          </div>
          {translationLoading ? <p className="translation-popover-status">Translating...</p> : null}
          {translationError ? <p className="translation-popover-error">{translationError}</p> : null}
          {!translationLoading && !translationError ? <p className="translation-popover-text">{translationPopover.translatedText}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
