# `src/` Agent Guide

`src/` contains the React + TypeScript frontend for the Tauri desktop app.

## Layout

- `main.tsx` and `bootstrap.tsx`: app entry/bootstrap wiring.
- `App.tsx`: top-level workspace orchestration. It composes library, reader,
  AI/session, settings, and panel state.
- `lib/`: typed contracts, runtime API bridge, app-view helpers, DOM helpers,
  and runtime polyfills.
- `hooks/`: stateful feature controllers used by `App.tsx`.
  - `useLibraryState.ts`: collections, library items, imports, tags, metadata.
  - `useReaderState.ts`: active/open papers, reader mode, selections, search,
    annotations, translation popovers.
  - `useAiSessionState.ts`: AI sessions, references, tasks, notes, streaming UI.
  - `useAppApi.ts`: obtains the runtime API implementation.
- `components/app/`: application chrome: sidebar, reader workspace, AI panel,
  settings, dialogs, HUDs, icons, highlight bars.
- `components/readers/`: PDF and normalized document reader implementations,
  PDF text/selection/annotation anchoring, fit calculations, OCR/native text
  layers.
- `styles/`: split CSS by concern; `styles.css` imports/aggregates app styles.
- `test/`: Vitest setup, fake API, and PDF mocks.

## Contracts And Data Flow

- Start contract work in `lib/contracts.ts`. Keep these types aligned with
  serializable Rust structs in `crates/app-core/src/service.rs`.
- `lib/api.ts` is the frontend boundary for Tauri invocation and fallback/test
  API behavior.
- Components should receive behavior through `App.tsx` and hooks instead of
  importing Tauri APIs directly.
- Tests usually sit beside the implementation as `*.test.ts` or `*.test.tsx`.

## Common Checks

- `rtk npm test -- <pattern>` for focused Vitest runs.
- `rtk npm test` for all frontend tests.
- `rtk npm run build` after TypeScript or bundling-sensitive changes.
