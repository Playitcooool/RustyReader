import type { AISessionReference, Collection, LibraryItem, ReaderView, ResearchNote, Tag } from "./contracts";

export type ItemSort = "recent" | "title" | "year_desc";
export type AttachmentFilter = "all" | "ready" | "missing" | "citation_only";
export type ReaderFitMode = "fit_width" | "manual";

export const sessionActions = [
  { label: "Summarize", kind: "session.summarize" },
  { label: "Explain Terms", kind: "session.explain_terms" },
  { label: "Compare", kind: "session.compare" },
];

export const taskLabel = (kind: string) =>
  ({
    "item.summarize": "Summarize",
    "item.translate": "Translate",
    "item.explain_term": "Explain",
    "item.ask": "Ask",
    "session.summarize": "Summarize",
    "session.explain_terms": "Explain Terms",
    "session.theme_map": "Theme Map",
    "session.compare": "Compare",
    "session.review_draft": "Review Draft",
    "session.ask": "Ask",
    "collection.bulk_summarize": "Bulk Summaries",
    "collection.theme_map": "Theme Map",
    "collection.compare_methods": "Compare Methods",
    "collection.review_draft": "Review Draft",
    "collection.ask": "Ask",
  })[kind] ?? kind;

export const isQuickActionKind = (kind: string) =>
  kind !== "item.ask" && kind !== "collection.ask" && kind !== "session.ask";

export const attachmentFormatLabel = (format: LibraryItem["attachment_format"] | ReaderView["attachment_format"]) =>
  format.toUpperCase();

export const sanitizeFilename = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const filenameStem = (value: string, fallback: string) => {
  const sanitized = sanitizeFilename(value);
  return sanitized.length > 0 ? sanitized : fallback;
};

export const supportedExtensions = [".pdf", ".docx", ".epub", ".md", ".markdown"];

export const isSupportedPath = (path: string) =>
  supportedExtensions.some((extension) => path.toLowerCase().endsWith(extension));

export const droppedPathsFromFileList = (files: FileList | File[]) =>
  Array.from(files)
    .map((file) => {
      const fileWithPath = file as File & { path?: string; webkitRelativePath?: string };
      return fileWithPath.path || fileWithPath.webkitRelativePath || file.name;
    })
    .filter(isSupportedPath);

export const sortItems = (items: LibraryItem[], itemSort: ItemSort) => {
  const copy = [...items];
  copy.sort((left, right) => {
    if (itemSort === "title") return left.title.localeCompare(right.title);
    if (itemSort === "year_desc") return (right.publication_year ?? 0) - (left.publication_year ?? 0);
    return right.id - left.id;
  });
  return copy;
};

export const filterItemsByAttachment = (items: LibraryItem[], attachmentFilter: AttachmentFilter) => {
  if (attachmentFilter === "all") return items;
  return items.filter((item) => item.attachment_status === attachmentFilter);
};

export const applyTagFilter = (items: LibraryItem[], tags: Tag[], selectedTagId: number | null) => {
  if (selectedTagId === null) return items;
  const selectedTagName = tags.find((tag) => tag.id === selectedTagId)?.name;
  if (!selectedTagName) return items;
  return items.filter((item) => item.tags.includes(selectedTagName));
};

export const matchesSearch = (item: LibraryItem, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return [
    item.title,
    item.authors,
    item.source,
    item.doi ?? "",
    String(item.publication_year ?? ""),
    item.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
};

export const scopeMatches = (left: number[] | null, right: number[]) =>
  left !== null &&
  left.length === right.length &&
  left.every((itemId, index) => itemId === right[index]);

export const noteHeading = (note: ResearchNote) =>
  note.markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"))
    ?.replace(/^#+\s*/, "") ?? note.title;

export const descendantIdsForCollection = (collections: Collection[], collectionId: number) => {
  const descendants = new Set<number>();
  const childrenByParentId = new Map<number, Collection[]>();
  for (const collection of collections) {
    if (collection.parent_id === null) continue;
    childrenByParentId.set(collection.parent_id, [...(childrenByParentId.get(collection.parent_id) ?? []), collection]);
  }
  const stack = [collectionId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined) continue;
    for (const collection of childrenByParentId.get(currentId) ?? []) {
      if (descendants.has(collection.id)) continue;
      descendants.add(collection.id);
      stack.push(collection.id);
    }
  }

  return descendants;
};

export const childCollectionsFor = (collections: Collection[], parentId: number | null) =>
  collections
    .filter((collection) => collection.parent_id === parentId)
    .sort((left, right) => left.name.localeCompare(right.name));

export const expandSessionReferenceItemIds = (
  references: AISessionReference[],
  collections: Collection[],
  items: LibraryItem[],
) => {
  const seen = new Set<number>();
  const output: number[] = [];
  const collectionChildren = (parentId: number): number[] =>
    childCollectionsFor(collections, parentId).flatMap((collection) => [collection.id, ...collectionChildren(collection.id)]);

  for (const reference of references.filter((entry) => entry.kind === "item")) {
    if (seen.has(reference.target_id)) continue;
    if (!items.some((item) => item.id === reference.target_id)) continue;
    seen.add(reference.target_id);
    output.push(reference.target_id);
  }

  for (const reference of references.filter((entry) => entry.kind === "collection")) {
    const collectionIds = [reference.target_id, ...collectionChildren(reference.target_id)];
    for (const collectionId of collectionIds) {
      const orderedItemIds = items
        .filter((item) => item.collection_id === collectionId)
        .sort((left, right) => right.id - left.id)
        .map((item) => item.id);
      for (const itemId of orderedItemIds) {
        if (seen.has(itemId)) continue;
        seen.add(itemId);
        output.push(itemId);
      }
    }
  }

  return output;
};

export const itemCountForCollection = (libraryItems: LibraryItem[], collectionId: number) =>
  libraryItems.filter((item) => item.collection_id === collectionId).length;

export const sessionReferenceLabel = (
  reference: AISessionReference,
  libraryItems: LibraryItem[],
  collections: Collection[],
) =>
  reference.kind === "item"
    ? libraryItems.find((item) => item.id === reference.target_id)?.title ?? "Paper"
    : collections.find((collection) => collection.id === reference.target_id)?.name ?? "Collection";

export const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export const readStoredNumber = (key: string, fallback: number) => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === "true";
};

export const readStoredString = <Value extends string>(key: string, fallback: Value, allowed: readonly Value[]) => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw && allowed.includes(raw as Value) ? (raw as Value) : fallback;
};
