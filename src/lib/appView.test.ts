import { describe, expect, it } from "vitest";

import { childCollectionsFor } from "./collectionView";
import type { Collection } from "./contracts";
import { filenameStem, sanitizeFilename } from "./filePaths";
import { readStoredBoolean, readStoredNumber, readStoredString } from "./storagePrefs";

describe("appView file helpers", () => {
  it("sanitizes filenames and falls back for empty stems", () => {
    expect(sanitizeFilename('a <bad> "name".pdf')).toBe("a bad name .pdf");
    expect(filenameStem(":/\u0000", "research-note")).toBe("research-note");
  });
});

describe("appView collection helpers", () => {
  const collections: Collection[] = [
    { id: 1, parent_id: null, name: "Root B", item_count: 0 },
    { id: 2, parent_id: null, name: "Root A", item_count: 0 },
    { id: 3, parent_id: 1, name: "Child", item_count: 0 },
    { id: 4, parent_id: 3, name: "Grandchild", item_count: 0 },
  ];

  it("returns sorted children", () => {
    expect(childCollectionsFor(collections, null).map((collection) => collection.name)).toEqual(["Root A", "Root B"]);
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
