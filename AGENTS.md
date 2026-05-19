# Paper Reader Agent Guide

@/Users/weiciruan/.codex/RTK.md

## Big Picture

Paper Reader is a local-first Tauri desktop app for importing, organizing,
reading, annotating, and synthesizing academic papers. The app is split into:

- `src/`: React + TypeScript UI, reader state, PDF/normalized readers, and the
  typed frontend API boundary.
- `src-tauri/`: Tauri shell, command registration, native PDF/OCR helpers,
  menu/config, and the localhost connector used by browser extensions.
- `crates/app-core/`: Rust domain and persistence service for collections,
  imports, annotations, reader views, AI settings/tasks, notes, and connector
  data.
- `extensions/`: Chrome MV3 and Safari Web Extension connectors for sending
  PDFs and readable page snapshots to the desktop connector.
- `docs/`: project specs and planning notes.
- `scripts/`: repository-level build and verification helpers.
- `.github/`: CI and release workflows.

The core dependency flow is:

```text
React UI (`src`)
  -> typed AppApi/contracts (`src/lib`)
  -> Tauri commands (`src-tauri/src`)
  -> app_core::service (`crates/app-core/src/service.rs`)
  -> SQLite/local files and external AI/OCR/PDF helpers

Browser extensions (`extensions/*`)
  -> localhost connector (`src-tauri/src/connector.rs`)
  -> app_core::service
```

## Root-Level Files

- `package.json` owns frontend, Tauri, extension, and aggregate check scripts.
- `Cargo.toml` is the Rust workspace root; `crates/app-core` is the main library
  crate used by the Tauri binary.
- `README.md` is user-facing product and setup documentation.
- `AGENTS.md` files describe stable navigation hints. Keep them concise and
  update them when folder ownership or layout changes.

## Working Rules

- Use `rtk` before shell commands, per the shared RTK instruction.
- Prefer `rg`/`rg --files` for repo discovery.
- Do not scan `node_modules/`, `dist/`, `.git/`, `.worktrees/`, or generated
  Tauri schemas unless the task specifically requires generated output.
- Keep frontend/backend contracts synchronized:
  - Frontend types: `src/lib/contracts.ts`
  - Runtime API wrapper: `src/lib/api.ts`
  - Tauri commands: `src-tauri/src/main.rs` and `src-tauri/src/commands.rs`
  - Domain structs/service methods: `crates/app-core/src/service.rs`
- Add focused tests near touched code when changing behavior.
- Remember to commit when a function or fix is completed.
- Before committing changes to a specific function, run the build. The actual
  npm script is `npm run tauri:build` (the historical note says
  `npm run tarui:build`, which appears to be a typo).

## Verification Shortcuts

- Frontend unit tests: `rtk npm test`
- Frontend build: `rtk npm run build`
- Tauri desktop build: `rtk npm run tauri:build`
- Rust tests: `rtk cargo test --workspace`
- Full repo verification: `rtk npm run verify`
- Chrome extension tests: `rtk npm run extension:test`
- Extension smoke checks: `rtk npm run extension:smoke`

Choose the narrowest check that covers the change, then run the required build
before committing.
