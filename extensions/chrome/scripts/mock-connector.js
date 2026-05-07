import http from "node:http";

const PORT = Number(process.env.PAPER_READER_CONNECTOR_PORT || 17654);
const TOKEN = process.env.PAPER_READER_CONNECTOR_TOKEN || "paper-reader-dev-token";

const collections = [
  { id: 1, name: "Inbox", parent_id: null },
  { id: 2, name: "ML Systems", parent_id: null },
  { id: 3, name: "Scaling Laws", parent_id: 2 }
];

const importedPaths = new Set();
const importedMarkdown = new Set();
const importedFiles = new Set();

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function unauthorized(response) {
  json(response, 401, { error: "Unauthorized" });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/v1/health" && request.method === "GET") {
    return json(response, 200, {
      ok: true,
      app_name: "Paper Reader",
      connector_version: 1,
      supported_file_types: ["pdf", "docx", "epub"],
      capabilities: ["collections", "import_path", "import_file", "import_markdown"]
    });
  }

  const auth = request.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) return unauthorized(response);

  if (request.url === "/v1/collections" && request.method === "GET") {
    return json(response, 200, collections);
  }

  if (request.url === "/v1/import-path" && request.method === "POST") {
    const body = await readBody(request);
    const collection = collections.find((entry) => entry.id === body.collection_id);
    if (!collection) {
      return json(response, 400, {
        error: "Collection does not exist"
      });
    }

    if (!body.path || !body.path.startsWith("/")) {
      return json(response, 400, { error: "Path must be absolute" });
    }

    if (importedPaths.has(body.path)) {
      return json(response, 200, {
        imported: [],
        duplicates: [{ path: body.path, status: "duplicate", message: "Already imported", item: null }],
        failed: [],
        results: [{ path: body.path, status: "duplicate", message: "Already imported", item: null }]
      });
    }

    importedPaths.add(body.path);
    return json(response, 200, {
      imported: [{ id: Date.now(), title: body.source_url, primary_attachment_id: Date.now() + 1 }],
      duplicates: [],
      failed: [],
      results: [{ path: body.path, status: "imported", message: "Imported", item: null }]
    });
  }

  if (request.url === "/v1/import-markdown" && request.method === "POST") {
    const body = await readBody(request);
    const collection = collections.find((entry) => entry.id === body.collection_id);
    if (!collection) {
      return json(response, 400, { error: "Collection does not exist" });
    }
    if (!body.title || !body.title.trim()) {
      return json(response, 400, { error: "Title must not be empty" });
    }
    if (!body.markdown || !body.markdown.trim()) {
      return json(response, 400, { error: "Markdown must not be empty" });
    }
    const path = body.source_url || body.title;
    const fingerprint = body.markdown;
    if (importedMarkdown.has(fingerprint)) {
      return json(response, 200, {
        imported: [],
        duplicates: [{ path, status: "duplicate", message: "Already imported", item: null }],
        failed: [],
        results: [{ path, status: "duplicate", message: "Already imported", item: null }]
      });
    }

    importedMarkdown.add(fingerprint);
    return json(response, 200, {
      imported: [{ id: Date.now(), title: body.title, primary_attachment_id: Date.now() + 1 }],
      duplicates: [],
      failed: [],
      results: [{ path, status: "imported", message: "Imported", item: null }]
    });
  }

  if (request.url === "/v1/import-file" && request.method === "POST") {
    const body = await readBody(request);
    const collection = collections.find((entry) => entry.id === body.collection_id);
    if (!collection) {
      return json(response, 400, { error: "Collection does not exist" });
    }
    if (!body.filename || !/\.(pdf|docx|epub)$/i.test(body.filename)) {
      return json(response, 400, { error: "Unsupported attachment format" });
    }
    if (!body.content_base64 || Buffer.from(body.content_base64, "base64").length === 0) {
      return json(response, 400, { error: "Content must not be empty" });
    }
    const path = body.source_url || body.filename;
    if (importedFiles.has(body.content_base64)) {
      return json(response, 200, {
        imported: [],
        duplicates: [{ path, status: "duplicate", message: "Already imported", item: null }],
        failed: [],
        results: [{ path, status: "duplicate", message: "Already imported", item: null }]
      });
    }

    importedFiles.add(body.content_base64);
    return json(response, 200, {
      imported: [{ id: Date.now(), title: body.filename, primary_attachment_id: Date.now() + 1 }],
      duplicates: [],
      failed: [],
      results: [{ path, status: "imported", message: "Imported", item: null }]
    });
  }

  return json(response, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock connector listening on http://127.0.0.1:${PORT}`);
  console.log(`Token: ${TOKEN}`);
});
