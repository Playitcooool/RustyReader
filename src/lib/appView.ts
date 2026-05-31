import type { LibraryItem, ReaderView } from "./contracts";

export type ItemSort = "recent" | "title" | "year_desc";
export type AttachmentFilter = "all" | "ready" | "missing" | "citation_only";
export type ReaderFitMode = "fit_width" | "manual";

export const attachmentFormatLabel = (format: LibraryItem["attachment_format"] | ReaderView["attachment_format"]) =>
  format.toUpperCase();
