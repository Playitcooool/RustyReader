import { FindHud } from "./FindHud";
import { PdfFocusHighlightBar } from "./PdfHighlightBars";
import { NormalizedReader } from "../readers/NormalizedReader";
import { PdfContinuousReader } from "../readers/PdfContinuousReader";
import { PdfReader } from "../readers/PdfReader";
import { attachmentFormatLabel, formatItemMetadata, type ReaderFitMode } from "../../lib/appView";
import type { LibraryItem, ReaderView, Annotation } from "../../lib/contracts";
import type { ActivePdfHighlight, PdfTextBoxAnnotationDraft, ReaderTextSelection, TranslationPopover, WorkspaceMode } from "../../hooks/useReaderState";
import type { PdfHighlightColor, PdfTextSelection } from "../readers/pdfSelection";
import { useMemo, useState, type RefObject } from "react";

const pdfHighlightColors = ["yellow", "red", "green", "blue", "purple"] as const satisfies readonly PdfHighlightColor[];

type ReaderWorkspaceData = {
  activePaper: LibraryItem | null;
  activePaperMetadata: string | null;
  annotations: Annotation[];
  currentReaderHtml: string;
  hasCollections: boolean;
  openPapers: LibraryItem[];
  readerView: ReaderView | null;
};

type ReaderWorkspacePdfApi = {
  getPdfDocumentInfo: (primaryAttachmentId: number) => Promise<unknown>;
  getPdfInitialPageBundle?: (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => Promise<unknown>;
  getPdfPageBundle: (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => Promise<unknown>;
  getPdfPageBundlesBatch: (input: { primary_attachment_id: number; page_indexes0: number[]; target_width_px: number }) => Promise<unknown>;
  getPdfPageText: (input: { primary_attachment_id: number; page_index0: number }) => Promise<unknown>;
  getPdfPageTextsBatch: (input: { primary_attachment_id: number; page_indexes0: number[] }) => Promise<unknown>;
  pdfEngineSearch: (input: { primary_attachment_id: number; query: string; max_matches?: number }) => Promise<unknown>;
  onOcrPdfPage: (input: { primary_attachment_id: number; page_index0: number; png_bytes: Uint8Array; lang?: string; config_version: string; source_resolution?: number }) => Promise<unknown>;
};

type ReaderWorkspaceUi = {
  isAiPanelOpen: boolean;
  isFindHudOpen: boolean;
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
  onActivateItem: (item: LibraryItem, options?: { focusPdf?: boolean }) => void;
  onActivePdfHighlight: (highlight: ActivePdfHighlight) => void;
  onAiToggle: () => void | Promise<void>;
  onCloseFindHud: () => void;
  onCloseTab: (itemId: number) => void;
  onClearReaderSelection: () => void;
  onCopyReaderSelection: () => void | Promise<void>;
  onCreatePdfFocusHighlight: (color: PdfHighlightColor) => void | Promise<void>;
  onCreatePdfFocusTextBoxAnnotation: (draft: PdfTextBoxAnnotationDraft) => void | Promise<void>;
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
    activePaper,
    activePaperMetadata,
    annotations,
    currentReaderHtml,
    hasCollections,
    openPapers,
    readerView,
  } = props.data;
  const {
    getPdfDocumentInfo,
    getPdfInitialPageBundle,
    getPdfPageBundle,
    getPdfPageBundlesBatch,
    getPdfPageText,
    getPdfPageTextsBatch,
    onOcrPdfPage,
    pdfEngineSearch,
  } = props.pdfApi;
  const {
    isAiPanelOpen,
    isFindHudOpen,
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
    textToolsEnabled,
    translationError,
    translationLoading,
    translationPopover,
    translationSelection,
    workspaceMode,
  } = props.ui;
  const {
    onActivateItem,
    onActivePdfHighlight,
    onAiToggle,
    onClearReaderSelection,
    onCloseFindHud,
    onCloseTab,
    onCopyReaderSelection,
    onCreatePdfFocusHighlight,
    onCreatePdfFocusTextBoxAnnotation,
    onExitFocus,
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
    onStepNormalizedZoom,
    onSelectionChange,
    onCloseTranslationPopover,
    openFindHud,
    setPdfPageCount,
  } = props.actions;
  const [readerContextMenu, setReaderContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isPdfTextBoxToolActive, setIsPdfTextBoxToolActive] = useState(false);

  const showPdfFocusHighlightBar = Boolean(workspaceMode === "pdf_focus" && activePaper?.attachment_format === "pdf" && pdfSelection);
  const pdfFocusHighlightBarStyle = useMemo(() => {
    if (!showPdfFocusHighlightBar || !pdfSelection) return {};
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const BAR_WIDTH_PX = 224;
    const BAR_HEIGHT_PX = 44;
    const GAP_PX = 10;
    const PADDING_PX = 12;
    const rect = pdfSelection.rect;
    let left = rect.right + GAP_PX;
    let top = rect.top - BAR_HEIGHT_PX - GAP_PX;
    if (top < PADDING_PX) top = rect.bottom + GAP_PX;
    left = clamp(left, PADDING_PX, window.innerWidth - BAR_WIDTH_PX - PADDING_PX);
    top = clamp(top, PADDING_PX, window.innerHeight - BAR_HEIGHT_PX - PADDING_PX);
    return { left: `${left}px`, top: `${top}px` } as const;
  }, [pdfSelection, showPdfFocusHighlightBar]);
  const selectionForActions = translationSelection ?? (pdfSelection ? { quote: pdfSelection.quote, rect: pdfSelection.rect } : null);
  const showPdfHighlightActions = workspaceMode === "pdf_focus" && Boolean(pdfSelection);
  const translationPopoverStyle = useMemo(() => {
    if (!translationPopover) return {};
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const WIDTH_PX = 320;
    const HEIGHT_PX = 180;
    const GAP_PX = 10;
    const PADDING_PX = 12;
    const rect = translationPopover.rect;
    let left = rect.right + GAP_PX;
    let top = rect.top - GAP_PX;
    if (left + WIDTH_PX + PADDING_PX > window.innerWidth) left = rect.left - WIDTH_PX - GAP_PX;
    if (top + HEIGHT_PX + PADDING_PX > window.innerHeight) top = rect.bottom - HEIGHT_PX;
    left = clamp(left, PADDING_PX, window.innerWidth - WIDTH_PX - PADDING_PX);
    top = clamp(top, PADDING_PX, window.innerHeight - HEIGHT_PX - PADDING_PX);
    return { left: `${left}px`, top: `${top}px` } as const;
  }, [translationPopover]);

  return (
    <main
      className={`reader-shell ${workspaceMode === "pdf_focus" ? "reader-shell-focus" : "reader-shell-workspace"}`}
      onClick={() => setReaderContextMenu(null)}
      onContextMenu={(event) => {
        if (!selectionForActions?.quote.trim()) return;
        event.preventDefault();
        setReaderContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className={`reader-tabs ${workspaceMode === "pdf_focus" ? "reader-tabs-focus" : ""}`} role="tablist" aria-label="Open papers">
        {workspaceMode === "pdf_focus" && activePaper?.attachment_format === "pdf" ? (
          <button aria-label="Back to library" className="reader-back-button" title="Back to library" type="button" onClick={onExitFocus}>
            &lt;
          </button>
        ) : null}
        {openPapers.map((paper) => (
          <div key={paper.id} className={`reader-tab-shell ${paper.id === activePaper?.id ? "reader-tab-active" : ""}`}>
            <button aria-selected={paper.id === activePaper?.id} className="reader-tab" role="tab" type="button" onClick={() => (workspaceMode === "pdf_focus" && paper.attachment_format === "pdf" ? onActivateItem(paper, { focusPdf: true }) : onActivateItem(paper))}>
              {paper.title}
            </button>
            <button aria-label={`Close tab ${paper.title}`} className="tab-close-button" type="button" onClick={() => onCloseTab(paper.id)}>
              x
            </button>
          </div>
        ))}
        <button aria-label={isAiPanelOpen ? "Close AI panel" : "Open AI panel"} aria-pressed={isAiPanelOpen} className="icon-button reader-ai-toggle" type="button" onClick={() => void onAiToggle()}>
          ✦
        </button>
      </div>

      {workspaceMode === "pdf_focus" && activePaper?.attachment_format === "pdf" ? (
        <section className="reader-panel reader-panel-focus">
          <div className="reader-toolbar reader-toolbar-focus" role="toolbar" aria-label="PDF focus toolbar">
            <div className="reader-control-group reader-control-group-page">
              <button aria-label="Previous Page" className="ghost-button" disabled={readerPage === 0} type="button" onClick={() => onReaderPageChange(readerPage - 1)}>
                Prev
              </button>
              <input aria-label="Reader page input" className="reader-page-input" value={readerPageInput} onChange={(event) => onReaderPageInputChange(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onReaderPageSubmit()} />
              <span className="reader-control-divider">/ {readerPageCount}</span>
              <button aria-label="Next Page" className="ghost-button" disabled={readerPage >= readerPageCount - 1} type="button" onClick={() => onReaderPageChange(readerPage + 1)}>
                Next
              </button>
            </div>
            <div className="reader-control-group reader-control-group-zoom">
              <button aria-pressed={readerFitMode === "fit_width"} className="ghost-button" type="button" onClick={() => onReaderFitModeChange("fit_width")}>
                Fit
              </button>
              <button aria-label="Zoom out" className="ghost-button" type="button" onClick={() => onPdfZoomChange(readerZoom - 10)}>
                -
              </button>
              <span className="reader-zoom-label">{readerFitMode === "fit_width" ? "Fit width" : `${readerZoom}%`}</span>
              <button aria-label="Zoom in" className="ghost-button" type="button" onClick={() => onPdfZoomChange(readerZoom + 10)}>
                +
              </button>
            </div>
            <div className="reader-control-group">
              <button
                aria-label="Add text box annotation"
                aria-pressed={isPdfTextBoxToolActive}
                className="ghost-button reader-icon-tool"
                title="Add text box annotation"
                type="button"
                onClick={() => setIsPdfTextBoxToolActive((current) => !current)}
              >
                T
              </button>
            </div>
          </div>
          {readerView ? (
            <>
              <PdfContinuousReader
                annotations={annotations}
                fitMode={readerFitMode}
                getPdfDocumentInfo={getPdfDocumentInfo as never}
                getPdfInitialPageBundle={getPdfInitialPageBundle as never}
                getPdfPageBundle={getPdfPageBundle as never}
                getPdfPageBundlesBatch={getPdfPageBundlesBatch as never}
                getPdfPageText={getPdfPageText as never}
                getPdfPageTextsBatch={getPdfPageTextsBatch as never}
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
                textBoxToolActive={isPdfTextBoxToolActive}
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
      ) : (
        <section className="reader-panel reader-panel-workspace">
          <div className="reader-meta-row">
            <div>
              <p className="eyebrow">Reader</p>
              <h2>{activePaper?.title ?? "No paper selected"}</h2>
              <p className="secondary-copy">{activePaper ? activePaperMetadata ?? "No metadata" : "No metadata"}</p>
              <p className="secondary-copy">
                {[activePaper?.collection_id ? null : null, activePaper && activePaper.attachment_status !== "ready" ? activePaper.attachment_status : null, activePaper ? attachmentFormatLabel(activePaper.attachment_format) : "Document"].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          {readerView?.reader_kind !== "pdf" ? (
            <div className="reader-toolbar">
              {textToolsEnabled ? (
                <div className="reader-control-group">
                  <button aria-label="Find in document" className="ghost-button" type="button" onClick={openFindHud}>
                    Search
                  </button>
                </div>
              ) : null}
              <div className="reader-control-group">
                <button aria-label="Zoom out" className="ghost-button" type="button" onClick={() => onStepNormalizedZoom(-1)}>
                  -
                </button>
                <span className="reader-zoom-label">{readerZoom}%</span>
                <button aria-label="Zoom in" className="ghost-button" type="button" onClick={() => onStepNormalizedZoom(1)}>
                  +
                </button>
              </div>
              {readerView && readerView.content_status !== "ready" ? <span className="meta-count">{readerView.content_notice ?? readerView.content_status}</span> : null}
              {activePaper && activePaper.attachment_status !== "ready" ? <span className="meta-count">{activePaper.attachment_status}</span> : null}
            </div>
          ) : null}
          {activePaper && readerView ? (
            readerView.reader_kind === "pdf" ? (
              <PdfReader fitMode={readerFitMode} getPdfDocumentInfo={getPdfDocumentInfo as never} getPdfPageBundle={getPdfPageBundle as never} page={0} view={readerView} zoom={readerZoom} onHighlightActivate={onActivePdfHighlight} onPageCountChange={setPdfPageCount} />
            ) : (
              <NormalizedReader pageHtml={currentReaderHtml} searchQuery={readerSearchQuery} activeSearchMatchIndex={readerSearchMatchIndex} onSearchMatchesChange={onReaderSearchMatchesChange} onSelectionChange={onSelectionChange} zoom={readerZoom} />
            )
          ) : (
            <div className="citation-card">
              <p className="eyebrow">Ready for Reading</p>
              <h3>No collection selected</h3>
              <p>{hasCollections ? "Select a document from the resource tree." : "Create your first collection to start building the desktop library."}</p>
              <button className="ghost-button" type="button" onClick={onShowLibrary}>
                Show Library
              </button>
            </div>
          )}
          {readerView && readerView.reader_kind !== "pdf" ? (
            <div className="citation-card">
              <p className="eyebrow">Reader Content</p>
              <h3>{readerView.title}</h3>
              <p>{readerView.plain_text}</p>
            </div>
          ) : null}
        </section>
      )}

      {isFindHudOpen ? <FindHud inputRef={readerSearchInputRef} query={readerSearchQuery} matchCount={readerSearchMatchCount} activeMatchIndex={reportedActiveSearchMatchIndex} onQueryChange={onFindQueryChange} onMoveMatch={onMoveMatch} onClose={onCloseFindHud} /> : null}
      {readerContextMenu && selectionForActions ? (
        <div aria-label="Reader selection actions" className="floating-menu reader-selection-menu" role="menu" style={{ left: readerContextMenu.x, top: readerContextMenu.y }}>
          <button
            className="nav-item"
            role="menuitem"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onCopyReaderSelection();
            }}
          >
            Copy
          </button>
          <button
            className="nav-item"
            role="menuitem"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              onSearchReaderSelection();
            }}
          >
            Search Selection
          </button>
          <button
            className="nav-item"
            role="menuitem"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              void onRequestSelectionTranslation();
            }}
          >
            Translate
          </button>
          {showPdfHighlightActions
            ? pdfHighlightColors.map((color) => (
                <button
                  key={color}
                  className="nav-item reader-selection-color-item"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setReaderContextMenu(null);
                    void onCreatePdfFocusHighlight(color);
                  }}
                >
                  <span className="pdf-focus-highlight-swatch reader-selection-color-swatch" data-color={color} aria-hidden="true" />
                  <span>Highlight {color}</span>
                </button>
              ))
            : null}
          <button
            className="nav-item"
            role="menuitem"
            type="button"
            onClick={() => {
              setReaderContextMenu(null);
              onClearReaderSelection();
            }}
          >
            Clear Selection
          </button>
        </div>
      ) : null}
      {translationPopover ? (
        <div className="translation-popover" role="dialog" aria-label="Translation" style={translationPopoverStyle}>
          <div className="translation-popover-header">
            <span>Translate</span>
            <button aria-label="Close translation" className="icon-button" type="button" onClick={onCloseTranslationPopover}>
              x
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
