# Icon Assets

Paper Reader keeps editable SVG source icons alongside the platform-specific PNG/ICNS/ICO outputs.

## Source SVGs

- `src-tauri/icons/paper-reader.svg`: desktop app source icon.
- `extensions/chrome/extension/assets/paper-reader-connector.svg`: Chrome connector source icon.
- `extensions/safari/extension/assets/paper-reader-connector.svg`: Safari connector source icon.

The browser extension manifests currently keep using the checked-in PNG icons for compatibility. Export updated PNG sizes from these SVG files before switching the manifest icon paths.
