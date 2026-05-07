# Paper Reader Chrome Connector

Chrome MV3 extension for saving PDFs and readable web pages from the current tab into the local Paper Reader desktop app.

## What is implemented here

- MV3 extension with popup flow: configure connector, load collections, scan current tab, import a PDF or current web page.
- Background service worker that owns downloads, Markdown page snapshots, import requests, duplicate handling, and temp file cleanup.
- On-demand page scanning via `chrome.scripting.executeScript`, only when the popup flow needs import detection.
- Right-click `Save to Paper Reader` menu for direct file links, using the last selected collection.
- Mock localhost connector for standalone extension testing against the same route shapes as the desktop connector.

## Repository layout

- [manifest.json](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/manifest.json)
- [extension/background.js](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/extension/background.js)
- [extension/popup/popup.js](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/extension/popup/popup.js)
- [extension/shared/file-detection.js](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/extension/shared/file-detection.js)
- [docs/paper-reader-connector-api.md](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/docs/paper-reader-connector-api.md)
- [scripts/mock-connector.js](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/scripts/mock-connector.js)

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `/Volumes/Samsung/Projects/paper-reader/extensions/chrome`.

## Configure it

1. Start the Paper Reader desktop connector from `/Volumes/Samsung/Projects/paper-reader`, or run the mock server below.
2. Click the extension icon.
3. Enter the connector URL. Default is `http://127.0.0.1:17654`.
4. Paste the Paper Reader connector token.
5. Click `Check Connection`, then `Refresh`.
6. Pick a collection.
7. The popup scans the current tab automatically after collections load. Use `Scan Page` again if the page changed.

## Run the mock connector

```bash
rtk node scripts/mock-connector.js
```

Default token is `paper-reader-dev-token`.

## Test

```bash
rtk npm test
rtk npm run smoke
rtk npm run package
```

From the Paper Reader repo root:

```bash
rtk npm run extension:test
rtk npm run extension:smoke
rtk npm run extension:package
```

## Desktop integration notes

The extension expects the desktop app to expose these routes:

- `GET /v1/health`
- `GET /v1/collections`
- `POST /v1/import-path`
- `POST /v1/import-markdown`

The exact request and response contract is documented in [docs/paper-reader-connector-api.md](/Volumes/Samsung/Projects/paper-reader/extensions/chrome/docs/paper-reader-connector-api.md).

## Current limitations

- Context-menu import uses the last selected collection from the popup; Chrome does not provide a practical inline tree picker for v1.
- File discovery on non-direct links relies on URL/path heuristics, not site-specific parsing.
