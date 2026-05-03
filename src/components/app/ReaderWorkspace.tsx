import { FindHud } from "./FindHud";
import { PdfFocusHighlightBar } from "./PdfHighlightBars";
import { NormalizedReader } from "../readers/NormalizedReader";
import { PdfContinuousReader } from "../readers/PdfContinuousReader";
import { PdfReader } from "../readers/PdfReader";
import { attachmentFormatLabel, formatItemMetadata, type ReaderFitMode } from "../../lib/appView";
import type { LibraryItem, ReaderView, Annotation } from "../../lib/contracts";
import type { ActivePdfHighlight, WorkspaceMode } from "../../hooks/useReaderState";
import type { PdfHighlightColor, PdfTextSelection } from "../readers/pdfSelection";
import { useMemo } from "react";

type Props = {
  activePaper: LibraryItem | null;
  activePaperMetadata: string | null;
  annotations: Annotation[];
  currentReaderHtml: string;
  getPdfDocumentInfo: (primaryAttachmentId: number) => Promise<unknown>;
  getPdfPageBundle: (input: { primary_attachment_id: number; page_index0: number; target_width_px: number }) => Promise<unknown>;
  getPdfPageText: (input: { primary_attachment_id: number; page_index0: number }) => Promise<unknown>;
  hasCollections: boolean;
  isAiPanelOpen: boolean;
  isFindHudOpen: boolean;
  onActivateItem: (item: LibraryItem, options?: { focusPdf?: boolean }) => void;
  onActivePdfHighlight: (highlight: ActivePdfHighlight) => void;
  onAiToggle: () => void | Promise<void>;
  onCloseFindHud: () => void;
  onCloseTab: (itemId: number) => void;
  onCreatePdfFocusHighlight: (color: PdfHighlightColor) => void | Promise<void>;
  onExitFocus: () => void;
  onFindQueryChange: (value: string) => void;
  onMoveMatch: (direction: 1 | -1, source: "button" | "enter") => void;
  onOcrPdfPage: (input: { primary_attachment_id: number; page_index0: number; png_bytes: Uint8Array; lang?: string; config_version: string; source_resolution?: number }) => Promise<unknown>;
  onReaderFitModeChange: (mode: ReaderFitMode) => void;
  onReaderPageChange: (value: number) => void;
  onReaderPageInputChange: (value: string) => void;
  onReaderPageSubmit: () => void;
  onReaderSearchMatchesChange: (state: { total: number; activeIndex: number }) => void;
  onPdfZoomChange: (value: number) => void;
  onStepNormalizedZoom: (direction: 1 | -1) => void;
  onSelectionChange: (selection: PdfTextSelection | null) => void;
  openFindHud: () => void;
  openPapers: LibraryItem[];
  pdfFocusHighlightBarRef: React.RefObject<HTMLDivElement>;
  pdfSelection: PdfTextSelection | null;
  readerFitMode: ReaderFitMode;
  readerPage: number;
  readerPageCount: number;
  readerPageInput: string;
  readerSearchInputRef: React.RefObject<HTMLInputElement>;
  readerSearchMatchCount: number;
  readerSearchMatchIndex: number;
  readerSearchQuery: string;
  readerView: ReaderView | null;
  readerZoom: number;
  reportedActiveSearchMatchIndex: number;
  setPdfPageCount: (pageCount: number) => void;
  textToolsEnabled: boolean;
  workspaceMode: WorkspaceMode;
};

export function ReaderWorkspace(props: Props) {
  const {
    activePaper,
    activePaperMetadata,
    annotations,
    currentReaderHtml,
    getPdfDocumentInfo,
    getPdfPageBundle,
    getPdfPageText,
    hasCollections,
    isAiPanelOpen,
    isFindHudOpen,
    onActivateItem,
    onActivePdfHighlight,
    onAiToggle,
    onCloseFindHud,
    onCloseTab,
    onCreatePdfFocusHighlight,
    onExitFocus,
    onFindQueryChange,
    onMoveMatch,
    onOcrPdfPage,
    onReaderFitModeChange,
    onReaderPageChange,
    onReaderPageInputChange,
    onReaderPageSubmit,
    onReaderSearchMatchesChange,
    onPdfZoomChange,
    onStepNormalizedZoom,
    onSelectionChange,
    openFindHud,
    openPapers,
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
    readerView,
    readerZoom,
    reportedActiveSearchMatchIndex,
    setPdfPageCount,
    textToolsEnabled,
    workspaceMode,
  } = props;

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

  return (
    <main className={`reader-shell ${workspaceMode === "pdf_focus" ? "reader-shell-focus" : "reader-shell-workspace"}`}>
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
            {textToolsEnabled ? (
              <div className="reader-control-group">
                <button aria-label="Find in document" className="ghost-button" type="button" onClick={openFindHud}>
                  Search
                </button>
              </div>
            ) : null}
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
          </div>
          {readerView ? (
            <>
              <PdfContinuousReader
                annotations={annotations}
                fitMode={readerFitMode}
                getPdfDocumentInfo={getPdfDocumentInfo as never}
                getPdfPageBundle={getPdfPageBundle as never}
                getPdfPageText={getPdfPageText as never}
                ocrPdfPage={onOcrPdfPage as never}
                page={readerPage}
                searchQuery={readerSearchQuery}
                activeSearchMatchIndex={readerSearchMatchIndex}
                view={readerView}
                zoom={readerZoom}
                onSearchMatchesChange={onReaderSearchMatchesChange}
                onSelectionChange={onSelectionChange}
                onHighlightActivate={onActivePdfHighlight}
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
              <NormalizedReader pageHtml={currentReaderHtml} searchQuery={readerSearchQuery} activeSearchMatchIndex={readerSearchMatchIndex} onSearchMatchesChange={onReaderSearchMatchesChange} zoom={readerZoom} />
            )
          ) : (
            <div className="citation-card">
              <p className="eyebrow">Ready for Reading</p>
              <h3>No collection selected</h3>
              <p>{hasCollections ? "Select a document from the resource tree." : "Create your first collection to start building the desktop library."}</p>
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
    </main>
  );
}
