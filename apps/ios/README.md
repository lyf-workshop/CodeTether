# CodeTether iPad app

The first iPad release is a SwiftUI app that reuses `packages/supervisor-mobile` for direct and Relay transport. Rust and UniFFI artifacts are generated locally and are not committed.

Requirements: Xcode 27, Rust 1.98.1 with `aarch64-apple-ios` and `aarch64-apple-ios-sim`, XcodeGen, and the official Node 26.4.0 ARM64 archive whose SHA256 is recorded in the Mac acceptance report.

Set up the official Node archive under `~/agenthub-work/i1-node-26.4.0`, provide the three required VITE values in `~/agenthub-work/v4-build.env`, and build the iPad simulator app with:

```sh
bash apps/ios/Scripts/build.sh simulator
```

Use `bash apps/ios/Scripts/build.sh device` for a generic iOS device build. The target family is iPad-only and deployment starts at iOS 16.0; confirm the connected iPad OS before signing or installing. The build uses the active Rust stable toolchain in `~/.rustup` and Cargo cache in `~/.cargo`; all build subprocesses receive an allowlisted environment.
