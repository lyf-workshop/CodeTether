//! Purpose-limited signing over the owned Host child pipe, never a renderer IPC.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PREFIX: &str = "host-presence-sign ";
const TYPE: &str = "codetether-host-supervisor-transport+jws";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    id: String,
    key_handle: String,
    payload: Value,
    signing_input: String,
}

pub(crate) fn respond(line: &str) -> Option<String> {
    let body = line.strip_prefix(PREFIX)?;
    eprintln!(
        "{}",
        json!({
            "component": "desktop",
            "event": "host_presence_sign_request",
            "bodyBytes": body.len(),
        })
    );
    // Intercept even malformed requests BEFORE normal Host log forwarding.
    let result = (|| {
        if body.len() > 8192 {
            return None;
        }
        let request: Request = serde_json::from_str(body).ok()?;
        if uuid::Uuid::parse_str(&request.id).is_err() {
            return None;
        }
        let signature = match sign(&request) {
            Ok(signature) => Some(signature),
            Err(category) => {
                eprintln!(
                    "{}",
                    json!({
                        "component": "desktop",
                        "event": "host_presence_sign",
                        "result": "error",
                        "category": category,
                    })
                );
                None
            }
        };
        Some(format!(
            "host-presence-signature {}\n",
            json!({ "id": request.id, "signature": signature })
        ))
    })();
    Some(result.unwrap_or_default())
}

fn validate(request: &Request) -> Result<(), &'static str> {
    let p = &request.payload;
    let fields = [
        "v",
        "aud",
        "purpose",
        "hostId",
        "hostFingerprint",
        "hostIdentityGeneration",
        "spaceId",
        "transportTlsFingerprint",
        "controlPlaneOrigin",
        "directEndpoints",
        "relay",
        "iat",
        "exp",
        "protocolVersion",
    ];
    let object = p.as_object().ok_or("request_validation")?;
    if object.len() != fields.len()
        || fields.iter().any(|f| !object.contains_key(*f))
        || p["v"] != 1
        || p["protocolVersion"] != 2
        || p["aud"] != "codetether-host-supervisor"
        || p["purpose"] != "host_supervisor_presence"
        || p["hostIdentityGeneration"].as_u64().is_none()
        || !p["hostId"]
            .as_str()
            .is_some_and(|s| s.starts_with("host_") && s.len() <= 101)
        || !p["spaceId"]
            .as_str()
            .is_some_and(|s| s.starts_with("space_") && s.len() <= 102)
    {
        return Err("request_validation");
    }
    let iat = p["iat"].as_u64().ok_or("request_validation")?;
    let exp = p["exp"].as_u64().ok_or("request_validation")?;
    if exp <= iat || exp - iat > 600 {
        return Err("request_validation");
    }
    // Reconstruct the exact RFC 8785-like constrained JSON form used by the
    // TypeScript supervisor package. serde_json preserves input object order,
    // which is not the canonical order used by the JWS signing input.
    let header = URL_SAFE_NO_PAD.encode(
        canonical_json_bytes(&json!({
            "alg": "ES256",
            "typ": TYPE,
        }))
        .map_err(|_| "canonical_json")?,
    );
    let payload = URL_SAFE_NO_PAD.encode(canonical_json_bytes(p).map_err(|_| "canonical_json")?);
    if request.signing_input != format!("{header}.{payload}") || request.signing_input.len() > 4096
    {
        return Err("canonical_mismatch");
    }
    Ok(())
}

fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, ()> {
    let mut output = String::new();
    write_canonical_json(&mut output, value)?;
    Ok(output.into_bytes())
}

fn write_canonical_json(output: &mut String, value: &Value) -> Result<(), ()> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => output.push_str(&serde_json::to_string(value).map_err(|_| ())?),
        Value::String(value) => output.push_str(&serde_json::to_string(value).map_err(|_| ())?),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_json(output, value)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            output.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key).map_err(|_| ())?);
                output.push(':');
                write_canonical_json(output, &values[key])?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn sign(request: &Request) -> Result<String, &'static str> {
    validate(request)?;
    eprintln!(
        "{}",
        json!({
            "component": "desktop",
            "event": "host_presence_sign_stage",
            "stage": "before_host_key_public",
        })
    );
    let description = match crate::host_identity_key_store::host_identity_key_public(
        request.key_handle.clone(),
    ) {
        Ok(description) => {
            eprintln!(
                "{}",
                json!({
                    "component": "desktop",
                    "event": "host_presence_sign_stage",
                    "stage": "after_host_key_public",
                    "result": "ok",
                })
            );
            description
        }
        Err(_) => {
            eprintln!(
                "{}",
                json!({
                    "component": "desktop",
                    "event": "host_presence_sign_stage",
                    "stage": "after_host_key_public",
                    "result": "error",
                })
            );
            return Err("host_key_public");
        }
    };
    let description = serde_json::to_value(description).map_err(|_| "serialization")?;
    if description["privateKeyExportable"] != false || description["keyAlgorithm"] != "ES256" {
        return Err("host_key_policy");
    }
    let public = serde_json::to_vec(&description["publicKey"]).map_err(|_| "serialization")?;
    let fingerprint = format!("sha256:{}", URL_SAFE_NO_PAD.encode(Sha256::digest(public)));
    if request.payload["hostFingerprint"] != fingerprint
        || request.payload["hostIdentityGeneration"] != description["keyGeneration"]
    {
        return Err("host_identity_mismatch");
    }
    eprintln!(
        "{}",
        json!({
            "component": "desktop",
            "event": "host_presence_sign_stage",
            "stage": "before_host_key_sign",
        })
    );
    let result = match crate::host_identity_key_store::host_identity_key_sign(
        request.key_handle.clone(),
        URL_SAFE_NO_PAD.encode(request.signing_input.as_bytes()),
    ) {
        Ok(result) => {
            eprintln!(
                "{}",
                json!({
                    "component": "desktop",
                    "event": "host_presence_sign_stage",
                    "stage": "after_host_key_sign",
                    "result": "ok",
                })
            );
            result
        }
        Err(_) => {
            eprintln!(
                "{}",
                json!({
                    "component": "desktop",
                    "event": "host_presence_sign_stage",
                    "stage": "after_host_key_sign",
                    "result": "error",
                })
            );
            return Err("host_key_sign");
        }
    };
    let result = serde_json::to_value(result).map_err(|_| "serialization")?;
    result["signatureBase64Url"]
        .as_str()
        .map(str::to_owned)
        .ok_or("signature_output")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_presence_only_and_lease_bounds() {
        let payload = json!({"v":1,"aud":"codetether-host-supervisor","purpose":"host_supervisor_presence",
            "hostId":"host_0123456789abcdef0123456789abcdef","hostFingerprint":"sha256:fixture",
            "hostIdentityGeneration":1,"spaceId":"space_0123456789abcdef0123456789abcdef",
            "transportTlsFingerprint":"fixture","controlPlaneOrigin":"https://example.test",
            "directEndpoints":[{"host":"192.0.2.7","port":4318}],"relay":null,"iat":1000,"exp":1600,"protocolVersion":2});
        let encoded = format!(
            "{}.{}",
            URL_SAFE_NO_PAD
                .encode(canonical_json_bytes(&json!({"alg":"ES256","typ":TYPE})).unwrap()),
            URL_SAFE_NO_PAD.encode(canonical_json_bytes(&payload).unwrap())
        );
        let mut request = Request {
            id: uuid::Uuid::new_v4().to_string(),
            key_handle: "CodeTether.HostIdentity.fixture".into(),
            payload,
            signing_input: encoded,
        };
        assert!(validate(&request).is_ok());
        request.signing_input.push('x');
        assert!(validate(&request).is_err());
        request.payload["exp"] = json!(2099000000u64);
        assert!(validate(&request).is_err());
    }
    #[test]
    fn pipe_signer_never_accepts_account_or_grant_signing() {
        let request = Request {
            id: uuid::Uuid::new_v4().to_string(),
            key_handle: "CodeTether.ProductDevice.forbidden".into(),
            payload: json!({"purpose":"host_supervisor_grant"}),
            signing_input: "arbitrary".into(),
        };
        assert!(validate(&request).is_err());
        assert!(respond("ordinary host log").is_none());
        assert_eq!(
            respond("host-presence-sign sensitive-malformed"),
            Some(String::new())
        );
    }

    #[test]
    fn canonical_presence_accepts_runtime_field_order() {
        let payload = json!({
            "v": 1,
            "aud": "codetether-host-supervisor",
            "purpose": "host_supervisor_presence",
            "hostId": "host_0123456789abcdef0123456789abcdef",
            "hostFingerprint": "sha256:fixture",
            "hostIdentityGeneration": 1,
            "spaceId": "space_0123456789abcdef0123456789abcdef",
            "controlPlaneOrigin": "https://example.test",
            "transportTlsFingerprint": "fixture",
            "directEndpoints": [{"port": 4318, "host": "192.0.2.7"}],
            "relay": null,
            "iat": 1000,
            "exp": 1600,
            "protocolVersion": 2,
        });
        let signing_input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD
                .encode(canonical_json_bytes(&json!({"typ": TYPE, "alg": "ES256"})).unwrap()),
            URL_SAFE_NO_PAD.encode(canonical_json_bytes(&payload).unwrap())
        );
        let request = Request {
            id: uuid::Uuid::new_v4().to_string(),
            key_handle: "CodeTether.HostIdentity.fixture".into(),
            payload,
            signing_input,
        };
        assert!(validate(&request).is_ok());
    }
}
