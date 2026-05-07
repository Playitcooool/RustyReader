import test from "node:test";
import assert from "node:assert/strict";

import { discoverConnectorUrl, importFile, importMarkdown, importPath } from "../extension/shared/connector-client.js";

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

test("importFile calls import-file endpoint with uploaded bytes", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ imported: [], duplicates: [], failed: [], results: [] }), { status: 200 });
  };

  await importFile("http://127.0.0.1:17654", "token", {
    collection_id: 1,
    filename: "paper.pdf",
    content_base64: "JVBERi0=",
    source_url: "https://example.com/paper.pdf",
    page_url: "https://example.com"
  });

  assert.equal(calls[0].url, "http://127.0.0.1:17654/v1/import-file");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.filename, "paper.pdf");
  assert.equal(body.content_base64, "JVBERi0=");
});

test("discoverConnectorUrl falls back to localhost candidate", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.startsWith("http://127.0.0.1")) {
      throw new TypeError("unreachable");
    }
    return new Response(JSON.stringify({ ok: true, app_name: "Paper Reader", connector_version: 1 }), { status: 200 });
  };

  const result = await discoverConnectorUrl("http://127.0.0.1:17654");

  assert.equal(result.connectorUrl, "http://localhost:17654");
  assert.deepEqual(calls, [
    "http://127.0.0.1:17654/v1/health",
    "http://localhost:17654/v1/health"
  ]);
});

test("unsupported file errors use an actionable message", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "unsupported attachment format" }), { status: 400 });

  await assert.rejects(
    () => importFile("http://127.0.0.1:17654", "token", {
      collection_id: 1,
      filename: "paper.txt",
      content_base64: "aGVsbG8="
    }),
    /does not support this file type/
  );
});
