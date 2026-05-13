# Paper Reader

<div align="center">

**Local-first desktop workspace for reading, organizing, annotating, and synthesizing academic papers.**  
**本地优先的桌面论文工作台：阅读、管理、标注、AI 综述，一处完成。**

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC107?style=flat&logo=tauri&logoColor=white)](https://tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-powered-CE422B?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?style=flat&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
![License](https://img.shields.io/badge/License-MIT-2E8B57?style=flat)

[Features](#features) · [Quick Start](#quick-start) · [Browser Extensions](#browser-extensions) · [Architecture](#architecture) · [Development](#development)

</div>

---

## Overview

Paper Reader is a native-feeling research workspace built around a local library, a focused document reader, and an AI copilot. It imports papers and citation records, keeps metadata and notes in a local SQLite-backed library, and helps turn reading into reusable research output.

Paper Reader 是一个面向论文阅读和研究整理的桌面应用。它把资料库、阅读器、标注、AI 问答、研究笔记和浏览器采集整合到同一个本地优先工作流里。

## Features

| Area | What you get | 中文说明 |
| --- | --- | --- |
| Library | Nested collections, tags, metadata editing, search, batch actions | 层级资料库、标签、元数据编辑、搜索和批量操作 |
| Reading | PDF focus mode, continuous PDF reading, zoom, page navigation, find-in-document | PDF 专注阅读、连续阅读、缩放、页码跳转和文内搜索 |
| Annotation | PDF highlights, text boxes, persisted anchors, selection actions | PDF 高亮、文本框标注、稳定锚点和划词操作 |
| AI | Paper, collection, and session-level research tasks | 单篇、集合和 session 级 AI 研究任务 |
| Notes | Save AI outputs and selections as editable Markdown notes | 将 AI 输出和选区保存为可编辑 Markdown 笔记 |
| OCR | Tesseract-powered fallback for PDFs without usable text layers | 对文本层缺失的 PDF 提供 OCR 兜底 |
| Browser Capture | Chrome and Safari connectors for saving PDFs and readable pages | Chrome 与 Safari 插件，一键保存 PDF 和网页 |

## Workflow

1. Import `PDF`, `DOCX`, `EPUB`, or citation records into your local library.
2. Organize papers into nested collections and add tags or metadata.
3. Read in the desktop reader, highlight passages, and save notes.
4. Ask AI questions against a paper, a collection, or a curated session.
5. Capture new PDFs and readable pages directly from Chrome or Safari.

## Quick Start

### Requirements

- `Node.js 18+`
- `npm`
- Rust toolchain
- Tauri v2 prerequisites for your platform
- Full Xcode only if you want to package the Safari extension

### Install

```bash
npm install
```

### Run the Desktop App

```bash
npm run tauri:dev
```

The desktop app starts the local connector used by the browser extensions at:

```text
http://127.0.0.1:17654
```

### Build

```bash
npm run build
npm run tauri:build
```

## Browser Extensions

Paper Reader includes browser connectors for saving papers and readable web pages into the desktop library. Keep the Paper Reader desktop app running while using either extension so the local connector is available.

### What the Extensions Can Import

- Direct `PDF`, `DOCX`, and `EPUB` links
- Currently opened PDF/document tabs
- Readable web pages converted to Markdown snapshots
- Right-click file links via `Save to Paper Reader`

The extension popup loads your Paper Reader collections, lets you choose the destination collection, scans the current tab, and sends the import request to the local desktop connector.

### Chrome Extension

Build and package the Chrome MV3 extension from the repository root:

```bash
npm run extension:package
```

Outputs:

```text
extensions/chrome/dist/paper-reader-connector
extensions/chrome/dist/paper-reader-connector-v0.1.0.zip
```

Load it in Chrome:

1. Start Paper Reader with `npm run tauri:dev` or open the built desktop app.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select `extensions/chrome/dist/paper-reader-connector`.
6. Pin or open the `Paper Reader Connector` extension.
7. Choose a collection and click the import action shown by the popup.

Chrome usage notes:

- The popup scans the active tab after collections load.
- Use `Scan Page` again if the page content changed.
- Right-click a direct document link and choose `Save to Paper Reader` to import it into the last selected collection.
- The connector uses `http://127.0.0.1:17654`; no manual token setup is required for the current desktop app.

### Safari Extension

Safari packaging requires full Xcode, not only Command Line Tools. Make sure Xcode is selected:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Build the Safari Web Extension input directory:

```bash
npm run extension:safari:build
```

Package it as a Safari Web Extension App:

```bash
npm run extension:safari:package
```

Outputs:

```text
extensions/safari/build/extension
extensions/safari/build/PaperReaderSafari
```

Run and enable it in Safari:

1. Start Paper Reader with `npm run tauri:dev` or open the built desktop app.
2. Open `extensions/safari/build/PaperReaderSafari` in Xcode.
3. Build and run the generated app.
4. In Safari, open `Settings` -> `Extensions`.
5. Enable `Paper Reader Connector`.
6. Open the extension popup, choose a collection, and import the current page or document.

Safari usage notes:

- Safari does not expose Chrome's `downloads` API, so file imports are fetched in the extension background and uploaded to `POST /v1/import-file`.
- The Safari manifest includes broad `http` and `https` host permissions so the extension can fetch selected document URLs.
- If the extension cannot connect, confirm the desktop app is running and the connector health endpoint is reachable at `http://127.0.0.1:17654/v1/health`.

### Extension Commands

```bash
npm run extension:test
npm run extension:smoke
npm run extension:package
npm run extension:safari:build
npm run extension:safari:package
```

For implementation details, see [extensions/chrome/README.md](extensions/chrome/README.md), [extensions/safari/README.md](extensions/safari/README.md), and [extensions/chrome/docs/paper-reader-connector-api.md](extensions/chrome/docs/paper-reader-connector-api.md).

## Architecture

```text
Paper Reader
├─ Tauri v2 desktop shell
├─ React + TypeScript frontend
│  ├─ library workspace
│  ├─ PDF and normalized document readers
│  ├─ annotation and search UI
│  └─ AI sessions and notes
├─ Rust backend
│  ├─ app-core domain services
│  ├─ SQLite library storage
│  ├─ PDF rendering and OCR helpers
│  ├─ secure provider settings
│  └─ localhost browser connector
└─ Browser extensions
   ├─ Chrome MV3 connector
   └─ Safari Web Extension App
```

### Stack

- Desktop: `Tauri v2`
- Frontend: `React 18`, `TypeScript`, `Vite`
- Backend: Rust workspace with `crates/app-core`
- Storage: `SQLite` and managed local files
- PDF: `pdf.js` plus native backend helpers
- OCR: `Tesseract`
- Markdown: `react-markdown` and `remark-gfm`
- Tests: `Vitest`, Testing Library, and Rust tests

## Project Layout

```text
src/                    React app, hooks, and UI state
src/components/         Reader, workspace, sidebar, AI, and settings components
src/lib/                Runtime API contracts and browser helpers
src-tauri/              Tauri shell, native commands, connector, app config
crates/app-core/        Library, import, AI, note, search, and storage services
extensions/chrome/      Chrome MV3 Paper Reader Connector
extensions/safari/      Safari Web Extension packaging
docs/                   Supporting project documentation
```

## Development

Run the main checks:

```bash
npm test
npm run build
cargo test
```

Run the full project verification script:

```bash
npm run verify
```

Run browser extension checks:

```bash
npm run extension:test
npm run extension:smoke
```

## Current Status

Paper Reader already supports the core desktop research loop:

- local library management
- multi-format imports and reading
- PDF highlights and annotation tools
- full-text and in-document search
- AI-assisted research sessions
- Markdown research notes
- Chrome and Safari browser capture
- secure provider configuration

The project is actively evolving, with ongoing work around packaging, onboarding, reader polish, and deeper research workflows.

## License

MIT
