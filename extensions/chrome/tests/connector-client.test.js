import test from "node:test";
import assert from "node:assert/strict";

import { importMarkdown, importPath } from "../extension/shared/connector-client.js";

test("importPath calls import-path endpoint", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ imported: [], duplicates: [], failed: [], results: [] }), { status: 200 });
  };

  await importPath("http://127.0.0.1:17654", "token", { collection_id: 1, path: "/tmp/a.pdf" });

  assert.equal(calls[0].url, "http://127.0.0.1:17654/v1/import-path");
  assert.equal(calls[0].options.method, "POST");
});

test("importMarkdown calls import-markdown endpoint", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ imported: [], duplicates: [], failed: [], results: [] }), { status: 200 });
  };

  await importMarkdown("http://127.0.0.1:17654", "token", {
    collection_id: 1,
    title: "Page",
    markdown: "# Page",
    source_url: "https://example.com",
    page_url: "https://example.com"
  });

  assert.equal(calls[0].url, "http://127.0.0.1:17654/v1/import-markdown");
  assert.equal(JSON.parse(calls[0].options.body).markdown, "# Page");
});
