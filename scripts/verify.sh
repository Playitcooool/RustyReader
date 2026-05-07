#!/usr/bin/env bash
set -euo pipefail

npm run build
npm test -- --run
npm run extension:test
cargo test --workspace
