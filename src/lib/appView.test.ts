import { describe, expect, it } from "vitest";

import type { AISessionReference, Collection, LibraryItem, Tag } from "./contracts";
import {
  applyTagFilter,
  childCollectionsFor,
  descendantIdsForCollection,
  expandSessionReferenceItemIds,
  filenameStem,
  filterItemsByAttachment,
  matchesSearch,
  readStoredBoolean,
  readStoredNumber,
  readStoredString,
  sanitizeFilename,
  sortItems,
} from "./appView";

const item = (overrides: Partial<LibraryItem>): LibraryItem => ({
  id: 1,
  collection_id: 1,
  primary_attachment_id: 101,
  title: "Transformer Scaling Laws",
  authors: "Kaplan et al.",
  publication_year: 2020,
  source: "arXiv",
  doi: "10.1234/example",
  attachment_format: "pdf",
  attachment_status: "ready",
  tags: ["llm", "scaling"],
  display_metadata: "Kaplan et al. · 2020 · arXiv",
  ...overrides,
});

describe("appView item helpers", () => {
  it("sanitizes filenames and falls back for empty stems", () => {
    expect(sanitizeFilename('a <bad> "name".pdf')).toBe("a bad name .pdf");
    expect(filenameStem(":/\u0000", "research-note")).toBe("research-note");
  });

  it("sorts and filters without mutating input arrays", () => {
    const items = [
      item({ id: 1, title: "B", publication_year: 2022, attachment_status: "missing" }),
      item({ id: 3, title: "A", publication_year: 2020, attachment_status: "ready" }),
      item({ id: 2, title: "C", publication_year: 2024, attachment_status: "citation_only" }),
    ];

    expect(sortItems(items, "recent").map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(sortItems(items, "title").map((entry) => entry.title)).toEqual(["A", "B", "C"]);
    expect(sortItems(items, "year_desc").map((entry) => entry.publication_year)).toEqual([2024, 2022, 2020]);
    expect(items.map((entry) => entry.id)).toEqual([1, 3, 2]);
    expect(filterItemsByAttachment(items, "ready").map((entry) => entry.id)).toEqual([3]);
  });

  it("applies tag filters and search queries", () => {
    const tags: Tag[] = [
      { id: 10, name: "llm", item_count: 1 },
      { id: 11, name: "vision", item_count: 1 },
    ];
    const items = [item({ id: 1, tags: ["llm"] }), item({ id: 2, title: "CNN Survey", tags: ["vision"] })];

    expect(applyTagFilter(items, tags, 10).map((entry) => entry.id)).toEqual([1]);
    expect(applyTagFilter(items, tags, 99)).toEqual(items);
    expect(matchesSearch(items[0], "kaplan")).toBe(true);
    expect(matchesSearch(items[1], "10.1234")).toBe(true);
    expect(matchesSearch(items[1], "quantum")).toBe(false);
  });
});

describe("appView collection helpers", () => {
  const collections: Collection[] = [
    { id: 1, parent_id: null, name: "Root B" },
    { id: 2, parent_id: null, name: "Root A" },
    { id: 3, parent_id: 1, name: "Child" },
    { id: 4, parent_id: 3, name: "Grandchild" },
  ];

  it("returns sorted children and recursive descendants", () => {
    expect(childCollectionsFor(collections, null).map((collection) => collection.name)).toEqual(["Root A", "Root B"]);
    expect(Array.from(descendantIdsForCollection(collections, 1)).sort()).toEqual([3, 4]);
  });

  it("expands session references to ordered unique item ids", () => {
    const items = [
      item({ id: 10, collection_id: 1 }),
      item({ id: 11, collection_id: 3 }),
      item({ id: 12, collection_id: 3 }),
      item({ id: 13, collection_id: 4 }),
    ];
    const references: AISessionReference[] = [
      { id: 1, session_id: 1, kind: "item", target_id: 12, sort_index: 0 },
      { id: 2, session_id: 1, kind: "collection", target_id: 1, sort_index: 1 },
    ];

    expect(expandSessionReferenceItemIds(references, collections, items)).toEqual([12, 10, 11, 13]);
  });

});

describe("appView local storage readers", () => {
  it("reads typed values with fallbacks", () => {
    window.localStorage.setItem("number", "42");
    window.localStorage.setItem("bad-number", "nope");
    window.localStorage.setItem("boolean", "false");
    window.localStorage.setItem("string", "title");

    expect(readStoredNumber("number", 1)).toBe(42);
    expect(readStoredNumber("bad-number", 1)).toBe(1);
    expect(readStoredBoolean("boolean", true)).toBe(false);
    expect(readStoredString("string", "recent", ["recent", "title"] as const)).toBe("title");
    expect(readStoredString("missing", "recent", ["recent", "title"] as const)).toBe("recent");
  });
});
