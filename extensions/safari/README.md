# Paper Reader Safari Extension

This directory packages the Paper Reader browser extension as a standalone Safari Web Extension App.

Safari does not use Chrome's `downloads` API. File imports fetch the selected PDF, DOCX, or EPUB in the extension background and upload the bytes to the local Paper Reader connector at `POST /v1/import-file`.

## Commands

- `npm run extension:safari:build` copies the shared Chrome extension runtime into `extensions/safari/build/extension` and applies the Safari manifest.
- `npm run extension:safari:zip` writes a temporary-extension zip that can be selected from Safari's Developer settings for local testing.
- `npm run extension:safari:package` runs Apple's `safari-web-extension-packager` and writes the generated Xcode project under `extensions/safari/build/PaperReaderSafari`.
- `npm run extension:build` from the repo root builds both Chrome outputs and the Safari project in one command.

Outputs:

- `extensions/safari/build/extension` is the Safari Web Extension input directory.
- `extensions/safari/dist/paper-reader-safari-temporary-extension.zip` is a local testing archive for Safari's `Add Temporary Extension...` flow.
- `extensions/safari/build/PaperReaderSafari` is the generated Safari Extension App Xcode project to run and enable in Safari settings.

Packaging requires full Xcode to be installed and selected with `xcode-select`. Command Line Tools alone do not include `xcrun safari-web-extension-packager`.

## Local temporary install

For the quickest local Safari test:

```bash
npm run extension:safari:zip
```

Then open Safari, choose `Safari` -> `Settings` -> `Developer` -> `Add Temporary Extension...`, and select `extensions/safari/dist/paper-reader-safari-temporary-extension.zip`.

Safari removes temporary extensions after 24 hours or when Safari quits. For persistent installs or distribution, use the generated Safari Web Extension App instead.
