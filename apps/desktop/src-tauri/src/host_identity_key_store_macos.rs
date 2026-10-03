use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use std::ffi::{c_char, CString};
use uuid::Uuid;

const BRIDGE_SUCCESS: i32 = 0;
const BRIDGE_NOT_FOUND: i32 = 1;
const BRIDGE_STORAGE_FAILURE: i32 = 2;
const BRIDGE_SECURE_STORAGE_UNAVAILABLE: i32 = 3;
const BRIDGE_OPERATION_FAILURE: i32 = 4;
const BRIDGE_INVALID_INPUT: i32 = 5;
const BRIDGE_ACCESS_DENIED: i32 = 6;
const PROTECTION: &str = "macos_secure_enclave";

unsafe extern "C" {
    fn codetether_host_secure_enclave_create(account: *const c_char, public_key: *mut u8) -> i32;
    fn codetether_host_secure_enclave_public_key(
        account: *const c_char,
        public_key: *mut u8,
    ) -> i32;
    fn codetether_host_secure_enclave_sign(
        account: *const c_char,
        payload: *const u8,
        payload_count: usize,
        signature: *mut u8,
    ) -> i32;
    fn codetether_host_secure_enclave_destroy(account: *const c_char) -> i32;
}

fn map_bridge_error(code: i32) -> HostIdentityKeyError {
    match code {
        BRIDGE_NOT_FOUND => HostIdentityKeyError::KeyNotFound,
        BRIDGE_SECURE_STORAGE_UNAVAILABLE => {
            HostIdentityKeyError::PlatformKeyStorageUnavailable
        }
        BRIDGE_ACCESS_DENIED => HostIdentityKeyError::KeyAccessDenied,
        BRIDGE_INVALID_INPUT => HostIdentityKeyError::InvalidHandle,
        BRIDGE_STORAGE_FAILURE => HostIdentityKeyError::PlatformKeyStorageUnavailable,
        BRIDGE_OPERATION_FAILURE => HostIdentityKeyError::PlatformKeyOperationFailed,
        _ => HostIdentityKeyError::PlatformKeyOperationFailed,
    }
}

fn account(key_handle: &str) -> Result<CString, HostIdentityKeyError> {
    validate_key_handle(key_handle)?;
    CString::new(key_handle).map_err(|_| HostIdentityKeyError::InvalidHandle)
}

fn bridge_public_key(key_handle: &str) -> Result<[u8; 64], HostIdentityKeyError> {
    let account = account(key_handle)?;
    let mut public_key = [0_u8; 64];
    let code = unsafe {
        codetether_host_secure_enclave_public_key(account.as_ptr(), public_key.as_mut_ptr())
    };
    if code != BRIDGE_SUCCESS {
        return Err(map_bridge_error(code));
    }
    Ok(public_key)
}

fn public_jwk(public_key: &[u8; 64]) -> HostIdentityPublicJwk {
    HostIdentityPublicJwk {
        kty: "EC",
        crv: "P-256",
        x: URL_SAFE_NO_PAD.encode(&public_key[..32]),
        y: URL_SAFE_NO_PAD.encode(&public_key[32..]),
    }
}

fn description(key_handle: &str, public_key: &[u8; 64]) -> HostIdentityKeyDescription {
    HostIdentityKeyDescription {
        key_handle: key_handle.to_owned(),
        public_key: public_jwk(public_key),
        key_algorithm: ES256_ALGORITHM,
        key_generation: 1,
        private_key_exportable: false,
        protection: PROTECTION,
    }
}

pub struct MacosSecureEnclaveHostIdentityKeyStore;

impl MacosSecureEnclaveHostIdentityKeyStore {
    pub fn new() -> Self {
        Self
    }
}

impl HostIdentityKeyStore for MacosSecureEnclaveHostIdentityKeyStore {
    fn create_key(&self) -> Result<HostIdentityKeyDescription, HostIdentityKeyError> {
        let key_handle = format!("{KEY_HANDLE_PREFIX}{}", Uuid::new_v4().simple());
        let account = account(&key_handle)?;
        let mut public_key = [0_u8; 64];
        let code = unsafe {
            codetether_host_secure_enclave_create(account.as_ptr(), public_key.as_mut_ptr())
        };
        if code != BRIDGE_SUCCESS {
            return Err(map_bridge_error(code));
        }
        Ok(description(&key_handle, &public_key))
    }

    fn public_key(
        &self,
        key_handle: &str,
    ) -> Result<HostIdentityKeyDescription, HostIdentityKeyError> {
        let public_key = bridge_public_key(key_handle)?;
        Ok(description(key_handle, &public_key))
    }

    fn sign(&self, key_handle: &str, payload: &[u8]) -> Result<Vec<u8>, HostIdentityKeyError> {
        if payload.is_empty() || payload.len() > MAX_SIGNING_PAYLOAD_BYTES {
            return Err(HostIdentityKeyError::InvalidPayload);
        }
        let account = account(key_handle)?;
        let mut signature = [0_u8; 64];
        let code = unsafe {
            codetether_host_secure_enclave_sign(
                account.as_ptr(),
                payload.as_ptr(),
                payload.len(),
                signature.as_mut_ptr(),
            )
        };
        if code != BRIDGE_SUCCESS {
            return Err(map_bridge_error(code));
        }
        Ok(signature.to_vec())
    }

    fn destroy_key(&self, key_handle: &str) -> Result<(), HostIdentityKeyError> {
        let account = account(key_handle)?;
        let code = unsafe { codetether_host_secure_enclave_destroy(account.as_ptr()) };
        if code != BRIDGE_SUCCESS {
            return Err(map_bridge_error(code));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::hazmat::PrehashVerifier, Signature, VerifyingKey};
    use sha2::{Digest, Sha256};

    #[test]
    fn host_handle_uses_a_separate_namespace() {
        let handle = format!("{KEY_HANDLE_PREFIX}{}", "a".repeat(32));
        assert!(validate_key_handle(&handle).is_ok());
        assert!(!handle.starts_with("CodeTether.ProductDevice."));
    }

    #[test]
    fn host_description_is_non_exportable_es256() {
        let public_key = [7_u8; 64];
        let description = description(
            &format!("{KEY_HANDLE_PREFIX}{}", "b".repeat(32)),
            &public_key,
        );
        assert_eq!(description.key_algorithm, ES256_ALGORITHM);
        assert_eq!(description.key_generation, 1);
        assert!(!description.private_key_exportable);
        assert_eq!(description.protection, PROTECTION);
    }

    #[test]
    #[ignore = "physical Apple Silicon Secure Enclave test"]
    fn secure_enclave_host_key_is_persistent_non_exportable_and_verifies() {
        let first_process = MacosSecureEnclaveHostIdentityKeyStore::new();
        let created = first_process
            .create_key()
            .expect("create Secure Enclave Host key");
        assert_eq!(created.key_handle.len(), KEY_HANDLE_PREFIX.len() + 32);
        assert_eq!(created.key_algorithm, ES256_ALGORITHM);
        assert_eq!(created.key_generation, 1);
        assert!(!created.private_key_exportable);
        assert_eq!(created.protection, PROTECTION);

        let restarted_process = MacosSecureEnclaveHostIdentityKeyStore::new();
        let loaded = restarted_process
            .public_key(&created.key_handle)
            .expect("reload Host key after restart");
        assert_eq!(loaded.public_key, created.public_key);

        let signing_input = b"host-identity-header.payload";
        let signature = restarted_process
            .sign(&created.key_handle, signing_input)
            .expect("sign through Secure Enclave Host key");
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
            .expect("signature verifies against the Host public key");

        first_process
            .destroy_key(&created.key_handle)
            .expect("destroy Host key");
        assert_eq!(
            first_process.public_key(&created.key_handle).unwrap_err(),
            HostIdentityKeyError::KeyNotFound
        );
    }
}
