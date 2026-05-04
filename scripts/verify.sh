#!/usr/bin/env bash
set -euo pipefail

npm run build
npm test -- --run
cargo test --workspace
