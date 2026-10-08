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
    // Intercept even malformed requests BEFORE normal Host log forwarding.
    let result = (|| {
        if body.len() > 8192 {
            return None;
        }
        let request: Request = serde_json::from_str(body).ok()?;
        if uuid::Uuid::parse_str(&request.id).is_err() {
            return None;
        }
        let signature = sign(&request).ok();
        Some(format!(
            "host-presence-signature {}\n",
            json!({ "id": request.id, "signature": signature })
        ))
    })();
    Some(result.unwrap_or_default())
}

fn validate(request: &Request) -> Result<(), ()> {
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
    let object = p.as_object().ok_or(())?;
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
        return Err(());
    }
    let iat = p["iat"].as_u64().ok_or(())?;
    let exp = p["exp"].as_u64().ok_or(())?;
    if exp <= iat || exp - iat > 600 {
        return Err(());
    }
    // serde_json's default ordered object map is the existing canonical sorted
    // JSON convention. The native signer reconstructs, not trusts, JWS bytes.
    let header = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&json!({"alg":"ES256", "typ":TYPE})).map_err(|_| ())?);
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(p).map_err(|_| ())?);
    if request.signing_input != format!("{header}.{payload}") || request.signing_input.len() > 4096
    {
        return Err(());
    }
    Ok(())
}

fn sign(request: &Request) -> Result<String, ()> {
    validate(request)?;
    let description =
        crate::host_identity_key_store::host_identity_key_public(request.key_handle.clone())
            .map_err(|_| ())?;
    let description = serde_json::to_value(description).map_err(|_| ())?;
    if description["privateKeyExportable"] != false || description["keyAlgorithm"] != "ES256" {
        return Err(());
    }
    let public = serde_json::to_vec(&description["publicKey"]).map_err(|_| ())?;
    let fingerprint = format!("sha256:{}", URL_SAFE_NO_PAD.encode(Sha256::digest(public)));
    if request.payload["hostFingerprint"] != fingerprint
        || request.payload["hostIdentityGeneration"] != description["keyGeneration"]
    {
        return Err(());
    }
    let result = crate::host_identity_key_store::host_identity_key_sign(
        request.key_handle.clone(),
        URL_SAFE_NO_PAD.encode(request.signing_input.as_bytes()),
    )
    .map_err(|_| ())?;
    let result = serde_json::to_value(result).map_err(|_| ())?;
    result["signatureBase64Url"]
        .as_str()
        .map(str::to_owned)
        .ok_or(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
