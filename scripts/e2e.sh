#!/usr/bin/env bash
# Build the app and run browser tests against a fresh local database.
set -euo pipefail
scripts/local-db.sh billy_e2e
npx next build
npx playwright test "$@"
