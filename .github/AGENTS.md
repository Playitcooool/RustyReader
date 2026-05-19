# `.github/` Agent Guide

`.github/` contains GitHub automation for CI and releases.

## Layout

- `workflows/ci.yml`: continuous integration checks.
- `workflows/release.yml`: release packaging/publishing automation.

## Working Notes

- Keep CI commands aligned with local scripts in `package.json` and
  `scripts/verify.sh`.
- When changing build outputs, extension packaging, or Tauri bundle settings,
  check whether release workflow paths or artifact names need updates.
- Prefer reusing npm/cargo scripts over duplicating long command sequences in
  workflow YAML.

## Common Checks

Workflow-only changes cannot be fully verified locally, but run the underlying
commands that the workflow invokes when practical.
