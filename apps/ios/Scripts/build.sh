#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
NODE_BIN="$HOME/agenthub-work/i1-node-26.4.0/bin"
CARGO_BIN="$HOME/.cargo/bin"
XCODEGEN_BIN="$(command -v xcodegen)"
CURRENT_USER="$(/usr/bin/id -un)"
PATH_VALUE="$NODE_BIN:$CARGO_BIN:$(dirname "$XCODEGEN_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"
DERIVED_DATA="$HOME/agenthub-work/i1-ipad-derived"
DESTINATION="generic/platform=iOS Simulator"
SIGNING_ALLOWED="${CODETETHER_IOS_CODE_SIGNING_ALLOWED:-NO}"

case "$SIGNING_ALLOWED" in
  YES|NO) ;;
  *) printf 'CODETETHER_IOS_CODE_SIGNING_ALLOWED must be YES or NO\n' >&2; exit 2 ;;
esac

if [[ "${1:-simulator}" == "device" ]]; then
  DESTINATION="generic/platform=iOS"
elif [[ "${1:-simulator}" != "simulator" ]]; then
  printf 'Usage: %s [simulator|device]\n' "$0" >&2
  exit 2
fi

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" "$NODE_BIN/node" "$APP_DIR/Scripts/generate-local-config.mjs"
/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" /bin/bash "$SCRIPT_DIR/build-rust-xcframework.sh"
/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" "$XCODEGEN_BIN" generate --spec "$APP_DIR/project.yml" --project "$APP_DIR"
/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" /usr/bin/xcodebuild \
  -project "$APP_DIR/CodeTether.xcodeproj" -scheme CodeTether -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" ARCHS=arm64 CODE_SIGNING_ALLOWED="$SIGNING_ALLOWED" build
