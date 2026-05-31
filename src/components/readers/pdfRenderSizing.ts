export const PDF_RENDER_WIDTH_BUCKET_PX = 64;

export const bucketPdfRenderWidth = (widthPx: number) =>
  Math.max(1, Math.ceil(widthPx / PDF_RENDER_WIDTH_BUCKET_PX) * PDF_RENDER_WIDTH_BUCKET_PX);
