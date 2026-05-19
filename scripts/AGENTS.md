# `scripts/` Agent Guide

`scripts/` contains repository-level automation invoked from `package.json`.

## Layout

- `verify.sh`: aggregate local verification script. Runs frontend build/tests,
  Chrome extension tests, and Rust workspace tests.
- `build-browser-extensions.js`: helper for browser extension build workflows.

## Working Notes

- Keep script entry points aligned with `package.json`.
- Prefer portable shell/Node patterns; these scripts are developer workflow
  tools, not application runtime code.
- If a script changes command coverage, update this file and the relevant
  `README.md`/root guidance.

## Common Checks

- `rtk npm run verify` after changing verification logic.
- Run the specific script command from `package.json` after editing a helper.
