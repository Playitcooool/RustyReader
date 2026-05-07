import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyUrl,
  dedupeCandidates,
  detectFileType,
  deriveFilename,
  sanitizeFilename
} from "../extension/shared/file-detection.js";

test("detectFileType prefers file extension in URL", () => {
  assert.deepEqual(detectFileType({ url: "https://example.com/paper.pdf" }), {
    extension: "pdf",
    label: "PDF"
  });
});

test("deriveFilename uses content disposition when present", () => {
  assert.equal(
    deriveFilename("https://example.com/download", 'attachment; filename="great-paper.docx"'),
    "great-paper.docx"
  );
});

test("sanitizeFilename strips path separators and reserved characters", () => {
  assert.equal(sanitizeFilename("a/b:c*paper?.pdf"), "a-b-c-paper-.pdf");
});

test("classifyUrl falls back to HEAD headers", async () => {
  const candidate = await classifyUrl(
    "https://example.com/download?id=1",
    async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/epub+zip"
        }
      })
  );

  assert.equal(candidate.fileType, "epub");
  assert.equal(candidate.fileLabel, "EPUB");
});

test("dedupeCandidates removes duplicate URLs", () => {
  const deduped = dedupeCandidates([
    { url: "https://example.com/a.pdf" },
    { url: "https://example.com/a.pdf" },
    { url: "https://example.com/b.pdf" }
  ]);
  assert.equal(deduped.length, 2);
});
