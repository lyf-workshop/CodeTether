#!/bin/sh
# Run only in a disposable pinned Linux build container. /source is read-only;
# /receipts is the explicitly scoped Phase 8D output directory, not Owner state.
set -eu
umask 077
test -d /source/.git
test -d /receipts
test -f /.dockerenv
test ! -e /tmp/codetether-phase8d-build
# The upload-pack child does not inherit clone's command-scoped safe.directory.
# This HOME belongs to this disposable container, never the mounted source/Owner.
git config --global --add safe.directory /source
git config --global --add safe.directory /source/.git
git clone --quiet --no-local /source /tmp/codetether-phase8d-build
cd /tmp/codetether-phase8d-build
test -z "$(git status --porcelain --untracked-files=all)"
npm install --global pnpm@11.20.0 >/dev/null
export PNPM_HOME=/usr/local/lib
pnpm install --frozen-lockfile --store-dir /pnpm/store
pnpm --filter @codetether/node... build
pnpm --filter @codetether/adapter-codex test
pnpm --filter @codetether/adapter-claude test
pnpm --filter @codetether/node test
pnpm release:node:linux-x64
node apps/distribution/scripts/export-linux-receipts.mjs /receipts
