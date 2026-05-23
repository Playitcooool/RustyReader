# RustyReader Connector API Contract

This directory implements the Chrome side of the browser connector. The desktop app exposes the following localhost-only HTTP API on `127.0.0.1:17654`.

## Security

- Bind only to `127.0.0.1`.
- `GET /v1/health` is public.
- All other routes require `Authorization: Bearer <token>`.
- Regenerating the token invalidates the previous token immediately.

## Endpoints

### `GET /v1/health`

```json
{
  "ok": true
}
```

### `GET /v1/collections`

Returns the existing `Collection[]` shape from `paper-reader`:

```json
[
  { "id": 1, "name": "Inbox", "parent_id": null },
  { "id": 2, "name": "ML Systems", "parent_id": null }
]
```

### `POST /v1/import-path`

Request:

```json
{
  "collection_id": 123,
  "path": "/absolute/path/to/downloaded.pdf",
  "source_url": "https://example.com/paper.pdf",
  "page_url": "https://example.com/article",
  "download_id": 456
}
```

Response uses the existing `ImportBatchResult` contract already present in `paper-reader`.

### `POST /v1/import-markdown`

Request:

```json
{
  "collection_id": 123,
  "title": "Page title",
  "markdown": "# Page title\n\nReadable page snapshot.",
  "source_url": "https://example.com/article",
  "page_url": "https://example.com/article"
}
```

Response uses the existing `ImportBatchResult` contract. `results[].path` is the `source_url` when present.

## Desktop-side validation needed

- Reject unknown `collection_id` before writing database rows.
- Reject non-absolute `path` values.
- Reject empty Markdown titles or bodies.
- Preserve existing duplicate semantics from `import_files(collection_id, paths, ManagedCopy)`.
- On success or duplicate, the extension will delete the downloaded temp file and remove the Chrome download history entry.
- On import failure, the extension intentionally leaves the temp file in place for inspection.
