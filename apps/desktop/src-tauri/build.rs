use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let product_path = manifest_dir.join("../../../package.json");
    println!("cargo:rerun-if-changed={}", product_path.display());
    let product: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(product_path).expect("authoritative product version"),
    )
    .expect("product manifest");
    assert_eq!(
        product["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "Cargo package version must mirror the authoritative root product version"
    );
    let build_id_path = manifest_dir.join("binaries").join("build-id.txt");
    println!("cargo:rerun-if-changed={}", build_id_path.display());

    let build_id = fs::read_to_string(&build_id_path)
        .map(|value| value.trim().to_owned())
        .unwrap_or_else(|_| "development-unbundled".to_owned());
    assert!(!build_id.is_empty(), "Desktop build ID must not be empty");
    println!("cargo:rustc-env=CODETETHER_BUILD_ID={build_id}");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let swift_source = manifest_dir.join("src/macos_secure_enclave_bridge.swift");
        println!("cargo:rerun-if-changed={}", swift_source.display());
        let target = env::var("TARGET").expect("Rust target triple");
        let swift_arch = match target.as_str() {
            "aarch64-apple-darwin" => "aarch64",
            "x86_64-apple-darwin" => "x86_64",
            _ => panic!("unsupported macOS target for CryptoKit bridge: {target}"),
        };
        let swift_target = format!("{swift_arch}-apple-macosx13.5");
        let output = env::var_os("OUT_DIR").expect("Cargo OUT_DIR");
        let output = PathBuf::from(output);
        let bridge_library = output.join("libcodetether_secure_enclave_bridge.a");
        let status = std::process::Command::new("swiftc")
            .args([
                "-emit-library",
                "-static",
                "-parse-as-library",
                "-module-name",
                "codetether_secure_enclave_bridge",
                "-target",
                &swift_target,
                "-framework",
                "CryptoKit",
                "-framework",
                "Security",
                "-framework",
                "Foundation",
            ])
            .arg(&swift_source)
            .arg("-o")
            .arg(&bridge_library)
            .status()
            .expect("failed to invoke swiftc for CryptoKit bridge");
        assert!(
            status.success(),
            "swiftc failed to build CryptoKit Secure Enclave bridge"
        );
        println!("cargo:rustc-link-search=native={}", output.display());
        println!("cargo:rustc-link-lib=static=codetether_secure_enclave_bridge");
        println!("cargo:rustc-link-search=native=/usr/lib/swift/macosx");
        println!("cargo:rustc-link-lib=framework=CryptoKit");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "pick_project_directory",
            "open_provider_guidance",
            "deliver_attention_notification",
            "take_pending_notification_intent",
            "product_device_key_list",
            "product_device_key_create",
            "product_device_key_public",
            "product_device_key_sign",
            "product_device_key_destroy",
            "product_device_key_bind",
            "host_identity_key_create",
            "host_identity_key_public",
            "host_identity_key_sign",
        ]));

    tauri_build::try_build(attributes).expect("failed to run CodeTether desktop build script")
}
