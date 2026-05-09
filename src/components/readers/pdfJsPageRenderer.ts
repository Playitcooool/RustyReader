import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfJsWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl;

export type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy?: () => Promise<void> | void;
};

type PdfJsPage = {
  getViewport: (input: { scale: number }) => { width: number; height: number };
  render: (input: Record<string, unknown>) => { promise: Promise<void> };
};

export async function loadPdfJsDocument(bytes: Uint8Array): Promise<PdfJsDocument> {
  const loadingTask = getDocument({ data: bytes.slice() });
  return (await loadingTask.promise) as unknown as PdfJsDocument;
}

const canvasToPngBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Unable to encode PDF page canvas."));
    }, "image/png");
  });
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read PDF page canvas blob."));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export async function renderPdfJsPageToPng(input: {
  document: PdfJsDocument;
  pageIndex0: number;
  cssWidthPx: number;
  rasterScale: number;
}): Promise<{
  pngBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  cssHeightPx: number;
}> {
  const page = await input.document.getPage(input.pageIndex0 + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const viewportScale = input.cssWidthPx / Math.max(1, baseViewport.width);
  const cssViewport = page.getViewport({ scale: viewportScale });
  const renderScale = viewportScale * input.rasterScale;
  const renderViewport = page.getViewport({ scale: renderScale });
  const widthPx = Math.max(1, Math.round(renderViewport.width));
  const heightPx = Math.max(1, Math.round(renderViewport.height));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create PDF page canvas.");

  await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
  return {
    pngBytes: await canvasToPngBytes(canvas),
    widthPx,
    heightPx,
    cssHeightPx: Math.max(1, Math.round(cssViewport.height)),
  };
}
