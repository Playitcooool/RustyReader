PDFium dynamic libraries are bundled under target-specific folders:

- `macos-arm64/libpdfium.dylib`
- `macos-x64/libpdfium.dylib`
- `windows-x64/pdfium.dll`
- `linux-x64/libpdfium.so`

The native PDF engine first looks in this resource tree, then falls back to a
development system PDFium install for diagnostics.
