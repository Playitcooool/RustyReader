import type { AISessionReference, Collection, LibraryItem } from "./contracts";

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

export const sessionReferenceLabel = (
  reference: AISessionReference,
  libraryItems: LibraryItem[],
  collections: Collection[],
) =>
  reference.kind === "item"
    ? libraryItems.find((item) => item.id === reference.target_id)?.title ?? "Paper"
    : collections.find((collection) => collection.id === reference.target_id)?.name ?? "Collection";
