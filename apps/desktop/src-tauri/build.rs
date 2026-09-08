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

    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "pick_project_directory",
            "open_provider_guidance",
            "deliver_attention_notification",
            "take_pending_notification_intent",
        ]));

    tauri_build::try_build(attributes).expect("failed to run CodeTether desktop build script")
}
