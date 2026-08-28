use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let build_id_path = manifest_dir.join("binaries").join("build-id.txt");
    println!("cargo:rerun-if-changed={}", build_id_path.display());

    let build_id = fs::read_to_string(&build_id_path)
        .map(|value| value.trim().to_owned())
        .unwrap_or_else(|_| "development-unbundled".to_owned());
    assert!(!build_id.is_empty(), "Desktop build ID must not be empty");
    println!("cargo:rustc-env=CODETETHER_BUILD_ID={build_id}");

    tauri_build::build()
}
