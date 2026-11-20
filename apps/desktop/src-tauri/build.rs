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

    // A one-off, build-time-only port for W0F's isolated unsigned Desktop
    // validation. Normal Desktop remains fixed to its production port.
    println!("cargo:rerun-if-env-changed=CODETETHER_W0F_HOST_PORT");
    let diagnostic_port = env::var("CODETETHER_W0F_HOST_PORT").ok();
    assert!(
        diagnostic_port
            .as_deref()
            .is_none_or(|value| value == "4320"),
        "W0F diagnostic Desktop port must be 4320"
    );
    if diagnostic_port.is_some() {
        assert_eq!(
            env::var("VITE_CODETETHER_HOST_URL").as_deref(),
            Ok("http://127.0.0.1:4320"),
            "W0F diagnostic Desktop requires Web assets targeting port 4320"
        );
        let data_dir = env::var("CODETETHER_W0F_DATA_DIR")
            .expect("W0F diagnostic Desktop requires an isolated data directory");
        assert!(
            PathBuf::from(&data_dir).is_absolute(),
            "W0F diagnostic Desktop data directory must be absolute"
        );
        println!("cargo:rustc-env=CODETETHER_W0F_DATA_DIR={data_dir}");
    }
    println!("cargo:rerun-if-env-changed=CODETETHER_W0F_DATA_DIR");
    println!(
        "cargo:rustc-env=CODETETHER_DESKTOP_HOST_PORT={}",
        diagnostic_port.as_deref().unwrap_or("4317")
    );

    println!("cargo:rerun-if-env-changed=VITE_CODETETHER_CONTROL_PLANE_URL");
    println!("cargo:rerun-if-env-changed=CODETETHER_UPDATE_BASE_URL");
    println!("cargo:rerun-if-env-changed=CODETETHER_UPDATE_PUBKEY");
    let relay_variables = [
        "CODETETHER_SUPERVISOR_RELAY_ENDPOINT",
        "CODETETHER_SUPERVISOR_RELAY_ID",
        "CODETETHER_SUPERVISOR_RELAY_FINGERPRINT",
    ];
    let relay_overrides = relay_variables.map(|name| {
        println!("cargo:rerun-if-env-changed={name}");
        env::var_os(name)
    });
    assert!(
        relay_overrides.iter().all(Option::is_none)
            || relay_overrides.iter().all(|value| {
                value
                    .as_ref()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| !value.trim().is_empty())
            }),
        "Configure all three build-time Relay settings together"
    );

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
            "log_notification_stage",
            "take_pending_notification_intent",
            "product_device_key_list",
            "product_device_key_create",
            "product_device_key_public",
            "product_device_key_sign",
            "product_device_key_destroy",
            "product_device_key_bind",
            "product_device_registration_metadata",
            "open_pairing_diagnostic",
            "host_identity_key_create",
            "host_identity_key_public",
            "host_identity_key_sign",
            "host_identity_key_destroy",
            "update_state",
            "update_check",
            "update_download",
            "update_install",
        ]));

    tauri_build::try_build(attributes).expect("failed to run CodeTether desktop build script")
}
