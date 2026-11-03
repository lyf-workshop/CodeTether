# CodeTether Android

The single Android application targets tablets first and uses the same application ID on compact Android screens.

Use JDK 17 or newer, Android SDK Platform 36, NDK `27.2.12479018`, the Rust targets `aarch64-linux-android` and `x86_64-linux-android`, and `cargo-ndk`. Point `ANDROID_HOME` at the SDK and add Cargo to `PATH`. Run these commands from this directory.

```sh
./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

On Windows use `gradlew.bat`. Gradle generates the Kotlin UniFFI bindings from the Rust library in `packages/supervisor-mobile` and packages its two Android libraries. The debug APK is at `app/build/outputs/apk/debug/app-debug.apk`. Run instrumentation on the selected emulator or device using its explicit serial with `adb -s`.

Supply the account service settings at build time using `VITE_CODETETHER_CONTROL_PLANE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. The app requires HTTPS account origins. To enforce the same relay configuration as the desktop, provide `CODETETHER_SUPERVISOR_RELAY_ENDPOINT`, `CODETETHER_SUPERVISOR_RELAY_ID`, and `CODETETHER_SUPERVISOR_RELAY_FINGERPRINT` together. The Rust client verifies the relay pin in the signed connection descriptor.

An unconfigured build can run local UI and Keystore tests. Use an existing account and complete the email and computer pairing prompts on the devices during end-to-end verification.
