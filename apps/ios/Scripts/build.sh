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
PRODUCT_DIRECTORY="Debug-iphonesimulator"

if [[ "${1:-simulator}" == "device" ]]; then
  DESTINATION="generic/platform=iOS"
  PRODUCT_DIRECTORY="Debug-iphoneos"
  SIGNING_ALLOWED="${CODETETHER_IOS_CODE_SIGNING_ALLOWED:-NO}"
  SIGNING_IDENTITY="${CODETETHER_IOS_CODE_SIGN_IDENTITY:-}"
  DEVELOPMENT_TEAM="${CODETETHER_IOS_DEVELOPMENT_TEAM:-}"
  ALLOW_PROVISIONING_UPDATES="${CODETETHER_IOS_ALLOW_PROVISIONING_UPDATES:-NO}"
elif [[ "${1:-simulator}" == "simulator" ]]; then
  SIGNING_ALLOWED="${CODETETHER_IOS_CODE_SIGNING_ALLOWED:-YES}"
  SIGNING_IDENTITY="${CODETETHER_IOS_CODE_SIGN_IDENTITY:--}"
  DEVELOPMENT_TEAM="${CODETETHER_IOS_DEVELOPMENT_TEAM:-}"
  ALLOW_PROVISIONING_UPDATES="${CODETETHER_IOS_ALLOW_PROVISIONING_UPDATES:-NO}"
else
  printf 'Usage: %s [simulator|device]\n' "$0" >&2
  exit 2
fi

case "$SIGNING_ALLOWED" in
  YES|NO) ;;
  *) printf 'CODETETHER_IOS_CODE_SIGNING_ALLOWED must be YES or NO\n' >&2; exit 2 ;;
esac
case "$ALLOW_PROVISIONING_UPDATES" in
  YES|NO) ;;
  *) printf 'CODETETHER_IOS_ALLOW_PROVISIONING_UPDATES must be YES or NO\n' >&2; exit 2 ;;
esac

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" "$NODE_BIN/node" "$APP_DIR/Scripts/generate-local-config.mjs"
/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" /bin/bash "$SCRIPT_DIR/build-rust-xcframework.sh"
/usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" "$XCODEGEN_BIN" generate --spec "$APP_DIR/project.yml" --project "$APP_DIR"
XCODEBUILD_SETTINGS=(ARCHS=arm64 CODE_SIGNING_ALLOWED="$SIGNING_ALLOWED")
if [[ -n "$SIGNING_IDENTITY" ]]; then
  XCODEBUILD_SETTINGS+=(CODE_SIGN_IDENTITY="$SIGNING_IDENTITY")
fi
if [[ -n "$DEVELOPMENT_TEAM" ]]; then
  XCODEBUILD_SETTINGS+=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
fi
XCODEBUILD_OPTIONS=()
if [[ "$ALLOW_PROVISIONING_UPDATES" == YES ]]; then
  XCODEBUILD_OPTIONS+=(-allowProvisioningUpdates)
fi

XCODEBUILD_COMMAND=(
  /usr/bin/env -i HOME="$HOME" USER="$CURRENT_USER" LOGNAME="$CURRENT_USER" PATH="$PATH_VALUE" /usr/bin/xcodebuild
  -project "$APP_DIR/CodeTether.xcodeproj" -scheme CodeTether -destination "$DESTINATION"
  -derivedDataPath "$DERIVED_DATA" "${XCODEBUILD_SETTINGS[@]}"
)
if [[ "$ALLOW_PROVISIONING_UPDATES" == YES ]]; then
  XCODEBUILD_COMMAND+=(-allowProvisioningUpdates)
fi
XCODEBUILD_COMMAND+=(build)
"${XCODEBUILD_COMMAND[@]}"

APP_BUNDLE="$DERIVED_DATA/Build/Products/$PRODUCT_DIRECTORY/CodeTether.app"
/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" "$NODE_BIN/node" \
  "$SCRIPT_DIR/verify-build-config.mjs" "$APP_BUNDLE"
