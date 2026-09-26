use super::*;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use core_foundation::{
    base::{TCFType, ToVoid},
    boolean::CFBoolean,
    dictionary::CFMutableDictionary,
    number::CFNumber,
    string::CFString,
};
use security_framework::{
    item::{CloudSync, ItemSearchOptions, KeyClass, Limit, Reference, SearchResult},
    key::{Algorithm, SecKey},
};
use security_framework_sys::{
    access_control::kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    item::{
        kSecAttrIsPermanent, kSecAttrKeySizeInBits, kSecAttrKeyType,
        kSecAttrKeyTypeECSECPrimeRandom, kSecAttrLabel, kSecAttrSynchronizable,
        kSecPrivateKeyAttrs,
    },
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecAttrIsExtractable: core_foundation_sys::string::CFStringRef;
    static kSecAttrAccessible: core_foundation_sys::string::CFStringRef;
}

const ERR_SEC_ITEM_NOT_FOUND: i32 = -25_300;
const ERR_SEC_NOT_AVAILABLE: i32 = -25_291;
const ERR_SEC_AUTH_FAILED: i32 = -25_293;
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25_308;

fn map_security_error(code: i32) -> ProductDeviceKeyError {
    match code {
        ERR_SEC_ITEM_NOT_FOUND => ProductDeviceKeyError::KeyNotFound,
        ERR_SEC_NOT_AVAILABLE => ProductDeviceKeyError::PlatformKeyStorageUnavailable,
        ERR_SEC_AUTH_FAILED | ERR_SEC_INTERACTION_NOT_ALLOWED => {
            ProductDeviceKeyError::KeyAccessDenied
        }
        _ => ProductDeviceKeyError::PlatformKeyOperationFailed,
    }
}

fn map_key_error(error: security_framework::base::Error) -> ProductDeviceKeyError {
    map_security_error(error.code())
}

fn key_label(key: &SecKey) -> Option<String> {
    let attributes = key.attributes();
    let value = attributes.find(unsafe { kSecAttrLabel.to_void() })?;
    Some(unsafe { CFString::wrap_under_get_rule((*value).cast()) }.to_string())
}

fn open_key(key_handle: &str) -> Result<SecKey, ProductDeviceKeyError> {
    validate_key_handle(key_handle)?;
    let mut search = ItemSearchOptions::new();
    search
        .key_class(KeyClass::private())
        .label(key_handle)
        .cloud_sync(CloudSync::MatchSyncNo)
        .load_refs(true)
        .limit(2);
    let results = match search.search() {
        Ok(results) => results,
        Err(error) => return Err(map_key_error(error)),
    };
    let mut keys = results.into_iter().filter_map(|result| match result {
        SearchResult::Ref(Reference::Key(key)) => Some(key),
        _ => None,
    });
    let key = keys.next().ok_or(ProductDeviceKeyError::KeyNotFound)?;
    if keys.next().is_some() {
        return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
    }
    Ok(key)
}

fn public_jwk(key: &SecKey) -> Result<ProductDevicePublicJwk, ProductDeviceKeyError> {
    let public_key = key
        .public_key()
        .ok_or(ProductDeviceKeyError::PlatformKeyOperationFailed)?;
    let bytes = public_key
        .external_representation()
        .ok_or(ProductDeviceKeyError::PlatformKeyOperationFailed)?
        .to_vec();
    if bytes.len() != 65 || bytes[0] != 4 {
        return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
    }
    Ok(ProductDevicePublicJwk {
        kty: "EC",
        crv: "P-256",
        x: URL_SAFE_NO_PAD.encode(&bytes[1..33]),
        y: URL_SAFE_NO_PAD.encode(&bytes[33..65]),
    })
}

fn description(
    key_handle: &str,
    key: &SecKey,
) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
    if key_label(key).as_deref() != Some(key_handle) {
        return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
    }
    // The private representation must be unavailable through Security.framework.
    if key.external_representation().is_some() {
        return Err(ProductDeviceKeyError::PlatformKeyOperationFailed);
    }
    Ok(ProductDeviceKeyDescription {
        key_handle: key_handle.to_owned(),
        public_key: public_jwk(key)?,
        key_algorithm: ES256_ALGORITHM,
        key_generation: 1,
        private_key_exportable: false,
        protection: "macos_keychain_software_non_exportable",
    })
}

fn der_integer(input: &[u8], offset: &mut usize) -> Result<[u8; 32], ProductDeviceKeyError> {
    if input.get(*offset) != Some(&0x02) {
        return Err(ProductDeviceKeyError::KeySignFailed);
    }
    *offset += 1;
    let length = *input
        .get(*offset)
        .ok_or(ProductDeviceKeyError::KeySignFailed)? as usize;
    *offset += 1;
    if length == 0 || length > 33 || *offset + length > input.len() {
        return Err(ProductDeviceKeyError::KeySignFailed);
    }
    let value = &input[*offset..*offset + length];
    *offset += length;
    let value = value.strip_prefix(&[0]).unwrap_or(value);
    if value.is_empty() || value.len() > 32 {
        return Err(ProductDeviceKeyError::KeySignFailed);
    }
    let mut output = [0_u8; 32];
    output[32 - value.len()..].copy_from_slice(value);
    Ok(output)
}

fn der_signature_to_raw(input: &[u8]) -> Result<Vec<u8>, ProductDeviceKeyError> {
    if input.len() < 8 || input[0] != 0x30 {
        return Err(ProductDeviceKeyError::KeySignFailed);
    }
    let sequence_length = input[1] as usize;
    let sequence_start = if sequence_length & 0x80 == 0 {
        if sequence_length + 2 != input.len() {
            return Err(ProductDeviceKeyError::KeySignFailed);
        }
        2
    } else {
        let count = sequence_length & 0x7f;
        if count == 0 || count > 2 || input.len() < 2 + count {
            return Err(ProductDeviceKeyError::KeySignFailed);
        }
        let mut length = 0_usize;
        for byte in &input[2..2 + count] {
            length = (length << 8) | usize::from(*byte);
        }
        if length + 2 + count != input.len() {
            return Err(ProductDeviceKeyError::KeySignFailed);
        }
        2 + count
    };
    let mut offset = sequence_start;
    let r = der_integer(input, &mut offset)?;
    let s = der_integer(input, &mut offset)?;
    if offset != input.len() {
        return Err(ProductDeviceKeyError::KeySignFailed);
    }
    let mut output = Vec::with_capacity(64);
    output.extend_from_slice(&r);
    output.extend_from_slice(&s);
    Ok(output)
}

fn key_attributes(
    key_handle: &str,
) -> Result<core_foundation::dictionary::CFDictionary, ProductDeviceKeyError> {
    let label = CFString::new(key_handle);
    let private_attributes = CFMutableDictionary::from_CFType_pairs(&[
        (
            unsafe { kSecAttrIsPermanent.to_void() },
            CFBoolean::true_value().to_void(),
        ),
        (
            unsafe { kSecAttrIsExtractable.to_void() },
            CFBoolean::false_value().to_void(),
        ),
        (unsafe { kSecAttrLabel.to_void() }, label.to_void()),
        (unsafe { kSecAttrAccessible.to_void() }, unsafe {
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.to_void()
        }),
        (
            unsafe { kSecAttrSynchronizable.to_void() },
            CFBoolean::false_value().to_void(),
        ),
    ]);
    let key_type = unsafe { CFString::wrap_under_get_rule(kSecAttrKeyTypeECSECPrimeRandom) };
    let key_size = CFNumber::from(256_i32);
    Ok(CFMutableDictionary::from_CFType_pairs(&[
        (unsafe { kSecAttrKeyType.to_void() }, key_type.to_void()),
        (
            unsafe { kSecAttrKeySizeInBits.to_void() },
            key_size.to_void(),
        ),
        (
            unsafe { kSecPrivateKeyAttrs.to_void() },
            private_attributes.to_void(),
        ),
    ])
    .to_immutable())
}

pub struct MacosKeychainProductDeviceKeyStore;

impl MacosKeychainProductDeviceKeyStore {
    pub fn new() -> Self {
        Self
    }
}

impl ProductDeviceKeyStore for MacosKeychainProductDeviceKeyStore {
    fn list_keys(&self) -> Result<Vec<ProductDeviceKeyDescription>, ProductDeviceKeyError> {
        let mut search = ItemSearchOptions::new();
        search
            .key_class(KeyClass::private())
            .cloud_sync(CloudSync::MatchSyncNo)
            .load_refs(true)
            .limit(Limit::All);
        let results = match search.search() {
            Ok(results) => results,
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => return Ok(Vec::new()),
            Err(error) => return Err(map_key_error(error)),
        };
        let mut descriptions = Vec::new();
        for result in results {
            let SearchResult::Ref(Reference::Key(key)) = result else {
                continue;
            };
            let Some(key_handle) = key_label(&key) else {
                continue;
            };
            if !key_handle.starts_with(KEY_HANDLE_PREFIX) {
                continue;
            }
            validate_key_handle(&key_handle)?;
            descriptions.push(description(&key_handle, &key)?);
        }
        descriptions.sort_by(|left, right| left.key_handle.cmp(&right.key_handle));
        Ok(descriptions)
    }

    fn create_key(&self) -> Result<ProductDeviceKeyDescription, ProductDeviceKeyError> {
        let key_handle = format!("{KEY_HANDLE_PREFIX}{}", Uuid::new_v4().simple());
        #[allow(deprecated)]
        let key = SecKey::generate(key_attributes(&key_handle)?)
            .map_err(|_| ProductDeviceKeyError::KeyGenerationFailed)?;
        match description(&key_handle, &key) {
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
        let key = open_key(key_handle)?;
        description(key_handle, &key)
    }

    fn sign(&self, key_handle: &str, payload: &[u8]) -> Result<Vec<u8>, ProductDeviceKeyError> {
        if payload.is_empty() || payload.len() > MAX_SIGNING_PAYLOAD_BYTES {
            return Err(ProductDeviceKeyError::InvalidPayload);
        }
        let key = open_key(key_handle)?;
        let digest = Sha256::digest(payload);
        let signature = key
            .create_signature(Algorithm::ECDSASignatureDigestX962SHA256, &digest)
            .map_err(|_| ProductDeviceKeyError::KeySignFailed)?;
        der_signature_to_raw(&signature)
    }

    fn destroy_key(&self, key_handle: &str) -> Result<(), ProductDeviceKeyError> {
        let key = open_key(key_handle)?;
        key.delete()
            .map_err(|error| map_security_error(error.code()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{Signature, VerifyingKey, signature::hazmat::PrehashVerifier};

    #[test]
    fn der_signature_normalizes_to_raw_es256() {
        let mut der = vec![0x30, 0x44, 0x02, 0x20];
        der.extend(1_u8..=32);
        der.extend([0x02, 0x20]);
        der.extend(33_u8..=64);
        let raw = der_signature_to_raw(&der).expect("valid DER signature");
        assert_eq!(raw.len(), 64);
        assert_eq!(&raw[..32], &(1_u8..=32).collect::<Vec<_>>());
        assert_eq!(&raw[32..], &(33_u8..=64).collect::<Vec<_>>());
    }

    #[test]
    fn macos_keychain_key_is_persistent_non_exportable_and_verifies() {
        let store = MacosKeychainProductDeviceKeyStore::new();
        let created = store.create_key().expect("create Keychain key");
        assert_eq!(created.key_algorithm, ES256_ALGORITHM);
        assert_eq!(created.key_generation, 1);
        assert!(!created.private_key_exportable);
        assert_eq!(created.protection, "macos_keychain_software_non_exportable");

        let loaded = MacosKeychainProductDeviceKeyStore::new()
            .public_key(&created.key_handle)
            .expect("reopen persisted key");
        assert_eq!(loaded.public_key, created.public_key);

        let second = store
            .create_key()
            .expect("create an independent disposable key");
        assert_ne!(second.public_key, created.public_key);

        let payload = b"protected-header.payload";
        let signature = store
            .sign(&created.key_handle, payload)
            .expect("sign payload");
        assert_eq!(signature.len(), 64);
        let mut point = Vec::with_capacity(65);
        point.push(4);
        point.extend(URL_SAFE_NO_PAD.decode(&created.public_key.x).unwrap());
        point.extend(URL_SAFE_NO_PAD.decode(&created.public_key.y).unwrap());
        let verifying_key = VerifyingKey::from_sec1_bytes(&point).unwrap();
        verifying_key
            .verify_prehash(
                &Sha256::digest(payload),
                &Signature::from_slice(&signature).unwrap(),
            )
            .expect("macOS signature verifies with existing ES256 verifier");

        let key = open_key(&created.key_handle).expect("open private key");
        assert!(key.external_representation().is_none());

        store
            .destroy_key(&created.key_handle)
            .expect("destroy disposable key");
        store
            .destroy_key(&second.key_handle)
            .expect("destroy independent disposable key");
        assert_eq!(
            store.public_key(&created.key_handle).unwrap_err(),
            ProductDeviceKeyError::KeyNotFound
        );
    }
}
