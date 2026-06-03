import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PdfContinuousReader } from "./PdfContinuousReader";
import type { ReaderView } from "../../lib/contracts";
import { getLegacyDocumentMock } from "../../test/pdfjsLegacyMock";

const pdfView: ReaderView = {
  item_id: 1,
  title: "Native PDF Paper",
  reader_kind: "pdf",
  attachment_format: "pdf",
  primary_attachment_id: 101,
  primary_attachment_path: "/mock/native-pdf-paper.pdf",
  page_count: 3,
  content_status: "ready",
  content_notice: null,
  normalized_html: "<article><p>Fallback</p></article>",
  plain_text: "PDF preview",
};

const makeBundle = (text: string) => ({
  png_bytes: new Uint8Array([137, 80, 78, 71]),
  width_px: 800,
  height_px: 1000,
  page_width_pt: 600,
  page_height_pt: 750,
  spans: text ? [{ text, x0: 10, y0: 700, x1: 200, y1: 720 }] : [],
});

const makePageText = (text: string, pageIndex0 = 0) => ({
  page_index0: pageIndex0,
  spans: makeBundle(text).spans,
});

const makeDocumentInfo = (pageCount = 3) => ({
  page_count: pageCount,
  pages: [{ width_pt: 600, height_pt: 750 }],
});

const emptySearchResult = () => ({ total: 0, matches: [] as Array<{ page_index0: number; span_index: number; start: number; end: number }> });

describe("PdfContinuousReader", () => {
  beforeEach(() => {
    if (!("createObjectURL" in URL)) {
      Object.defineProperty(URL, "createObjectURL", { value: () => "blob:pdf-page", writable: true });
    }
    if (!("revokeObjectURL" in URL)) {
      Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
    }
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf-page");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(window, "requestIdleCallback", {
      value: ((cb: IdleRequestCallback) => {
        cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        return 1;
      }) as typeof window.requestIdleCallback,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true, writable: true });
    if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
      HTMLElement.prototype.scrollIntoView = (() => {}) as unknown as typeof HTMLElement.prototype.scrollIntoView;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = class ResizeObserverMock {
      observe = () => {};
      disconnect = () => {};
      unobserve = () => {};
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = class IntersectionObserverMock {
      constructor(_callback: IntersectionObserverCallback) {}
      observe = () => {};
      unobserve = () => {};
      disconnect = () => {};
      takeRecords = () => [];
      root = null;
      rootMargin = "";
      thresholds = [];
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).elementFromPoint;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).IntersectionObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ResizeObserver;
  });

  it("renders page shells for all pages and keeps controlled page changes stable", async () => {
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(`Page ${page_index0 + 1}`),
    );
    const getPdfPageBundlesBatch = vi.fn().mockImplementation(async ({ page_indexes0 }: { page_indexes0: number[] }) =>
      page_indexes0.map((pageIndex0) => makeBundle(`Page ${pageIndex0 + 1}`)),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makePageText(`Page ${page_index0 + 1}`, page_index0),
    );
    const getPdfPageTextsBatch = vi.fn().mockResolvedValue([]);
    const pdfEngineSearch = vi.fn().mockResolvedValue(emptySearchResult());
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { rerender, container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageBundlesBatch={getPdfPageBundlesBatch}
        getPdfPageText={getPdfPageText}
        getPdfPageTextsBatch={getPdfPageTextsBatch}
        ocrPdfPage={ocrPdfPage}
        pdfEngineSearch={pdfEngineSearch}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-page-shell")).toHaveLength(3);
    });
    expect(getPdfPageBundle.mock.calls.length).toBeLessThanOrEqual(3);

    rerender(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageBundlesBatch={getPdfPageBundlesBatch}
        getPdfPageText={getPdfPageText}
        getPdfPageTextsBatch={getPdfPageTextsBatch}
        ocrPdfPage={ocrPdfPage}
        pdfEngineSearch={pdfEngineSearch}
        page={2}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-page-shell")).toHaveLength(3);
    });
  });

  it("only requests nearby pages and releases far rendered pages", async () => {
    const longPdfView: ReaderView = { ...pdfView, page_count: 20 };
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(`Page ${page_index0 + 1}`),
    );
    const getPdfPageBundlesBatch = vi.fn().mockImplementation(async ({ page_indexes0 }: { page_indexes0: number[] }) =>
      page_indexes0.map((pageIndex0) => makeBundle(`Page ${pageIndex0 + 1}`)),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo(20));
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makePageText(page_index0 === 0 ? "needle first" : page_index0 === 1 ? "needle second" : "no match", page_index0),
    );
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { rerender } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageBundlesBatch={getPdfPageBundlesBatch}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(getPdfPageText.mock.calls.length).toBeLessThanOrEqual(3);
    });

    rerender(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageBundlesBatch={getPdfPageBundlesBatch}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={10}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      const requestedPages = getPdfPageText.mock.calls.length;
      expect(requestedPages).toBeLessThanOrEqual(24);
      expect(requestedPages).toBeGreaterThanOrEqual(5);
    });
  });

  it("keeps long-document far pages as lightweight spacers", async () => {
    const longPdfView: ReaderView = { ...pdfView, page_count: 80 };
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(`Page ${page_index0 + 1}`),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo(80));
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("Sharp text"));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={40}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-page-shell").length).toBeLessThanOrEqual(30);
    });
    expect(container.querySelectorAll(".pdf-text-layer").length).toBeLessThan(10);
    expect(container.querySelector('[data-page-index="10"]')).toBeNull();
    expect(container.querySelector('[data-page-index="40"]')?.classList.contains("pdf-page-shell-spacer")).toBe(false);
  });

  it("bounds layout reads while syncing active page on long-document scroll", async () => {
    const longPdfView: ReaderView = { ...pdfView, page_count: 80 };
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(`Page ${page_index0 + 1}`),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo(80));
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makePageText(page_index0 === 0 ? "needle first" : page_index0 === 1 ? "needle second" : "no match", page_index0),
    );
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { container, rerender } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={40}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-page-shell").length).toBeLessThanOrEqual(30);
    });

    let shellRectReads = 0;
    container.querySelectorAll<HTMLElement>(".pdf-page-shell").forEach((shell) => {
      const index = Number(shell.dataset.pageIndex ?? 0);
      shell.getBoundingClientRect = vi.fn(() => {
        shellRectReads += 1;
        return {
          x: 0,
          y: (index - 40) * 1012,
          left: 0,
          right: 800,
          top: (index - 40) * 1012,
          bottom: (index - 40) * 1012 + 1000,
          width: 800,
          height: 1000,
          toJSON: () => ({}),
        } as DOMRect;
      });
    });

    rerender(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={41}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(shellRectReads).toBeGreaterThan(0);
      expect(shellRectReads).toBeLessThanOrEqual(15);
    });
  });

  it("reports search matches across rendered pages", async () => {
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(page_index0 === 1 ? "needle here" : "no match"),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) => ({
      page_index0,
      spans: [{ text: page_index0 === 1 ? "needle here" : "no match", x0: 10, y0: 700, x1: 200, y1: 720 }],
    }));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onSearchMatchesChange = vi.fn();

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        searchQuery="needle"
        view={pdfView}
        zoom={100}
        onSearchMatchesChange={onSearchMatchesChange}
      />,
    );

    await waitFor(() => {
      expect(onSearchMatchesChange).toHaveBeenLastCalledWith({ total: 1, activeIndex: 0 });
    });
  });

  it("keeps global search hit indexes stable across pages", async () => {
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(page_index0 === 0 ? "needle first" : page_index0 === 1 ? "needle second" : "no match"),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makePageText(page_index0 === 0 ? "needle first" : page_index0 === 1 ? "needle second" : "no match", page_index0),
    );
    const pdfEngineSearch = vi.fn().mockResolvedValue({
      total: 2,
      matches: [
        { page_index0: 0, span_index: 0, start: 0, end: 6 },
        { page_index0: 1, span_index: 0, start: 0, end: 6 },
      ],
    });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        pdfEngineSearch={pdfEngineSearch}
        page={0}
        searchQuery="needle"
        activeSearchMatchIndex={1}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      const active = document.querySelector(".pdf-search-hit-active") as HTMLElement | null;
      expect(active?.dataset.hitIndex).toBe("1");
    });
  });

  it("renders current page at 1x first, then upgrades visible page to high-dpi without changing css size", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true, writable: true });
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Sharp text"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(getPdfPageText).toHaveBeenCalled());
    expect(getPdfPageBundle).not.toHaveBeenCalled();

    const image = await screen.findByLabelText("PDF page 1 image");
    expect(image).toHaveStyle({ width: "800px", height: "1000px" });
  });

  it("does not downgrade a sharp high-dpi page to a 1x raster after scrolling back", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true, writable: true });
    const renderCalls: Array<{ pageIndex0: number; width: number }> = [];
    getLegacyDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: vi.fn(async (pageNumber: number) => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 800 * scale,
            height: 1000 * scale,
          }),
          render: vi.fn(({ viewport }: { viewport: { width: number } }) => {
            renderCalls.push({ pageIndex0: pageNumber - 1, width: viewport.width });
            return { promise: Promise.resolve() };
          }),
        })),
        destroy: vi.fn(async () => undefined),
      }),
    }));
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Sharp text"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makePageText(`Page ${page_index0 + 1}`, page_index0),
    );
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { rerender } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(renderCalls.some((call) => call.pageIndex0 === 0 && call.width === 1600)).toBe(true);
    });
    renderCalls.length = 0;

    rerender(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={1}
        view={pdfView}
        zoom={100}
      />,
    );
    rerender(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("PDF page 1 image")).toBeInTheDocument());
    expect(renderCalls.some((call) => call.pageIndex0 === 0 && call.width === 800)).toBe(false);
  });

  it("falls back to OCR when native text is empty", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle(""));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("bad\uFFFDtext"));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [{ text: "OCR page 1", bbox: { left: 0.1, top: 0.1, width: 0.4, height: 0.03 }, confidence: 95 }],
    });

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(ocrPdfPage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("OCR page 1").length).toBeGreaterThan(0));
  });

  it("falls back to OCR when native text is obviously garbled", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("bad\uFFFDtext"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("bad\uFFFDbad"));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [{ text: "OCR repaired", bbox: { left: 0.1, top: 0.1, width: 0.4, height: 0.03 }, confidence: 95 }],
    });

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(ocrPdfPage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("OCR repaired").length).toBeGreaterThan(0));
  });

  it("does not call OCR when native text looks healthy", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("healthy native text"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("healthy native text"));
    const ocrPdfPage = vi.fn();

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(getPdfPageText).toHaveBeenCalled());
    expect(ocrPdfPage).not.toHaveBeenCalled();
  });

  it("registers a window scroll fallback listener for continuous mode", async () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(`Page ${page_index0 + 1}`),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const { container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".pdf-page-shell")).toHaveLength(3);
    });
    expect(addEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });
  });

  it("only OCRs the current or visible page even if nearby prerendered pages have empty text", async () => {
    const longPdfView: ReaderView = { ...pdfView, page_count: 6 };
    const getPdfPageBundle = vi.fn().mockImplementation(async ({ page_index0 }: { page_index0: number }) =>
      makeBundle(page_index0 === 0 ? "" : ""),
    );
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo(6));
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [{ text: "OCR current page", bbox: { left: 0.1, top: 0.1, width: 0.4, height: 0.03 }, confidence: 95 }],
    });

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={longPdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(ocrPdfPage).toHaveBeenCalledTimes(1));
    expect(ocrPdfPage).toHaveBeenCalledWith(expect.objectContaining({ page_index0: 0 }));
  });

  it("activates persisted highlights with annotation ids", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("Hello world"));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onHighlightActivate = vi.fn();

    render(
      <PdfContinuousReader
        annotations={[
          {
            id: 12,
            item_id: pdfView.item_id,
            kind: "highlight",
            body: "",
            anchor: JSON.stringify({
              type: "pdf_text",
              page: 1,
              startDivIndex: 0,
              startOffset: 0,
              endDivIndex: 0,
              endOffset: 5,
              quote: "Hello",
              color: "yellow",
            }),
          },
        ]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onHighlightActivate={onHighlightActivate}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".pdf-annotation-highlight")).toBeTruthy();
    });
    const highlight = document.querySelector(".pdf-annotation-highlight") as HTMLElement;
    expect(highlight.dataset.annotationId).toBe("12");
    fireEvent.click(highlight);
    expect(onHighlightActivate).toHaveBeenCalledWith({
      annotationId: 12,
      rect: expect.objectContaining({
        left: expect.any(Number),
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
      }),
    });
  });

  it("clears a stale text selection when the reader is clicked", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue(makePageText("Hello world"));
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onSelectionChange = vi.fn();

    render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onSelectionChange={onSelectionChange}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const reader = await screen.findByTestId("pdf-reader");
    fireEvent.pointerDown(reader, { button: 0, pointerId: 1, pointerType: "mouse" });

    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it("commits a text box draft with Enter and includes current text style", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onCreateTextBoxAnnotation = vi.fn();

    const { container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onCreateTextBoxAnnotation={onCreateTextBoxAnnotation}
        page={0}
        textBoxDefaultColor="blue"
        textBoxDefaultFontSize={18}
        textBoxToolActive
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(container.querySelector('[data-page-index="0"]')).toBeTruthy());
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(shell, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 80, clientY: 120 });
    await waitFor(() => expect(container.querySelector(".pdf-text-box-drawing")).toBeTruthy());
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });
    fireEvent.mouseUp(window);

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    fireEvent.change(textarea, { target: { value: "Styled note" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onCreateTextBoxAnnotation).toHaveBeenCalledWith({
      body: "Styled note",
      anchor: expect.stringContaining('"color":"blue"'),
    }));
    expect(onCreateTextBoxAnnotation.mock.calls[0]?.[0].anchor).toContain('"fontSize":18');
    expect(textarea).not.toHaveFocus();
  });

  it("commits a text box draft on blur and removes empty drafts", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onCreateTextBoxAnnotation = vi.fn();

    const { container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onCreateTextBoxAnnotation={onCreateTextBoxAnnotation}
        page={0}
        textBoxToolActive
        view={pdfView}
        zoom={100}
      />,
    );

    await waitFor(() => expect(container.querySelector('[data-page-index="0"]')).toBeTruthy());
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(shell, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 80, clientY: 120 });
    await waitFor(() => expect(container.querySelector(".pdf-text-box-drawing")).toBeTruthy());
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });
    fireEvent.mouseUp(window);
    let textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    fireEvent.change(textarea, { target: { value: "Blur note" } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(onCreateTextBoxAnnotation).toHaveBeenCalledWith(expect.objectContaining({ body: "Blur note" })));

    fireEvent.mouseDown(shell, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 300 });
    await waitFor(() => expect(container.querySelector(".pdf-text-box-drawing")).toBeTruthy());
    fireEvent.mouseMove(window, { clientX: 350, clientY: 430 });
    fireEvent.mouseUp(window);
    textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    fireEvent.blur(textarea);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "PDF text box annotation" })).not.toBeInTheDocument());
    expect(onCreateTextBoxAnnotation).toHaveBeenCalledTimes(1);
  });

  it("renders persisted text boxes using anchor style and read-only text", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1, color: "purple", fontSize: 20 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    expect(textarea).toHaveValue("Persisted note");
    expect(textarea).toHaveAttribute("readonly");
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;
    expect(box).toHaveStyle({ color: "rgb(128, 0, 128)", fontSize: "20px" });
  });

  it("draws a freehand ink annotation with the configured pencil style", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onCreateInkAnnotation = vi.fn();

    const { container } = render(
      <PdfContinuousReader
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onCreateInkAnnotation={onCreateInkAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
        inkTool="pencil"
        inkColor="#3366ff"
        inkWidth={7}
      />,
    );

    await screen.findByLabelText("PDF page 1 image");
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(shell, { button: 0, buttons: 1, clientX: 80, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 160, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 240, clientY: 300 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onCreateInkAnnotation).toHaveBeenCalledTimes(1));
    const anchor = JSON.parse(onCreateInkAnnotation.mock.calls[0]?.[0].anchor as string) as {
      type: string;
      page: number;
      color: string;
      width: number;
      points: Array<{ x: number; y: number }>;
    };
    expect(anchor).toMatchObject({ type: "pdf_ink", page: 1, color: "#3366ff", width: 7 });
    expect(anchor.points.length).toBeGreaterThanOrEqual(2);
    expect(anchor.points[0]?.x).toBeCloseTo(0.1);
    expect(anchor.points[0]?.y).toBeCloseTo(0.1);
  });

  it("erases an ink annotation when the eraser intersects the stroke", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onRemoveInkAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 44,
          item_id: pdfView.item_id,
          kind: "ink",
          body: "",
          anchor: JSON.stringify({ type: "pdf_ink", page: 1, color: "#3366ff", width: 6, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }] }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onRemoveInkAnnotation={onRemoveInkAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
        inkTool="eraser"
        eraserSize={40}
      />,
    );

    await screen.findByLabelText("PDF page 1 ink annotations");
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(shell, { button: 0, buttons: 1, clientX: 160, clientY: 200 });

    await waitFor(() => expect(onRemoveInkAnnotation).toHaveBeenCalledWith(44));
  });

  it("does not erase an ink annotation by hovering near the stroke", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onRemoveInkAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 45,
          item_id: pdfView.item_id,
          kind: "ink",
          body: "",
          anchor: JSON.stringify({ type: "pdf_ink", page: 1, color: "#3366ff", width: 6, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }] }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onRemoveInkAnnotation={onRemoveInkAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
        inkTool="eraser"
        eraserSize={40}
      />,
    );

    await screen.findByLabelText("PDF page 1 ink annotations");
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(shell),
    });

    fireEvent.mouseMove(window, { buttons: 0, clientX: 160, clientY: 200 });

    expect(onRemoveInkAnnotation).not.toHaveBeenCalled();
  });

  it("splits an ink annotation when the eraser cuts through the middle of a stroke", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onCreateInkAnnotation = vi.fn().mockResolvedValue(undefined);
    const onUpdateInkAnnotation = vi.fn().mockResolvedValue(undefined);
    const onRemoveInkAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 46,
          item_id: pdfView.item_id,
          kind: "ink",
          body: "",
          anchor: JSON.stringify({
            type: "pdf_ink",
            page: 1,
            color: "#3366ff",
            width: 6,
            points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.6, y: 0.1 }],
          }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onCreateInkAnnotation={onCreateInkAnnotation}
        onUpdateInkAnnotation={onUpdateInkAnnotation}
        onRemoveInkAnnotation={onRemoveInkAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
        inkTool="eraser"
        eraserSize={40}
      />,
    );

    await screen.findByLabelText("PDF page 1 ink annotations");
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(shell, { button: 0, buttons: 1, clientX: 280, clientY: 100 });

    await waitFor(() => expect(onUpdateInkAnnotation).toHaveBeenCalledTimes(1));
    expect(onUpdateInkAnnotation.mock.calls[0]?.[0]).toBe(46);
    expect(JSON.parse(onUpdateInkAnnotation.mock.calls[0]?.[1] as string).points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }]);
    expect(onCreateInkAnnotation).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onCreateInkAnnotation.mock.calls[0]?.[0].anchor as string).points).toEqual([{ x: 0.5, y: 0.1 }, { x: 0.6, y: 0.1 }]);
    expect(onRemoveInkAnnotation).not.toHaveBeenCalled();
  });

  it("moves and resizes persisted text box annotations before persisting geometry", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onUpdateTextBoxAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1, color: "purple", fontSize: 20 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onUpdateTextBoxAnnotation={onUpdateTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;

    fireEvent.mouseDown(box, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 80, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 160, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 160, clientY: 300 });

    await waitFor(() => expect(onUpdateTextBoxAnnotation).toHaveBeenCalledTimes(1));
    let anchor = JSON.parse(onUpdateTextBoxAnnotation.mock.calls[0]?.[1] as string) as { x: number; y: number; width: number; height: number };
    expect(onUpdateTextBoxAnnotation.mock.calls[0]?.[0]).toBe(33);
    expect(anchor.x).toBeCloseTo(0.2);
    expect(anchor.y).toBeCloseTo(0.3);
    expect(anchor.width).toBeCloseTo(0.3);
    expect(anchor.height).toBeCloseTo(0.1);

    const southeastHandle = container.querySelector('.pdf-text-box-resize-handle[data-handle="se"]') as HTMLElement;
    fireEvent.mouseDown(southeastHandle, { button: 0, buttons: 1, pointerId: 2, pointerType: "mouse", clientX: 400, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 480, clientY: 450 });
    fireEvent.mouseUp(window, { clientX: 480, clientY: 450 });

    await waitFor(() => expect(onUpdateTextBoxAnnotation).toHaveBeenCalledTimes(2));
    anchor = JSON.parse(onUpdateTextBoxAnnotation.mock.calls[1]?.[1] as string) as { x: number; y: number; width: number; height: number };
    expect(anchor.width).toBeCloseTo(0.4);
    expect(anchor.height).toBeCloseTo(0.15);
  });

  it("edits persisted text box body on double click and saves on blur", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onUpdateTextBoxAnnotation = vi.fn().mockResolvedValue(undefined);
    const anchor = { type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify(anchor),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onUpdateTextBoxAnnotation={onUpdateTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;

    fireEvent.doubleClick(box);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "PDF text box annotation" })).not.toHaveAttribute("readonly"));
    expect(container.querySelector(".pdf-text-box-resize-handle")).toBeNull();

    const editableTextarea = screen.getByRole("textbox", { name: "PDF text box annotation" });
    fireEvent.change(editableTextarea, { target: { value: "Updated\nnote" } });
    fireEvent.blur(editableTextarea, { target: { value: "Updated\nnote" } });

    await waitFor(() => expect(onUpdateTextBoxAnnotation).toHaveBeenCalledTimes(1));
    expect(onUpdateTextBoxAnnotation.mock.calls[0]?.[0]).toBe(33);
    expect(JSON.parse(onUpdateTextBoxAnnotation.mock.calls[0]?.[1] as string)).toMatchObject(anchor);
    expect(onUpdateTextBoxAnnotation.mock.calls[0]?.[2]).toBe("Updated\nnote");
  });

  it("hides persisted text box resize handles when clicking outside", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;
    const reader = container.querySelector(".pdf-reader") as HTMLElement;

    fireEvent.mouseDown(box, { button: 0, buttons: 1, clientX: 80, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 200 });
    await waitFor(() => expect(container.querySelector(".pdf-text-box-resize-handle")).toBeTruthy());

    fireEvent.pointerDown(reader, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 4, clientY: 4 });
    await waitFor(() => expect(container.querySelector(".pdf-text-box-resize-handle")).toBeNull());
  });

  it("selects persisted text boxes by clicking body text and removes selected boxes with Delete", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onRemoveTextBoxAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onRemoveTextBoxAnnotation={onRemoveTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    fireEvent.mouseDown(textarea, { button: 0, buttons: 1, clientX: 80, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 200 });

    await waitFor(() => expect(container.querySelector(".pdf-text-box-resize-handle")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => expect(onRemoveTextBoxAnnotation).toHaveBeenCalledWith(33));
  });

  it("does not remove a text box when Delete is pressed while editing its body", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onRemoveTextBoxAnnotation = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onRemoveTextBoxAnnotation={onRemoveTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;
    fireEvent.doubleClick(box);
    await waitFor(() => expect(textarea).not.toHaveAttribute("readonly"));

    fireEvent.keyDown(textarea, { key: "Delete" });

    expect(onRemoveTextBoxAnnotation).not.toHaveBeenCalled();
  });

  it("rolls back persisted text box body when saving fails", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onUpdateTextBoxAnnotation = vi.fn().mockRejectedValue(new Error("update failed"));

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onUpdateTextBoxAnnotation={onUpdateTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    const textarea = await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;

    fireEvent.doubleClick(box);
    fireEvent.change(textarea, { target: { value: "Unsaved note" } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(onUpdateTextBoxAnnotation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(textarea).toHaveValue("Persisted note"));
    expect(textarea).toHaveAttribute("readonly");
  });

  it("clamps and rolls back persisted text box annotation geometry when persistence fails", async () => {
    const getPdfPageBundle = vi.fn().mockResolvedValue(makeBundle("Hello world"));
    const getPdfDocumentInfo = vi.fn().mockResolvedValue(makeDocumentInfo());
    const getPdfPageText = vi.fn().mockResolvedValue({ page_index0: 0, spans: [] });
    const ocrPdfPage = vi.fn().mockResolvedValue({
      primary_attachment_id: 101,
      page_index0: 0,
      lang: "eng+chi_sim",
      config_version: "test",
      lines: [],
    });
    const onUpdateTextBoxAnnotation = vi.fn().mockRejectedValue(new Error("update failed"));

    const { container } = render(
      <PdfContinuousReader
        annotations={[{
          id: 33,
          item_id: pdfView.item_id,
          kind: "text_box",
          body: "Persisted note",
          anchor: JSON.stringify({ type: "pdf_text_box", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }),
        }]}
        getPdfDocumentInfo={getPdfDocumentInfo}
        getPdfPageBundle={getPdfPageBundle}
        getPdfPageText={getPdfPageText}
        ocrPdfPage={ocrPdfPage}
        onUpdateTextBoxAnnotation={onUpdateTextBoxAnnotation}
        page={0}
        view={pdfView}
        zoom={100}
      />,
    );

    await screen.findByRole("textbox", { name: "PDF text box annotation" });
    const shell = container.querySelector('[data-page-index="0"]') as HTMLElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    });
    const box = container.querySelector(".pdf-text-box-annotation") as HTMLElement;

    fireEvent.mouseDown(box, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 80, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 1200, clientY: 1300 });
    fireEvent.mouseUp(window, { clientX: 1200, clientY: 1300 });

    await waitFor(() => expect(onUpdateTextBoxAnnotation).toHaveBeenCalledTimes(1));
    const anchor = JSON.parse(onUpdateTextBoxAnnotation.mock.calls[0]?.[1] as string) as { x: number; y: number };
    expect(anchor.x).toBeCloseTo(0.7);
    expect(anchor.y).toBeCloseTo(0.9);
    await waitFor(() => expect(box).toHaveStyle({ left: "10%", top: "20%" }));
  });

});
