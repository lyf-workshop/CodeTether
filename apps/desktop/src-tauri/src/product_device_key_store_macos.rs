use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use std::{
    ffi::{c_char, CString},
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
};
use uuid::Uuid;

const BRIDGE_SUCCESS: i32 = 0;
const BRIDGE_NOT_FOUND: i32 = 1;
const BRIDGE_STORAGE_FAILURE: i32 = 2;
const BRIDGE_SECURE_STORAGE_UNAVAILABLE: i32 = 3;
const BRIDGE_OPERATION_FAILURE: i32 = 4;
const BRIDGE_INVALID_INPUT: i32 = 5;
const BRIDGE_ACCESS_DENIED: i32 = 6;
const PROTECTION: &str = "macOS_secure_enclave_wrapped_key_file_keychain";

unsafe extern "C" {
    fn codetether_secure_enclave_create(account: *const c_char, public_key: *mut u8) -> i32;
    fn codetether_secure_enclave_public_key(account: *const c_char, public_key: *mut u8) -> i32;
    fn codetether_secure_enclave_sign(account: *const c_char, payload: *const u8, payload_count: usize, signature: *mut u8) -> i32;
    fn codetether_secure_enclave_destroy(account: *const c_char) -> i32;
}

fn map_bridge_error(code: i32) -> ProductDeviceKeyError {
    match code {
        BRIDGE_NOT_FOUND => ProductDeviceKeyError::KeyNotFound,
        BRIDGE_SECURE_STORAGE_UNAVAILABLE => ProductDeviceKeyError::PlatformSecureKeyStorageUnavailable,
        BRIDGE_ACCESS_DENIED => ProductDeviceKeyError::KeyAccessDenied,
        BRIDGE_INVALID_INPUT => ProductDeviceKeyError::InvalidHandle,
        BRIDGE_STORAGE_FAILURE => ProductDeviceKeyError::PlatformKeyStorageUnavailable,
        BRIDGE_OPERATION_FAILURE => ProductDeviceKeyError::PlatformKeyOperationFailed,
        _ => ProductDeviceKeyError::PlatformKeyOperationFailed,
    }
}

fn account(key_handle: &str) -> Result<CString, ProductDeviceKeyError> {
    validate_key_handle(key_handle)?;
    CString::new(key_handle).map_err(|_| ProductDeviceKeyError::InvalidHandle)
}

fn bridge_public_key(key_handle: &str) -> Result<[u8; 64], ProductDeviceKeyError> {
    let account = account(key_handle)?;
    let mut public_key = [0_u8; 64];
    let code = unsafe { codetether_secure_enclave_public_key(account.as_ptr(), public_key.as_mut_ptr()) };
    if code != BRIDGE_SUCCESS { return Err(map_bridge_error(code)); }
    Ok(public_key)
}

fn public_jwk(public_key: &[u8; 64]) -> ProductDevicePublicJwk {
    ProductDevicePublicJwk { kty: "EC", crv: "P-256", x: URL_SAFE_NO_PAD.encode(&public_key[..32]), y: URL_SAFE_NO_PAD.encode(&public_key[32..]) }
}

fn description(key_handle: &str, public_key: &[u8; 64]) -> ProductDeviceKeyDescription {
    ProductDeviceKeyDescription { key_handle: key_handle.to_owned(), public_key: public_jwk(public_key), key_algorithm: ES256_ALGORITHM, key_generation: 1, private_key_exportable: false, protection: PROTECTION }
}

fn metadata_path() -> Result<PathBuf, ProductDeviceKeyError> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or(ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    Ok(home.join("Library").join("Application Support").join("CodeTether").join("product-device-key-handles.json"))
}

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
struct ProductDeviceHandleMetadata {
    handles: Vec<String>,
    #[serde(default)]
    bindings: Vec<ProductDeviceBindingMetadata>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ProductDeviceBindingMetadata {
    key_handle: String,
    device_id: String,
    fingerprint: String,
    key_generation: u32,
    backend: String,
}

fn read_handles() -> Result<Vec<String>, ProductDeviceKeyError> {
    let path = metadata_path()?;
    let bytes = match fs::read(path) { Ok(bytes) => bytes, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()), Err(_) => return Err(ProductDeviceKeyError::PlatformKeyOperationFailed) };
    let metadata: ProductDeviceHandleMetadata = serde_json::from_slice(&bytes).map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    let mut handles = Vec::new();
    for handle in metadata.handles { validate_key_handle(&handle)?; if !handles.contains(&handle) { handles.push(handle); } }
    Ok(handles)
}

fn read_metadata() -> Result<ProductDeviceHandleMetadata, ProductDeviceKeyError> {
    let path = metadata_path()?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProductDeviceHandleMetadata::default())
        }
        Err(_) => return Err(ProductDeviceKeyError::PlatformKeyOperationFailed),
    };
    let metadata = serde_json::from_slice(&bytes)
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    Ok(metadata)
}

fn write_metadata(mut metadata: ProductDeviceHandleMetadata) -> Result<(), ProductDeviceKeyError> {
    metadata.handles.sort();
    metadata.handles.dedup();
    metadata.bindings.sort_by(|left, right| left.key_handle.cmp(&right.key_handle));
    metadata.bindings.dedup_by(|left, right| left.key_handle == right.key_handle);
    let path = metadata_path()?;
    let parent = path
        .parent()
        .ok_or(ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    fs::create_dir_all(parent).map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(&metadata)
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    fs::rename(temporary, path)
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)
}

fn write_handles(handles: Vec<String>) -> Result<(), ProductDeviceKeyError> {
    let mut metadata = read_metadata()?;
    metadata.handles = handles;
    write_metadata(metadata)
}

fn remember_handle(handle: &str) -> Result<(), ProductDeviceKeyError> { let mut handles = read_handles()?; if !handles.iter().any(|candidate| candidate == handle) { handles.push(handle.to_owned()); write_handles(handles)?; } Ok(()) }
fn forget_handle(handle: &str) -> Result<(), ProductDeviceKeyError> {
    let mut metadata = read_metadata()?;
    metadata.handles.retain(|candidate| candidate != handle);
    metadata.bindings.retain(|binding| binding.key_handle != handle);
    write_metadata(metadata)
}

pub fn bind_device(
    key_handle: &str,
    device_id: &str,
    fingerprint: &str,
    key_generation: u32,
) -> Result<(), ProductDeviceKeyError> {
    validate_key_handle(key_handle)?;
    if !device_id.starts_with("dev_") || device_id.len() != 36 {
        return Err(ProductDeviceKeyError::InvalidHandle);
    }
    if !fingerprint.starts_with("sha256:") || fingerprint.len() > 128 {
        return Err(ProductDeviceKeyError::InvalidHandle);
    }
    if key_generation == 0 {
        return Err(ProductDeviceKeyError::InvalidHandle);
    }
    let mut metadata = read_metadata()?;
    metadata.handles.push(key_handle.to_owned());
    metadata.bindings.retain(|binding| binding.key_handle != key_handle);
    metadata.bindings.push(ProductDeviceBindingMetadata {
        key_handle: key_handle.to_owned(),
        device_id: device_id.to_owned(),
        fingerprint: fingerprint.to_owned(),
        key_generation,
        backend: PROTECTION.to_owned(),
    });
    write_metadata(metadata)
}

pub struct MacosKeychainProductDeviceKeyStore;
impl MacosKeychainProductDeviceKeyStore { pub fn new() -> Self { Self } }

impl ProductDeviceKeyStore for MacosKeychainProductDeviceKeyStore {
    fn list_keys(&self) -> Result<Vec<ProductDeviceKeyDescription>, ProductDeviceKeyError> {
        let mut descriptions = Vec::new();
        for key_handle in read_handles()? { match bridge_public_key(&key_handle) { Ok(public_key) => descriptions.push(description(&key_handle, &public_key)), Err(ProductDeviceKeyError::KeyNotFound) => {}, Err(error) => return Err(error) } }
        descriptions.sort_by(|left, right| left.key_handle.cmp(&right.key_handle));
        Ok(descriptions)
    }

    fn create_key(&self) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
        let key_handle = format!("{KEY_HANDLE_PREFIX}{}", Uuid::new_v4().simple());
        let account = account(&key_handle)?;
        let mut public_key = [0_u8; 64];
        let code = unsafe { codetether_secure_enclave_create(account.as_ptr(), public_key.as_mut_ptr()) };
        if code != BRIDGE_SUCCESS { return Err(map_bridge_error(code)); }
        if let Err(error) = remember_handle(&key_handle) { let _ = unsafe { codetether_secure_enclave_destroy(account.as_ptr()) }; return Err(error); }
        Ok(description(&key_handle, &public_key))
    }

    fn public_key(&self, key_handle: &str) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> { let public_key = bridge_public_key(key_handle)?; Ok(description(key_handle, &public_key)) }

    fn sign(&self, key_handle: &str, payload: &[u8]) -> Result<Vec<u8>, ProductDeviceKeyError> {
        if payload.is_empty() || payload.len() > MAX_SIGNING_PAYLOAD_BYTES { return Err(ProductDeviceKeyError::InvalidPayload); }
        let account = account(key_handle)?; let mut signature = [0_u8; 64];
        let code = unsafe { codetether_secure_enclave_sign(account.as_ptr(), payload.as_ptr(), payload.len(), signature.as_mut_ptr()) };
        if code != BRIDGE_SUCCESS { return Err(map_bridge_error(code)); }
        Ok(signature.to_vec())
    }

    fn destroy_key(&self, key_handle: &str) -> Result<(), ProductDeviceKeyError> {
        let account = account(key_handle)?; let code = unsafe { codetether_secure_enclave_destroy(account.as_ptr()) };
        if code != BRIDGE_SUCCESS { return Err(map_bridge_error(code)); }
        forget_handle(key_handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secure_enclave_handle_is_the_exact_keychain_account() {
        let handle = format!("{KEY_HANDLE_PREFIX}{}", "a".repeat(32));
        assert_eq!(account(&handle).unwrap().to_str().unwrap(), handle);
    }

    #[test]
    #[ignore = "physical Apple Silicon Secure Enclave test"]
    fn secure_enclave_key_is_persistent_non_exportable_and_verifies() {
        let first_process = MacosKeychainProductDeviceKeyStore::new();
        let created = first_process.create_key().expect("create Secure Enclave key");
        assert_eq!(created.key_handle.len(), KEY_HANDLE_PREFIX.len() + 32);
        assert_eq!(created.key_algorithm, ES256_ALGORITHM);
        assert_eq!(created.key_generation, 1);
        assert!(!created.private_key_exportable);
        assert_eq!(created.protection, PROTECTION);
        let restarted_process = MacosKeychainProductDeviceKeyStore::new();
        assert_eq!(restarted_process.public_key(&created.key_handle).unwrap().public_key, created.public_key);
        let signature = restarted_process.sign(&created.key_handle, b"protected-header.payload").expect("sign through Secure Enclave");
        assert_eq!(signature.len(), 64);
        let second = first_process.create_key().expect("create second key");
        assert_ne!(second.key_handle, created.key_handle);
        assert_ne!(second.public_key, created.public_key);
        first_process.destroy_key(&created.key_handle).expect("destroy first key");
        assert_eq!(first_process.public_key(&created.key_handle).unwrap_err(), ProductDeviceKeyError::KeyNotFound);
        assert!(first_process.public_key(&second.key_handle).is_ok());
        first_process.destroy_key(&second.key_handle).expect("destroy second key");
        let _ = signature;
    }
}
