#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
RUSTUP_HOME_DIR="$HOME/.rustup"
CARGO_HOME_DIR="$HOME/.cargo"
TARGET_DIR="$HOME/agenthub-work/i1-ipad-target"
NODE_BIN="$HOME/agenthub-work/i1-node-26.4.0/bin"
GEN_DIR="$APP_DIR/Generated"
FRAMEWORK_DIR="$APP_DIR/Frameworks/SupervisorMobile.xcframework"
IOS_HEADERS="$GEN_DIR/XCFrameworkHeaders/ios-arm64"
SIM_HEADERS="$GEN_DIR/XCFrameworkHeaders/ios-arm64-simulator"
IOS_SDK="$(/usr/bin/xcrun --sdk iphoneos --show-sdk-path)"
SIM_SDK="$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-path)"
IOS_CC="$(/usr/bin/xcrun --sdk iphoneos --find clang)"
SIM_CC="$(/usr/bin/xcrun --sdk iphonesimulator --find clang)"
IOS_AR="$(/usr/bin/xcrun --sdk iphoneos --find ar)"
SIM_AR="$(/usr/bin/xcrun --sdk iphonesimulator --find ar)"
XCODEGEN_BIN="$(command -v xcodegen)"
PATH_VALUE="$NODE_BIN:$CARGO_HOME_DIR/bin:$(dirname "$XCODEGEN_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$GEN_DIR/Bindings" "$APP_DIR/Frameworks" "$CARGO_HOME_DIR" "$TARGET_DIR"
/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" RUSTUP_HOME="$RUSTUP_HOME_DIR" CARGO_HOME="$CARGO_HOME_DIR" CARGO_TARGET_DIR="$TARGET_DIR" \
  CC_aarch64_apple_ios="$IOS_CC" AR_aarch64_apple_ios="$IOS_AR" CFLAGS_aarch64_apple_ios="-isysroot $IOS_SDK -miphoneos-version-min=16.0" \
  CC_aarch64_apple_ios_sim="$SIM_CC" AR_aarch64_apple_ios_sim="$SIM_AR" CFLAGS_aarch64_apple_ios_sim="-isysroot $SIM_SDK -mios-simulator-version-min=16.0" \
  "$CARGO_HOME_DIR/bin/cargo" +stable build --locked --release --target aarch64-apple-ios --manifest-path "$REPO_ROOT/packages/supervisor-mobile/Cargo.toml"

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" RUSTUP_HOME="$RUSTUP_HOME_DIR" CARGO_HOME="$CARGO_HOME_DIR" CARGO_TARGET_DIR="$TARGET_DIR" \
  CC_aarch64_apple_ios_sim="$SIM_CC" AR_aarch64_apple_ios_sim="$SIM_AR" CFLAGS_aarch64_apple_ios_sim="-isysroot $SIM_SDK -mios-simulator-version-min=16.0" \
  "$CARGO_HOME_DIR/bin/cargo" +stable build --locked --release --target aarch64-apple-ios-sim --manifest-path "$REPO_ROOT/packages/supervisor-mobile/Cargo.toml"

/usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" RUSTUP_HOME="$RUSTUP_HOME_DIR" CARGO_HOME="$CARGO_HOME_DIR" CARGO_TARGET_DIR="$TARGET_DIR" \
  "$CARGO_HOME_DIR/bin/cargo" +stable build --locked --release --features bindgen --bin uniffi-bindgen --lib --manifest-path "$REPO_ROOT/packages/supervisor-mobile/Cargo.toml"

UNIFFI_LIBRARY="$TARGET_DIR/release/libsupervisor_mobile.dylib"
if [[ ! -f "$UNIFFI_LIBRARY" ]]; then
  UNIFFI_LIBRARY="$TARGET_DIR/release/libsupervisor_mobile.a"
fi
(
  cd "$REPO_ROOT/packages/supervisor-mobile"
  /usr/bin/env -i HOME="$HOME" PATH="$PATH_VALUE" RUSTUP_HOME="$RUSTUP_HOME_DIR" CARGO_HOME="$CARGO_HOME_DIR" CARGO_TARGET_DIR="$TARGET_DIR" CARGO_NET_OFFLINE=true \
    "$CARGO_HOME_DIR/bin/cargo" +stable run --locked --release --features bindgen --bin uniffi-bindgen \
    -- generate --library --crate supervisor_mobile --metadata-no-deps "$UNIFFI_LIBRARY" --language swift --out-dir "$GEN_DIR/Bindings"
)

rm -rf "$FRAMEWORK_DIR"
rm -rf "$GEN_DIR/XCFrameworkHeaders"
mkdir -p "$IOS_HEADERS" "$SIM_HEADERS"
for headers_dir in "$IOS_HEADERS" "$SIM_HEADERS"; do
  cp "$GEN_DIR/Bindings/supervisor_mobileFFI.h" "$headers_dir/"
  cp "$GEN_DIR/Bindings/supervisor_mobileFFI.modulemap" "$headers_dir/module.modulemap"
done
/usr/bin/xcodebuild -create-xcframework \
  -library "$TARGET_DIR/aarch64-apple-ios/release/libsupervisor_mobile.a" -headers "$IOS_HEADERS" \
  -library "$TARGET_DIR/aarch64-apple-ios-sim/release/libsupervisor_mobile.a" -headers "$SIM_HEADERS" \
  -output "$FRAMEWORK_DIR"
