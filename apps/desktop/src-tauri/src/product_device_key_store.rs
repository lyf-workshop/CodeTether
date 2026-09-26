use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Serialize;

const KEY_HANDLE_PREFIX: &str = "CodeTether.ProductDevice.";
const MAX_SIGNING_PAYLOAD_BYTES: usize = 4_096;
const ES256_ALGORITHM: &str = "ES256";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProductDevicePublicJwk {
    kty: &'static str,
    crv: &'static str,
    x: String,
    y: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDeviceKeyDescription {
    key_handle: String,
    public_key: ProductDevicePublicJwk,
    key_algorithm: &'static str,
    key_generation: u32,
    private_key_exportable: bool,
    protection: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDeviceSignature {
    signature_base64_url: String,
    key_algorithm: &'static str,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProductDeviceKeyError {
    InvalidHandle,
    InvalidPayload,
    KeyNotFound,
    KeyAccessDenied,
    KeyGenerationFailed,
    KeySignFailed,
    PlatformKeyStorageUnavailable,
    PlatformKeyOperationFailed,
}

impl ProductDeviceKeyError {
    fn code(self) -> &'static str {
        match self {
            Self::InvalidHandle => "product_device_key_handle_invalid",
            Self::InvalidPayload => "product_device_signing_payload_invalid",
            Self::KeyNotFound => "product_device_key_not_found",
            Self::KeyAccessDenied => "product_device_key_access_denied",
            Self::KeyGenerationFailed => "product_device_key_generation_failed",
            Self::KeySignFailed => "product_device_key_sign_failed",
            Self::PlatformKeyStorageUnavailable => "platform_key_storage_unavailable",
            Self::PlatformKeyOperationFailed => "platform_key_operation_failed",
        }
    }
}

trait ProductDeviceKeyStore {
    fn list_keys(&self) -> Result<Vec<ProductDeviceKeyDescription>, ProductDeviceKeyError>;
    fn create_key(&self) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError>;
    fn public_key(
        &self,
        key_handle: &str,
    ) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError>;
    fn sign(&self, key_handle: &str, payload: &[u8]) -> Result<Vec<u8>, ProductDeviceKeyError>;
    fn destroy_key(&self, key_handle: &str) -> Result<(), ProductDeviceKeyError>;
}

fn validate_key_handle(key_handle: &str) -> Result<(), ProductDeviceKeyError> {
    let suffix = key_handle
        .strip_prefix(KEY_HANDLE_PREFIX)
        .ok_or(ProductDeviceKeyError::InvalidHandle)?;
    if suffix.len() != 32
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ProductDeviceKeyError::InvalidHandle);
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{ffi::c_void, ptr};
    use uuid::Uuid;
    use windows::{
        Win32::{
            Foundation::NTE_NO_MORE_ITEMS,
            Security::{
                Cryptography::{
                    BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_PUBLIC_P256_MAGIC, CERT_KEY_SPEC,
                    MS_KEY_STORAGE_PROVIDER, NCRYPT_ALLOW_EXPORT_FLAG,
                    NCRYPT_ALLOW_PLAINTEXT_EXPORT_FLAG, NCRYPT_ECDSA_P256_ALGORITHM,
                    NCRYPT_EXPORT_POLICY_PROPERTY, NCRYPT_FLAGS, NCRYPT_HANDLE, NCRYPT_KEY_HANDLE,
                    NCRYPT_PROV_HANDLE, NCRYPT_SILENT_FLAG, NCryptCreatePersistedKey,
                    NCryptDeleteKey, NCryptEnumKeys, NCryptExportKey, NCryptFinalizeKey,
                    NCryptFreeBuffer, NCryptFreeObject, NCryptGetProperty, NCryptKeyName,
                    NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty, NCryptSignHash,
                },
                OBJECT_SECURITY_INFORMATION,
            },
        },
        core::PCWSTR,
    };

    struct ProviderHandle(NCRYPT_PROV_HANDLE);

    impl Drop for ProviderHandle {
        fn drop(&mut self) {
            if self.0.0 != 0 {
                // SAFETY: this handle is owned by the guard and freed exactly once.
                let _ = unsafe { NCryptFreeObject(NCRYPT_HANDLE(self.0.0)) };
            }
        }
    }

    struct KeyHandle(Option<NCRYPT_KEY_HANDLE>);

    impl KeyHandle {
        fn get(&self) -> NCRYPT_KEY_HANDLE {
            self.0.expect("owned CNG key handle")
        }

        fn delete(mut self) -> Result<(), ProductDeviceKeyError> {
            let handle = self.0.take().expect("owned CNG key handle");
            // SAFETY: the owned handle is valid and NCryptDeleteKey consumes it.
            unsafe { NCryptDeleteKey(handle, 0) }
                .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)
        }
    }

    impl Drop for KeyHandle {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                // SAFETY: this handle is owned by the guard and freed exactly once.
                let _ = unsafe { NCryptFreeObject(NCRYPT_HANDLE(handle.0)) };
            }
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn open_provider() -> Result<ProviderHandle, ProductDeviceKeyError> {
        let mut handle = NCRYPT_PROV_HANDLE::default();
        // SAFETY: the out pointer is valid and the provider name is a static PCWSTR.
        unsafe { NCryptOpenStorageProvider(&mut handle, MS_KEY_STORAGE_PROVIDER, 0) }
            .map_err(|_| ProductDeviceKeyError::PlatformKeyStorageUnavailable)?;
        Ok(ProviderHandle(handle))
    }

    fn open_key(
        provider: &ProviderHandle,
        key_name: &str,
    ) -> Result<KeyHandle, ProductDeviceKeyError> {
        validate_key_handle(key_name)?;
        let key_name = wide(key_name);
        let mut key = NCRYPT_KEY_HANDLE::default();
        // SAFETY: provider is live, output points to initialized storage, and PCWSTR is terminated.
        unsafe {
            NCryptOpenKey(
                provider.0,
                &mut key,
                PCWSTR(key_name.as_ptr()),
                CERT_KEY_SPEC(0),
                NCRYPT_SILENT_FLAG,
            )
        }
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
        Ok(KeyHandle(Some(key)))
    }

    fn export_policy(key: NCRYPT_KEY_HANDLE) -> Result<u32, ProductDeviceKeyError> {
        let mut bytes = [0_u8; size_of::<u32>()];
        let mut written = 0_u32;
        // SAFETY: key is live and the fixed output buffer is valid for the u32 property.
        unsafe {
            NCryptGetProperty(
                NCRYPT_HANDLE(key.0),
                NCRYPT_EXPORT_POLICY_PROPERTY,
                Some(&mut bytes),
                &mut written,
                OBJECT_SECURITY_INFORMATION(0),
            )
        }
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
        if written as usize != bytes.len() {
            return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
        }
        Ok(u32::from_ne_bytes(bytes))
    }

    fn export_public_jwk(
        key: NCRYPT_KEY_HANDLE,
    ) -> Result<ProductDevicePublicJwk, ProductDeviceKeyError> {
        let mut required = 0_u32;
        // SAFETY: key is live and the first call only asks CNG for the required length.
        unsafe {
            NCryptExportKey(
                key,
                None,
                BCRYPT_ECCPUBLIC_BLOB,
                None,
                None,
                &mut required,
                NCRYPT_FLAGS(0),
            )
        }
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
        let mut blob = vec![0_u8; required as usize];
        // SAFETY: key is live and blob has the exact size CNG requested.
        unsafe {
            NCryptExportKey(
                key,
                None,
                BCRYPT_ECCPUBLIC_BLOB,
                None,
                Some(&mut blob),
                &mut required,
                NCRYPT_FLAGS(0),
            )
        }
        .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
        blob.truncate(required as usize);
        if blob.len() != 72 {
            return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
        }
        let magic = u32::from_le_bytes(
            blob[0..4]
                .try_into()
                .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?,
        );
        let coordinate_bytes = u32::from_le_bytes(
            blob[4..8]
                .try_into()
                .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?,
        );
        if magic != BCRYPT_ECDSA_PUBLIC_P256_MAGIC || coordinate_bytes != 32 {
            return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
        }
        Ok(ProductDevicePublicJwk {
            kty: "EC",
            crv: "P-256",
            x: URL_SAFE_NO_PAD.encode(&blob[8..40]),
            y: URL_SAFE_NO_PAD.encode(&blob[40..72]),
        })
    }

    pub struct WindowsCngProductDeviceKeyStore;

    impl WindowsCngProductDeviceKeyStore {
        pub fn new() -> Self {
            Self
        }

        fn description(
            &self,
            key_handle: &str,
            key: NCRYPT_KEY_HANDLE,
        ) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
            let policy = export_policy(key)?;
            if policy & (NCRYPT_ALLOW_EXPORT_FLAG | NCRYPT_ALLOW_PLAINTEXT_EXPORT_FLAG) != 0 {
                return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
            }
            Ok(ProductDeviceKeyDescription {
                key_handle: key_handle.to_owned(),
                public_key: export_public_jwk(key)?,
                key_algorithm: ES256_ALGORITHM,
                key_generation: 1,
                private_key_exportable: false,
                protection: "windows_cng_software_ksp_non_exportable",
            })
        }
    }

    impl ProductDeviceKeyStore for WindowsCngProductDeviceKeyStore {
        fn list_keys(&self) -> Result<Vec<ProductDeviceKeyDescription>, ProductDeviceKeyError> {
            let provider = open_provider()?;
            let mut enumeration_state: *mut c_void = ptr::null_mut();
            let mut descriptions = Vec::new();
            loop {
                let mut key_name: *mut NCryptKeyName = ptr::null_mut();
                // SAFETY: provider is live and both output pointers are valid for CNG allocation.
                let enumerated = unsafe {
                    NCryptEnumKeys(
                        provider.0,
                        PCWSTR::null(),
                        &mut key_name,
                        &mut enumeration_state,
                        NCRYPT_SILENT_FLAG,
                    )
                };
                match enumerated {
                    Ok(()) => {
                        if key_name.is_null() {
                            return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
                        }
                        // SAFETY: CNG returned a live, terminated key name.
                        let name = unsafe { (*key_name).pszName.to_string() }
                            .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
                        // SAFETY: key_name was allocated by CNG for this enumeration call.
                        unsafe { NCryptFreeBuffer(key_name.cast()) }
                            .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
                        if name.starts_with(KEY_HANDLE_PREFIX) {
                            let key = open_key(&provider, &name)?;
                            descriptions.push(self.description(&name, key.get())?);
                        }
                    }
                    Err(error) if error.code() == NTE_NO_MORE_ITEMS => break,
                    Err(_) => return Err(ProductDeviceKeyError::PlatformKeyOperationFailed),
                }
            }
            if !enumeration_state.is_null() {
                // SAFETY: enumeration_state was allocated by CNG during NCryptEnumKeys.
                unsafe { NCryptFreeBuffer(enumeration_state) }
                    .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
            }
            descriptions.sort_by(|left, right| left.key_handle.cmp(&right.key_handle));
            Ok(descriptions)
        }

        fn create_key(&self) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
            let provider = open_provider()?;
            let key_name = format!("{KEY_HANDLE_PREFIX}{}", Uuid::new_v4().simple());
            let wide_key_name = wide(&key_name);
            let mut raw_key = NCRYPT_KEY_HANDLE::default();
            // SAFETY: provider is live, output is valid, and both PCWSTR inputs are terminated.
            unsafe {
                NCryptCreatePersistedKey(
                    provider.0,
                    &mut raw_key,
                    NCRYPT_ECDSA_P256_ALGORITHM,
                    PCWSTR(wide_key_name.as_ptr()),
                    CERT_KEY_SPEC(0),
                    NCRYPT_FLAGS(0),
                )
            }
            .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
            let key = KeyHandle(Some(raw_key));
            let no_export = 0_u32.to_ne_bytes();
            // SAFETY: key is live and the property bytes contain the explicit no-export policy.
            if unsafe {
                NCryptSetProperty(
                    NCRYPT_HANDLE(key.get().0),
                    NCRYPT_EXPORT_POLICY_PROPERTY,
                    &no_export,
                    NCRYPT_FLAGS(0),
                )
            }
            .is_err()
            {
                let _ = key.delete();
                return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
            }
            // SAFETY: key is live and has not yet been finalized.
            if unsafe { NCryptFinalizeKey(key.get(), NCRYPT_FLAGS(0)) }.is_err() {
                let _ = key.delete();
                return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
            }
            match self.description(&key_name, key.get()) {
                Ok(description) => Ok(description),
                Err(error) => {
                    let _ = key.delete();
                    Err(error)
                }
            }
        }

        fn public_key(
            &self,
            key_handle: &str,
        ) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
            let provider = open_provider()?;
            let key = open_key(&provider, key_handle)?;
            self.description(key_handle, key.get())
        }

        fn sign(&self, key_handle: &str, payload: &[u8]) -> Result<Vec<u8>, ProductDeviceKeyError> {
            if payload.is_empty() || payload.len() > MAX_SIGNING_PAYLOAD_BYTES {
                return Err(ProductDeviceKeyError::InvalidPayload);
            }
            let provider = open_provider()?;
            let key = open_key(&provider, key_handle)?;
            if export_policy(key.get())?
                & (NCRYPT_ALLOW_EXPORT_FLAG | NCRYPT_ALLOW_PLAINTEXT_EXPORT_FLAG)
                != 0
            {
                return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
            }
            let digest = Sha256::digest(payload);
            let mut required = 0_u32;
            // SAFETY: key is live and the first call only asks CNG for the signature length.
            unsafe {
                NCryptSignHash(
                    key.get(),
                    None,
                    &digest,
                    None,
                    &mut required,
                    NCRYPT_SILENT_FLAG,
                )
            }
            .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
            let mut signature = vec![0_u8; required as usize];
            // SAFETY: key is live and signature has the exact size CNG requested.
            unsafe {
                NCryptSignHash(
                    key.get(),
                    None,
                    &digest,
                    Some(&mut signature),
                    &mut required,
                    NCRYPT_SILENT_FLAG,
                )
            }
            .map_err(|_| ProductDeviceKeyError::PlatformKeyOperationFailed)?;
            signature.truncate(required as usize);
            if signature.len() != 64 {
                return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
            }
            Ok(signature)
        }

        fn destroy_key(&self, key_handle: &str) -> Result<(), ProductDeviceKeyError> {
            let provider = open_provider()?;
            open_key(&provider, key_handle)?.delete()
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    include!("product_device_key_store_macos.rs");
}

#[cfg(all(not(windows), not(target_os = "macos")))]
mod platform {
    use super::*;

    pub struct WindowsCngProductDeviceKeyStore;

    impl WindowsCngProductDeviceKeyStore {
        pub fn new() -> Self {
            Self
        }
    }

    impl ProductDeviceKeyStore for WindowsCngProductDeviceKeyStore {
        fn list_keys(&self) -> Result<Vec<ProductDeviceKeyDescription>, ProductDeviceKeyError> {
            Err(ProductDeviceKeyError::PlatformKeyStorageUnavailable)
        }

        fn create_key(&self) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
            Err(ProductDeviceKeyError::PlatformKeyStorageUnavailable)
        }

        fn public_key(
            &self,
            _key_handle: &str,
        ) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
            Err(ProductDeviceKeyError::PlatformKeyStorageUnavailable)
        }

        fn sign(
            &self,
            _key_handle: &str,
            _payload: &[u8],
        ) -> Result<Vec<u8>, ProductDeviceKeyError> {
            Err(ProductDeviceKeyError::PlatformKeyStorageUnavailable)
        }

        fn destroy_key(&self, _key_handle: &str) -> Result<(), ProductDeviceKeyError> {
            Err(ProductDeviceKeyError::PlatformKeyStorageUnavailable)
        }
    }
}

use platform::WindowsCngProductDeviceKeyStore;

#[tauri::command]
pub fn product_device_key_list() -> Result<Vec<ProductDeviceKeyDescription>, String> {
    WindowsCngProductDeviceKeyStore::new()
        .list_keys()
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn product_device_key_create() -> Result<ProductDeviceKeyDescription, String> {
    WindowsCngProductDeviceKeyStore::new()
        .create_key()
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn product_device_key_public(
    key_handle: String,
) -> Result<ProductDeviceKeyDescription, String> {
    WindowsCngProductDeviceKeyStore::new()
        .public_key(&key_handle)
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn product_device_key_sign(
    key_handle: String,
    payload_base64_url: String,
) -> Result<ProductDeviceSignature, String> {
    if payload_base64_url.len() > 8_192 {
        return Err(ProductDeviceKeyError::InvalidPayload.code().to_owned());
    }
    let payload = URL_SAFE_NO_PAD
        .decode(&payload_base64_url)
        .map_err(|_| ProductDeviceKeyError::InvalidPayload.code().to_owned())?;
    if URL_SAFE_NO_PAD.encode(&payload) != payload_base64_url {
        return Err(ProductDeviceKeyError::InvalidPayload.code().to_owned());
    }
    WindowsCngProductDeviceKeyStore::new()
        .sign(&key_handle, &payload)
        .map(|signature| ProductDeviceSignature {
            signature_base64_url: URL_SAFE_NO_PAD.encode(signature),
            key_algorithm: ES256_ALGORITHM,
        })
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn product_device_key_destroy(key_handle: String) -> Result<(), String> {
    WindowsCngProductDeviceKeyStore::new()
        .destroy_key(&key_handle)
        .map_err(|error| error.code().to_owned())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use p256::ecdsa::{Signature, VerifyingKey, signature::hazmat::PrehashVerifier};
    use sha2::{Digest, Sha256};

    #[test]
    fn windows_cng_key_is_non_exportable_persistent_and_signs_es256() {
        let first_process = WindowsCngProductDeviceKeyStore::new();
        let created = first_process.create_key().expect("create persisted key");
        assert_eq!(created.key_algorithm, ES256_ALGORITHM);
        assert_eq!(created.key_generation, 1);
        assert!(!created.private_key_exportable);
        assert_eq!(
            created.protection,
            "windows_cng_software_ksp_non_exportable"
        );
        assert!(
            first_process
                .list_keys()
                .expect("enumerate persisted ProductDevice keys")
                .iter()
                .any(|candidate| candidate.key_handle == created.key_handle)
        );

        let result = {
            let restarted_process = WindowsCngProductDeviceKeyStore::new();
            let loaded = restarted_process
                .public_key(&created.key_handle)
                .expect("load persisted key by opaque handle");
            assert_eq!(loaded.public_key, created.public_key);
            assert!(!loaded.private_key_exportable);

            let signing_input = b"protected-header.payload";
            let signature = restarted_process
                .sign(&created.key_handle, signing_input)
                .expect("sign through persisted CNG handle");
            assert_eq!(signature.len(), 64);

            let mut encoded_point = Vec::with_capacity(65);
            encoded_point.push(4);
            encoded_point.extend(
                URL_SAFE_NO_PAD
                    .decode(&created.public_key.x)
                    .expect("public x coordinate"),
            );
            encoded_point.extend(
                URL_SAFE_NO_PAD
                    .decode(&created.public_key.y)
                    .expect("public y coordinate"),
            );
            let verifying_key =
                VerifyingKey::from_sec1_bytes(&encoded_point).expect("valid P-256 public key");
            let signature = Signature::from_slice(&signature).expect("raw ES256 signature");
            verifying_key
                .verify_prehash(&Sha256::digest(signing_input), &signature)
                .expect("signature verifies against exported public key");
            Ok::<(), ProductDeviceKeyError>(())
        };

        first_process
            .destroy_key(&created.key_handle)
            .expect("destroy test key");
        assert_eq!(
            first_process.public_key(&created.key_handle).unwrap_err(),
            ProductDeviceKeyError::PlatformKeyOperationFailed
        );
        result.expect("CNG feasibility checks");
    }

    #[test]
    fn key_commands_reject_unbounded_or_invalid_input_before_platform_use() {
        assert_eq!(
            product_device_key_public("other-product-key".to_owned()).unwrap_err(),
            ProductDeviceKeyError::InvalidHandle.code()
        );
        assert_eq!(
            product_device_key_sign("invalid".to_owned(), String::new()).unwrap_err(),
            ProductDeviceKeyError::InvalidPayload.code()
        );
    }
}
