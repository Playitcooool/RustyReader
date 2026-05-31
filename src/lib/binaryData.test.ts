import { describe, expect, it } from "vitest";

import { blobFromBytes } from "./binaryData";

describe("binaryData", () => {
  it("creates typed blobs from byte arrays", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const blob = blobFromBytes(bytes, "application/octet-stream");

    expect(blob.type).toBe("application/octet-stream");
    expect(blob.size).toBe(3);
  });
});
