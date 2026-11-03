use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::DecodePublicKey,
};
use ring::{
    digest::{digest, SHA256},
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;

use crate::{DeviceSigner, MobileError};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_PROOF_BYTES: usize = 8 * 1024;

pub(crate) fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn decode(value: &str) -> Result<Vec<u8>, MobileError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| MobileError::protocol())?;
    if b64(&bytes) != value {
        return Err(MobileError::protocol());
    }
    Ok(bytes)
}

pub(crate) fn constant_eq(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    b64(digest(&SHA256, bytes).as_ref())
}

pub(crate) fn digest_string(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256(bytes))
}

pub fn canonical_json(value: &Value) -> Result<Vec<u8>, MobileError> {
    fn write(value: &Value, out: &mut Vec<u8>) -> Result<(), MobileError> {
        match value {
            Value::Object(fields) => {
                let mut sorted: Vec<_> = fields.iter().collect();
                // JavaScript sorts property names by UTF-16 code unit.
                sorted
                    .sort_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
                out.push(b'{');
                for (index, (key, value)) in sorted.into_iter().enumerate() {
                    if index != 0 {
                        out.push(b',');
                    }
                    serde_json::to_writer(&mut *out, key).map_err(|_| MobileError::protocol())?;
                    out.push(b':');
                    write(value, out)?;
                }
                out.push(b'}');
            }
            Value::Array(values) => {
                out.push(b'[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        out.push(b',');
                    }
                    write(value, out)?;
                }
                out.push(b']');
            }
            Value::Number(number) => {
                if let Some(integer) = number
                    .as_i64()
                    .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER)
                {
                    out.extend_from_slice(integer.to_string().as_bytes());
                } else if let Some(float) = number
                    .as_f64()
                    .filter(|n| n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER as f64)
                {
                    out.extend_from_slice((float as i64).to_string().as_bytes());
                } else {
                    return Err(MobileError::protocol());
                }
            }
            _ => serde_json::to_writer(out, value).map_err(|_| MobileError::protocol())?,
        }
        Ok(())
    }

    let mut out = Vec::new();
    write(value, &mut out)?;
    Ok(out)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Jwk {
    kty: String,
    crv: String,
    x: String,
    y: String,
}

pub(crate) fn jwk_verifier(jwk: &Value) -> Result<VerifyingKey, MobileError> {
    let data: Jwk = serde_json::from_value(jwk.clone()).map_err(|_| MobileError::identity())?;
    let x = decode(&data.x)?;
    let y = decode(&data.y)?;
    if data.kty != "EC" || data.crv != "P-256" || x.len() != 32 || y.len() != 32 {
        return Err(MobileError::identity());
    }
    let mut point = [0; 65];
    point[0] = 4;
    point[1..33].copy_from_slice(&x);
    point[33..].copy_from_slice(&y);
    VerifyingKey::from_sec1_bytes(&point).map_err(|_| MobileError::identity())
}

pub(crate) fn verify_raw_signature(
    key: &VerifyingKey,
    message: &[u8],
    signature: &str,
) -> Result<(), MobileError> {
    let bytes = decode(signature)?;
    let signature = Signature::from_slice(&bytes).map_err(|_| MobileError::identity())?;
    key.verify(message, &signature)
        .map_err(|_| MobileError::identity())
}

pub(crate) fn verify_spki_signature(
    spki: &[u8],
    message: &[u8],
    signature: &str,
) -> Result<(), MobileError> {
    let key = VerifyingKey::from_public_key_der(spki).map_err(|_| MobileError::identity())?;
    verify_raw_signature(&key, message, signature)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtectedHeader {
    alg: String,
    typ: String,
}

pub(crate) fn verify_proof(
    key: &VerifyingKey,
    proof: &str,
    expected_type: &str,
    expected_payload: &[u8],
) -> Result<(), MobileError> {
    if proof.len() > MAX_PROOF_BYTES {
        return Err(MobileError::identity());
    }
    let mut parts = proof.split('.');
    let header = parts.next().ok_or_else(MobileError::identity)?;
    let payload = parts.next().ok_or_else(MobileError::identity)?;
    let signature = parts.next().ok_or_else(MobileError::identity)?;
    if parts.next().is_some() {
        return Err(MobileError::identity());
    }
    let fields: ProtectedHeader =
        serde_json::from_slice(&decode(header)?).map_err(|_| MobileError::identity())?;
    if fields.alg != "ES256"
        || fields.typ != expected_type
        || !bool::from(decode(payload)?.as_slice().ct_eq(expected_payload))
    {
        return Err(MobileError::identity());
    }
    verify_raw_signature(key, format!("{header}.{payload}").as_bytes(), signature)
}

pub(crate) fn sign_proof(
    proof_type: &str,
    payload: &Value,
    signer: &dyn DeviceSigner,
) -> Result<String, MobileError> {
    // Preserve the protected header bytes used by the TypeScript client.
    let quoted_type = serde_json::to_string(proof_type).map_err(|_| MobileError::protocol())?;
    let header = b64(format!(r#"{{"alg":"ES256","typ":{quoted_type}}}"#).as_bytes());
    let payload = b64(&canonical_json(payload)?);
    let input = format!("{header}.{payload}");
    let der = signer.sign_der(input.as_bytes().to_vec())?;
    let signature = Signature::from_der(&der).map_err(|_| MobileError::code("signing_failed"))?;
    let proof = format!("{input}.{}", b64(&signature.to_bytes()));
    if proof.len() > MAX_PROOF_BYTES {
        return Err(MobileError::protocol());
    }
    Ok(proof)
}

pub(crate) fn nonce() -> Result<String, MobileError> {
    let mut bytes = [0; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| MobileError::code("entropy_unavailable"))?;
    Ok(b64(&bytes))
}

pub(crate) fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

pub(crate) fn request_proof(
    access_token: &str,
    device_id: &str,
    key_generation: u64,
    method: &str,
    resource: &str,
    body: &[u8],
    signer: &dyn DeviceSigner,
) -> Result<String, MobileError> {
    if access_token.is_empty()
        || access_token.len() > 16 * 1024
        || !crate::wire::valid_id(device_id, "dev_", 16)
        || key_generation == 0
        || key_generation > MAX_SAFE_INTEGER
        || method.is_empty()
        || method.len() > 12
        || !method.bytes().all(|byte| byte.is_ascii_uppercase())
        || !resource.starts_with("/v1/")
        || resource.len() > 2048
        || resource.chars().any(char::is_control)
    {
        return Err(MobileError::protocol());
    }
    sign_proof(
        "codetether-device-proof+jws",
        &json!({
            "v": 1,
            "aud": "codetether-control-plane",
            "authTokenHash": digest_string(access_token.as_bytes()),
            "deviceId": device_id,
            "keyGeneration": key_generation,
            "method": method,
            "resource": resource,
            "bodySha256": digest_string(body),
            "nonce": nonce()?,
            "iat": now(),
            "protocolVersion": 1,
        }),
        signer,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_matches_node_fixed_vector() {
        let value = json!({"b":[null,true,1.0,-0.0,"中"],"a":"\\\n","\u{10000}":1,"\u{e000}":2});
        let expected = "{\"a\":\"\\\\\\n\",\"b\":[null,true,1,0,\"中\"],\"𐀀\":1,\"\u{e000}\":2}";
        assert_eq!(canonical_json(&value).unwrap(), expected.as_bytes());
        assert!(canonical_json(&json!(9007199254740992_u64)).is_err());
        assert!(canonical_json(&json!(0.5)).is_err());
    }

    #[test]
    fn es256_der_to_jws_matches_node_fixed_vector() {
        // The Node fixture used a fresh test key. Only the public JWK and signature
        // are retained, including the DER sign padding on both 32-byte limbs.
        const INPUT: &str = "eyJhbGciOiJFUzI1NiIsInR5cCI6ImNvZGV0ZXRoZXItZGV2aWNlLXJlZ2lzdHJhdGlvbitqd3MifQ.eyJmaXh0dXJlIjoi5Zu65a6a5ZCR6YePIiwidiI6MX0";
        const DER_HEX: &str = "3046022100c3b18ff342d6aa5d5722b6abe1cf7bc19e67f78c45959d1888db44148ba03a1b022100daf7ca4dc39669c87a82b0a656474ca78dae71d1e6a530a57d6770ea0893090e";
        const RAW_HEX: &str = "c3b18ff342d6aa5d5722b6abe1cf7bc19e67f78c45959d1888db44148ba03a1bdaf7ca4dc39669c87a82b0a656474ca78dae71d1e6a530a57d6770ea0893090e";
        fn hex(value: &str) -> Vec<u8> {
            (0..value.len())
                .step_by(2)
                .map(|offset| u8::from_str_radix(&value[offset..offset + 2], 16).unwrap())
                .collect()
        }
        struct FixtureSigner;
        impl DeviceSigner for FixtureSigner {
            fn sign_der(&self, message: Vec<u8>) -> Result<Vec<u8>, MobileError> {
                assert_eq!(message, INPUT.as_bytes());
                Ok(hex(DER_HEX))
            }
        }
        let public_key = jwk_verifier(&json!({
            "kty":"EC","crv":"P-256",
            "x":"sYZvDjH4yh6w4t_UaV5_ZgbGqXD0ubyNEruA9ZXLnBM",
            "y":"IWCQ38ycvGRMEkNUpo1bYOu3PXxScTZgV7Tm0PwBH0U"
        }))
        .unwrap();
        let proof_type = "codetether-device-registration+jws";
        let payload = json!({"v":1,"fixture":"固定向量"});
        let proof = sign_proof(proof_type, &payload, &FixtureSigner).unwrap();
        assert_eq!(proof, format!("{INPUT}.{}", b64(&hex(RAW_HEX))));
        verify_proof(
            &public_key,
            &proof,
            proof_type,
            &canonical_json(&payload).unwrap(),
        )
        .unwrap();
        assert!(verify_proof(&public_key, &proof, proof_type, b"{}").is_err());
    }
}
