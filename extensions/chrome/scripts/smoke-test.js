import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const token = process.env.PAPER_READER_CONNECTOR_TOKEN || "paper-reader-dev-token";
const port = Number(process.env.PAPER_READER_CONNECTOR_PORT || 17654);
const baseUrl = `http://127.0.0.1:${port}`;

function startMockConnector() {
  const child = spawn(process.execPath, ["scripts/mock-connector.js"], {
    env: { ...process.env, PAPER_READER_CONNECTOR_PORT: String(port), PAPER_READER_CONNECTOR_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"]
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Mock connector did not start in time."));
    }, 5000);

    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Mock connector listening")) {
        clearTimeout(timeout);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  });
}

async function request(path, { method = "GET", bearer = token, body } = {}) {
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await response.json();
  return { status: response.status, payload };
}

async function main() {
  const mock = await startMockConnector();
  try {
    const health = await request("/v1/health", { bearer: null });
    assert.equal(health.status, 200);
    assert.deepEqual(health.payload, { ok: true });

    const collections = await request("/v1/collections");
    assert.equal(collections.status, 200);
    assert.equal(collections.payload[0].name, "Inbox");

    const importPayload = {
      collection_id: 1,
      path: "/tmp/paper-reader-smoke.pdf",
      source_url: "https://example.com/paper.pdf",
      page_url: "https://example.com/article",
      download_id: 99
    };

    const imported = await request("/v1/import-path", { method: "POST", body: importPayload });
    assert.equal(imported.status, 200);
    assert.equal(imported.payload.results[0].status, "imported");

    const duplicate = await request("/v1/import-path", { method: "POST", body: importPayload });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.payload.results[0].status, "duplicate");

    const badToken = await request("/v1/collections", { bearer: "wrong-token" });
    assert.equal(badToken.status, 401);
    assert.equal(badToken.payload.error, "Unauthorized");

    const relativePath = await request("/v1/import-path", {
      method: "POST",
      body: { ...importPayload, path: "relative.pdf" }
    });
    assert.equal(relativePath.status, 400);
    assert.equal(relativePath.payload.error, "Path must be absolute");

    console.log("Smoke test passed.");
  } finally {
    mock.kill();
  }
}

await main();
