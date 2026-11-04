#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
NODE_BIN="$HOME/agenthub-work/i1-node-26.4.0/bin"
CARGO_HOME_DIR="$HOME/.cargo"
RUSTUP_HOME_DIR="$HOME/.rustup"
TARGET_DIR="$HOME/agenthub-work/i1-ipad-target"
DERIVED_DATA="$HOME/agenthub-work/i1-ipad-derived"
PNPM_BIN="$(command -v pnpm)"
XCODEGEN_BIN="$(command -v xcodegen)"
CURRENT_USER="$(/usr/bin/id -un)"
SIMULATOR_ID="${1:?Usage: test.sh <iPad simulator UDID>}"
FIXTURE_CONFIG="$APP_DIR/Tests/Support/InteropFixture.json"
PATH_VALUE="$NODE_BIN:$CARGO_HOME_DIR/bin:$(dirname "$PNPM_BIN"):$(dirname "$XCODEGEN_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -e "$FIXTURE_CONFIG" ]]; then
  printf 'An iOS interop fixture config already exists; inspect it before retrying.\n' >&2
  exit 2
fi

FIXTURE_PID=""
cleanup() {
  if [[ -n "$FIXTURE_PID" ]]; then
    kill -TERM "$FIXTURE_PID" 2>/dev/null || true
    wait "$FIXTURE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" "$PNPM_BIN" \
  --filter "@codetether/supervisor-transport..." \
  --filter "@codetether/relay..." \
  --filter "@codetether/control-plane..." build

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" RUSTUP_HOME="$RUSTUP_HOME_DIR" CARGO_HOME="$CARGO_HOME_DIR" CARGO_TARGET_DIR="$TARGET_DIR" \
  "$CARGO_HOME_DIR/bin/cargo" +stable test --manifest-path "$REPO_ROOT/packages/supervisor-mobile/Cargo.toml" --locked

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" "$NODE_BIN/node" "$SCRIPT_DIR/start-interop-fixture.mjs" &
FIXTURE_PID=$!

for _ in $(seq 1 100); do
  [[ -s "$FIXTURE_CONFIG" ]] && break
  kill -0 "$FIXTURE_PID" 2>/dev/null || { printf 'The local interoperability fixture failed to start.\n' >&2; exit 1; }
  sleep 0.1
done
[[ -s "$FIXTURE_CONFIG" ]] || { printf 'The local interoperability fixture did not become ready.\n' >&2; exit 1; }

/bin/bash "$SCRIPT_DIR/build.sh" simulator

/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" "$XCODEGEN_BIN" generate --spec "$APP_DIR/project.yml" --project "$APP_DIR"
/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" CODETETHER_REPO_ROOT="$REPO_ROOT" \
  /usr/bin/xcodebuild -project "$APP_DIR/CodeTether.xcodeproj" -scheme CodeTether \
  -destination "id=$SIMULATOR_ID" -derivedDataPath "$DERIVED_DATA" ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build-for-testing

TEST_BUNDLE="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/CodeTether.app/PlugIns/CodeTetherTests.xctest"
[[ -d "$TEST_BUNDLE" ]] || { printf 'The iOS unit-test bundle was not built.\n' >&2; exit 1; }
cp "$FIXTURE_CONFIG" "$TEST_BUNDLE/InteropFixture.json"
chmod 600 "$TEST_BUNDLE/InteropFixture.json"

/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" CODETETHER_REPO_ROOT="$REPO_ROOT" \
  /usr/bin/xcodebuild -project "$APP_DIR/CodeTether.xcodeproj" -scheme CodeTether \
  -destination "id=$SIMULATOR_ID" -derivedDataPath "$DERIVED_DATA" ARCHS=arm64 CODE_SIGNING_ALLOWED=NO test-without-building
