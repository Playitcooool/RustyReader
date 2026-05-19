# `crates/` Agent Guide

`crates/` contains Rust workspace crates shared by the Tauri app.

## Layout

- `app-core/`: the main domain and persistence crate.
- `app-core/src/lib.rs`: crate exports.
- `app-core/src/service.rs`: currently the central service module. It owns
  serializable domain structs, SQLite schema setup/migrations, library and item
  operations, import/extraction logic, annotations, evidence chunks, AI settings
  and tasks, notes, connector tokens, and attachment/content helpers.
- `app-core/tests/service_flow.rs`: integration-style service flow tests.

## Working Notes

- Treat `service.rs` as the source of truth for backend behavior exposed through
  Tauri and the connector.
- Keep serialized field names and enum values compatible with
  `src/lib/contracts.ts` and extension API docs.
- Prefer adding focused service tests when changing persistence, import,
  annotations, AI settings/tasks, notes, evidence retrieval, or connector token
  behavior.
- Avoid introducing UI or Tauri dependencies here; this crate should stay usable
  from tests and non-UI callers.

## Common Checks

- `rtk cargo test -p app-core`
- `rtk cargo test --workspace`
