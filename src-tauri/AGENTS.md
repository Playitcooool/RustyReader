# `src-tauri/` Agent Guide

`src-tauri/` is the Tauri v2 desktop shell and native integration layer.

## Layout

- `src/main.rs`: Tauri builder setup, command registration, collection commands,
  reader bytes/view commands, and streamed AI task command entry points.
- `src/commands.rs`: additional command handlers for annotations, items, tags,
  imports, notes, AI settings, connector settings, translation, and evidence.
- `src/state.rs`: application state construction, root directory resolution,
  shared `LibraryService`, and connector status.
- `src/connector.rs`: localhost HTTP connector used by Chrome/Safari extensions.
  Keep route shapes aligned with extension docs/tests.
- `src/ai_stream.rs`: AI task event chunking and emission helpers.
- `src/pdf_engine.rs`: native PDF rendering/text helpers and cache.
- `src/ocr.rs`: OCR helpers and Tesseract integration.
- `src/export.rs`: export-related native helpers.
- `src/menu.rs`: native menu construction.
- `tauri.conf.json`: app metadata, security/CSP, bundle config.
- `capabilities/`: Tauri permission capability files.
- `resources/tessdata/`: bundled OCR language data.
- `icons/`: generated platform icons. Avoid editing individual generated icon
  sizes unless the task is explicitly about icons.
- `gen/schemas/`: generated Tauri schema files. Do not hand-edit.

## Contracts And Data Flow

- Tauri commands should remain thin adapters: deserialize input, call
  `app_core::service`, map errors to strings, and return serializable structs.
- Add or change command payloads together with:
  - frontend `src/lib/contracts.ts`
  - frontend `src/lib/api.ts`
  - service methods/types in `crates/app-core/src/service.rs`
  - extension docs/tests if the connector route shape changes
- Long-running work should use Tauri async/blocking patterns already present in
  `main.rs`; avoid blocking the UI thread in command handlers.

## Common Checks

- `rtk cargo test --workspace` for Rust tests.
- `rtk npm run tauri:build` for the desktop build before committing functional
  changes.
