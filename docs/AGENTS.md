# `docs/` Agent Guide

`docs/` contains supporting project documentation rather than shipped app code.

## Layout

- `superpowers/specs/`: design/specification documents.
- `superpowers/plans/`: implementation plans and project notes.

## Working Notes

- Prefer linking to real code paths when documenting implemented behavior.
- Keep docs clear about whether content is a plan, design target, or current
  implementation.
- Do not update specs/plans as a substitute for updating `README.md` or
  folder-level `AGENTS.md` when user-facing setup or navigation changes.

## Common Checks

Docs-only changes usually do not need automated tests unless the task also
modifies code.
