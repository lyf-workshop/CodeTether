use std::{net::IpAddr, time::Duration};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::timeout;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use uuid::{Uuid, Variant};

use crate::{crypto, relay, tls, ConnectOptions, ConnectionMode, DeviceSigner, MobileError};

pub(crate) const HOST_FRAME_BYTES: usize = 16 * 1024;
pub(crate) const MESSAGE_TIMEOUT: Duration = Duration::from_secs(8);
const AUDIENCE: &str = "codetether-host-supervisor";
const CLOCK_SKEW_SECONDS: i64 = 120;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) fn frames<T: tls::Io>(stream: T, max: usize) -> Framed<T, LengthDelimitedCodec> {
    LengthDelimitedCodec::builder()
        .max_frame_length(max)
        .new_framed(stream)
}

pub(crate) async fn send<T: tls::Io>(
    frames: &mut Framed<T, LengthDelimitedCodec>,
    message: &Value,
) -> Result<(), MobileError> {
    let bytes = serde_json::to_vec(message).map_err(|_| MobileError::protocol())?;
    timeout(MESSAGE_TIMEOUT, frames.send(Bytes::from(bytes)))
        .await
        .map_err(|_| MobileError::code("remote_host_unreachable"))?
        .map_err(|_| MobileError::code("connection_closed"))
}

pub(crate) async fn receive<T: tls::Io>(
    frames: &mut Framed<T, LengthDelimitedCodec>,
    budget: Duration,
) -> Result<Value, MobileError> {
    timeout(budget, read(frames))
        .await
        .map_err(|_| MobileError::code("remote_host_unreachable"))?
}

pub(crate) async fn read<T: tls::Io>(
    frames: &mut Framed<T, LengthDelimitedCodec>,
) -> Result<Value, MobileError> {
    let bytes = frames
        .next()
        .await
        .ok_or_else(|| MobileError::code("connection_closed"))?
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::InvalidData {
                MobileError::protocol()
            } else {
                MobileError::code("connection_closed")
            }
        })?;
    serde_json::from_slice(&bytes).map_err(|_| MobileError::protocol())
}

pub(crate) fn parse<T: DeserializeOwned>(value: Value) -> Result<T, MobileError> {
    serde_json::from_value(value).map_err(|_| MobileError::protocol())
}

pub(crate) fn valid_id(value: &str, prefix: &str, minimum: usize) -> bool {
    value.strip_prefix(prefix).is_some_and(|tail| {
        (minimum..=96).contains(&tail.len())
            && tail.as_bytes()[0].is_ascii_alphanumeric()
            && is_url_token(tail)
    })
}

fn is_url_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub(crate) fn valid_pin(value: &str) -> bool {
    value.len() == 43 && crypto::decode(value).is_ok_and(|bytes| bytes.len() == 32)
}

fn digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(valid_pin)
}

fn generation(value: u64) -> bool {
    (1..=MAX_SAFE_INTEGER).contains(&value)
}

pub(crate) fn date(value: &str) -> Result<i64, MobileError> {
    if value.len() > 64 {
        return Err(MobileError::protocol());
    }
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map(|date| date.unix_timestamp())
        .map_err(|_| MobileError::protocol())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grant {
    v: u8,
    aud: String,
    purpose: String,
    authorization_id: String,
    host_id: String,
    host_fingerprint: String,
    host_identity_generation: u64,
    device_id: String,
    device_fingerprint: String,
    device_key_generation: u64,
    user_id: String,
    space_id: String,
    scope: String,
    authorization_serial: String,
    authorization_generation: u64,
    issued_at: i64,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Endpoint {
    host: String,
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RelayDescriptor {
    pub endpoint: String,
    pub relay_id: String,
    pub relay_fingerprint: String,
    pub rendezvous_id: String,
    pub rendezvous_capability: String,
    pub host_transport_fingerprint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    v: u8,
    aud: String,
    purpose: String,
    host_id: String,
    host_fingerprint: String,
    host_identity_generation: u64,
    space_id: Option<String>,
    authorization_id: Option<String>,
    grant_digest: Option<String>,
    device_id: Option<String>,
    device_key_generation: Option<u64>,
    transport_tls_fingerprint: String,
    control_plane_origin: String,
    direct_endpoints: Vec<Endpoint>,
    relay: Option<RelayDescriptor>,
    iat: i64,
    exp: i64,
    protocol_version: u8,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Signed {
    payload: Value,
    proof: String,
}

pub(crate) struct Connection {
    grant: Grant,
    descriptor: Descriptor,
}

impl Connection {
    pub fn validate(options: &ConnectOptions) -> Result<Self, MobileError> {
        if options.host_public_jwk_json.len() > 512
            || options.grant_json.len() > HOST_FRAME_BYTES
            || options.descriptor_json.len() > 32 * 1024
            || options.access_token.is_empty()
            || options.access_token.len() > 16 * 1024
        {
            return Err(MobileError::code("invalid_request"));
        }
        let jwk = serde_json::from_str(&options.host_public_jwk_json)
            .map_err(|_| MobileError::identity())?;
        let host_key = crypto::jwk_verifier(&jwk)?;
        if !crypto::constant_eq(
            &crypto::digest_string(&crypto::canonical_json(&jwk)?),
            &options.host_fingerprint,
        ) {
            return Err(MobileError::identity());
        }
        let grant: Signed =
            serde_json::from_str(&options.grant_json).map_err(|_| MobileError::identity())?;
        let grant_bytes = crypto::canonical_json(&grant.payload)?;
        crypto::verify_proof(
            &host_key,
            &grant.proof,
            "codetether-host-supervisor-grant+jws",
            &grant_bytes,
        )?;
        let grant: Grant = parse(grant.payload)?;

        let descriptor: Signed =
            serde_json::from_str(&options.descriptor_json).map_err(|_| MobileError::identity())?;
        crypto::verify_proof(
            &host_key,
            &descriptor.proof,
            "codetether-host-supervisor-transport+jws",
            &crypto::canonical_json(&descriptor.payload)?,
        )?;
        let descriptor_fields = descriptor
            .payload
            .as_object()
            .ok_or_else(MobileError::identity)?;
        if !descriptor_fields.contains_key("relay") {
            return Err(MobileError::identity());
        }
        let descriptor: Descriptor = parse(descriptor.payload.clone())?;
        let now = crypto::now();
        if grant.v != 1
            || grant.aud != AUDIENCE
            || grant.purpose != "host_supervisor_grant"
            || !valid_id(&grant.authorization_id, "hauth_", 16)
            || !valid_id(&grant.host_id, "host_", 16)
            || !valid_id(&grant.device_id, "dev_", 16)
            || !valid_id(&grant.user_id, "usr_", 16)
            || !valid_id(&grant.space_id, "space_", 16)
            || !digest(&grant.device_fingerprint)
            || !generation(grant.host_identity_generation)
            || !generation(grant.device_key_generation)
            || !generation(grant.authorization_generation)
            || !matches!(
                grant.scope.as_str(),
                "supervisor_read" | "supervisor_control"
            )
            || grant.authorization_serial.is_empty()
            || grant.authorization_serial.len() > 20
            || (grant.authorization_serial.starts_with('0') && grant.authorization_serial.len() > 1)
            || !grant
                .authorization_serial
                .bytes()
                .all(|byte| byte.is_ascii_digit())
            || grant.issued_at < 0
            || grant.issued_at > now + CLOCK_SKEW_SECONDS
            || grant.expires_at <= grant.issued_at
            || grant.host_id != options.host_id
            || grant.host_fingerprint != options.host_fingerprint
            || grant.host_identity_generation != options.host_identity_generation
            || grant.device_id != options.device_id
            || grant.device_key_generation != options.device_key_generation
            || descriptor.v != 1
            || descriptor.aud != AUDIENCE
            || descriptor.host_id != options.host_id
            || descriptor.host_fingerprint != options.host_fingerprint
            || descriptor.host_identity_generation != options.host_identity_generation
            || descriptor.iat < 0
            || descriptor.iat > now + CLOCK_SKEW_SECONDS
            || descriptor.exp <= descriptor.iat
            || descriptor.exp <= now
            || !valid_pin(&descriptor.transport_tls_fingerprint)
            || descriptor.control_plane_origin.len() > 2048
            || url::Url::parse(&descriptor.control_plane_origin).is_err()
            || descriptor.direct_endpoints.len() > 8
            || (descriptor.direct_endpoints.is_empty() && descriptor.relay.is_none())
            || descriptor
                .direct_endpoints
                .iter()
                .any(|ep| !valid_hostname(&ep.host) || matches!(ep.port, 0 | 4317))
        {
            return Err(MobileError::identity());
        }
        if grant.expires_at <= now {
            return Err(MobileError::code("authorization_revoked"));
        }

        let matches_purpose = match descriptor.purpose.as_str() {
            "host_supervisor_presence" => {
                descriptor.protocol_version == 2
                    && descriptor.space_id.as_deref() == Some(&grant.space_id)
                    && ![
                        "authorizationId",
                        "grantDigest",
                        "deviceId",
                        "deviceKeyGeneration",
                    ]
                    .iter()
                    .any(|key| descriptor_fields.contains_key(*key))
            }
            "host_supervisor_transport" => {
                descriptor.protocol_version == 1
                    && !descriptor_fields.contains_key("spaceId")
                    && descriptor.authorization_id.as_deref() == Some(&grant.authorization_id)
                    && descriptor.grant_digest.as_deref()
                        == Some(crypto::digest_string(&grant_bytes).as_str())
                    && descriptor.device_id.as_deref() == Some(&grant.device_id)
                    && descriptor.device_key_generation == Some(grant.device_key_generation)
            }
            _ => false,
        };
        if !matches_purpose {
            return Err(MobileError::identity());
        }
        if let Some(relay) = &descriptor.relay {
            if relay.endpoint.len() > 2048
                || !valid_id(&relay.relay_id, "relay_", 16)
                || !valid_id(&relay.rendezvous_id, "srv_", 16)
                || !valid_pin(&relay.relay_fingerprint)
                || !valid_pin(&relay.rendezvous_capability)
                || relay.host_transport_fingerprint != descriptor.transport_tls_fingerprint
            {
                return Err(MobileError::identity());
            }
        }
        Ok(Self { grant, descriptor })
    }

    pub async fn open(&self, mode: ConnectionMode) -> Result<PendingAdmission, MobileError> {
        let identity = tls::TransportIdentity::generate()?;
        if mode != ConnectionMode::Relay {
            for endpoint in &self.descriptor.direct_endpoints {
                let host = endpoint.host.trim_start_matches('[').trim_end_matches(']');
                if mode == ConnectionMode::Auto && is_loopback(host) {
                    continue;
                }
                let result = async {
                    let tcp = tls::tcp(host, endpoint.port).await?;
                    let stream = tls::connect(
                        tcp,
                        host,
                        tls::SUPERVISOR_ALPN,
                        Some(&self.descriptor.transport_tls_fingerprint),
                        Some(&identity),
                    )
                    .await?;
                    self.challenge(stream, "direct").await
                }
                .await;
                match result {
                    Ok(pending) => return Ok(pending),
                    Err(error) if error.error_code() == "remote_host_unreachable" => {}
                    Err(error) => return Err(error),
                }
            }
        }
        if mode != ConnectionMode::Direct {
            if let Some(descriptor) = &self.descriptor.relay {
                let tunnel = relay::open(descriptor, &identity).await?;
                let stream = tls::connect(
                    tunnel,
                    "supervisor.codetether.invalid",
                    tls::SUPERVISOR_ALPN,
                    Some(&self.descriptor.transport_tls_fingerprint),
                    Some(&identity),
                )
                .await?;
                return self.challenge(stream, "relay").await;
            }
        }
        Err(MobileError::code("remote_host_unreachable"))
    }

    async fn challenge<T: tls::Io + 'static>(
        &self,
        stream: tokio_rustls::client::TlsStream<T>,
        transport: &'static str,
    ) -> Result<PendingAdmission, MobileError> {
        let exporter = tls::exporter(&stream)?;
        let stream: Box<dyn tls::Io> = Box::new(stream);
        let mut wire = frames(stream, HOST_FRAME_BYTES);
        if self.descriptor.purpose == "host_supervisor_presence" {
            send(
                &mut wire,
                &json!({
                    "type": "supervisor.select", "protocolVersion": 1,
                    "authorizationId": self.grant.authorization_id
                }),
            )
            .await?;
        }
        let first = receive(&mut wire, MESSAGE_TIMEOUT).await?;
        reject_handshake(&first)?;
        let now = crypto::now();
        let challenge: Challenge = parse(first.clone())?;
        if challenge.kind != "supervisor.challenge"
            || challenge.protocol_version != 1
            || challenge.audience != AUDIENCE
            || !valid_id(&challenge.session_id, "ssn_", 16)
            || challenge.host_id != self.grant.host_id
            || challenge.host_identity_generation != self.grant.host_identity_generation
            || challenge.device_id != self.grant.device_id
            || challenge.device_key_generation != self.grant.device_key_generation
            || challenge.authorization_id != self.grant.authorization_id
            || !valid_pin(&challenge.nonce)
            || !crypto::constant_eq(&challenge.tls_exporter, &exporter)
            || date(&challenge.issued_at)? > now + CLOCK_SKEW_SECONDS
            || date(&challenge.expires_at)? <= now
        {
            return Err(MobileError::identity());
        }
        Ok(PendingAdmission {
            wire,
            session_id: challenge.session_id,
            challenge_bytes: crypto::canonical_json(&first)?,
            transport,
        })
    }

    pub async fn authenticate(
        &self,
        pending: PendingAdmission,
        access_token: &str,
        signer: &dyn DeviceSigner,
    ) -> Result<Admission, MobileError> {
        let PendingAdmission {
            mut wire,
            session_id,
            challenge_bytes,
            transport,
        } = pending;
        let now = crypto::now();
        if self.grant.expires_at <= now {
            return Err(MobileError::code("authorization_revoked"));
        }
        if self.descriptor.exp <= now {
            return Err(MobileError::identity());
        }
        let proof = crypto::request_proof(
            access_token,
            &self.grant.device_id,
            self.grant.device_key_generation,
            "POST",
            &format!("/v1/hosts/{}/supervisor-admission", self.grant.host_id),
            &challenge_bytes,
            signer,
        )?;
        send(
            &mut wire,
            &json!({
                "type": "supervisor.authenticate", "protocolVersion": 1,
                "accessToken": access_token, "deviceProof": proof
            }),
        )
        .await?;
        let response = receive(&mut wire, MESSAGE_TIMEOUT).await?;
        reject_handshake(&response)?;
        let admitted: Authenticated = parse(response)?;
        let expires_unix = date(&admitted.expires_at)?;
        if admitted.kind != "supervisor.authenticated"
            || admitted.protocol_version != 1
            || admitted.session_id != session_id
            || admitted.host_id != self.grant.host_id
            || admitted.device_id != self.grant.device_id
            || admitted.authorization_id != self.grant.authorization_id
            || expires_unix <= now
            || expires_unix > now + 300 + CLOCK_SKEW_SECONDS
            || !matches!(
                (admitted.control.as_str(), self.grant.scope.as_str()),
                ("read", "supervisor_read") | ("control", "supervisor_control")
            )
        {
            return Err(MobileError::identity());
        }
        Ok(Admission {
            wire: Session(wire),
            transport,
            control: admitted.control == "control",
            expires_at: admitted.expires_at,
            expires_unix,
        })
    }
}

fn valid_hostname(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '/' | '\\' | '@'))
}

fn is_loopback(value: &str) -> bool {
    let value = value.trim_end_matches('.');
    value.eq_ignore_ascii_case("localhost")
        || value.parse::<IpAddr>().is_ok_and(|ip| match ip {
            IpAddr::V4(ip) => ip.is_loopback(),
            IpAddr::V6(ip) => {
                ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|ip| ip.is_loopback())
            }
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Challenge {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    audience: String,
    session_id: String,
    authorization_id: String,
    host_id: String,
    host_identity_generation: u64,
    device_id: String,
    device_key_generation: u64,
    tls_exporter: String,
    nonce: String,
    issued_at: String,
    expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Authenticated {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    session_id: String,
    host_id: String,
    device_id: String,
    authorization_id: String,
    control: String,
    expires_at: String,
}

fn reject_handshake(frame: &Value) -> Result<(), MobileError> {
    if frame["type"] != "supervisor.rejected" {
        return Ok(());
    }
    if frame["protocolVersion"] != 1 || frame.as_object().is_none_or(|value| value.len() != 3) {
        return Err(MobileError::protocol());
    }
    let code = frame["code"].as_str().ok_or_else(MobileError::protocol)?;
    if !matches!(
        code,
        "authentication_failed"
            | "authorization_revoked"
            | "host_identity_mismatch"
            | "proof_replayed"
            | "proof_expired"
            | "control_plane_unavailable"
    ) {
        return Err(MobileError::protocol());
    }
    Err(MobileError::code(code))
}

type SupervisorWire = Framed<Box<dyn tls::Io>, LengthDelimitedCodec>;

pub(crate) struct PendingAdmission {
    wire: SupervisorWire,
    session_id: String,
    challenge_bytes: Vec<u8>,
    transport: &'static str,
}

pub(crate) struct Admission {
    pub wire: Session,
    pub transport: &'static str,
    pub control: bool,
    pub expires_at: String,
    pub expires_unix: i64,
}

pub(crate) struct Session(SupervisorWire);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Response {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    request_id: String,
    ok: bool,
    data: Option<Value>,
    code: Option<String>,
    reason: Option<String>,
    http_status: Option<u16>,
}

impl Session {
    pub async fn request(
        &mut self,
        operation: Operation,
    ) -> Result<Result<Value, MobileError>, MobileError> {
        let request_id = format!("sreq_{}", Uuid::new_v4().simple());
        let budget = MESSAGE_TIMEOUT + Duration::from_millis(operation.wait_ms());
        let mut request = serde_json::to_value(operation).map_err(|_| MobileError::protocol())?;
        request["type"] = json!("supervisor.request");
        request["protocolVersion"] = json!(1);
        request["requestId"] = json!(request_id);
        if serde_json::to_vec(&request)
            .map_err(|_| MobileError::protocol())?
            .len()
            > HOST_FRAME_BYTES
        {
            return Ok(Err(MobileError::code("invalid_request")));
        }
        send(&mut self.0, &request).await?;
        let response: Response = parse(receive(&mut self.0, budget).await?)?;
        response_outcome(response, &request_id)
    }
}

fn response_outcome(
    response: Response,
    request_id: &str,
) -> Result<Result<Value, MobileError>, MobileError> {
    if response.kind != "supervisor.response"
        || response.protocol_version != 1
        || response.request_id != request_id
        || response.ok == response.code.is_some()
        || (response.ok && response.reason.is_some())
        || response.http_status.is_some_and(|status| {
            !matches!(status, 409 | 422) || response.code.as_deref() != Some("unsupported")
        })
    {
        return Err(MobileError::protocol());
    }
    if let Some(code) = response.code {
        if !matches!(
            code.as_str(),
            "invalid_request"
                | "operation_not_allowed"
                | "not_found"
                | "conflict"
                | "unsupported"
                | "unavailable"
                | "session_expired"
                | "internal"
        ) {
            return Err(MobileError::protocol());
        }
        let expired = code == "session_expired";
        let error = MobileError::Failure {
            code,
            http_status: response.http_status,
            reason: response.reason.or_else(|| {
                response
                    .data
                    .as_ref()
                    .and_then(|data| data.get("reason"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
        };
        return if expired { Err(error) } else { Ok(Err(error)) };
    }
    Ok(Ok(response.data.unwrap_or(Value::Null)))
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TurnInput {
    #[serde(rename = "type")]
    kind: String,
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Operation {
    #[serde(rename = "host.bootstrap")]
    HostBootstrap,
    #[serde(rename = "machine.list")]
    MachineList,
    #[serde(rename = "machine.get")]
    MachineGet { machine_id: String },
    #[serde(rename = "project.list")]
    ProjectList {
        machine_id: String,
        limit: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    #[serde(rename = "project.get")]
    ProjectGet {
        machine_id: String,
        project_id: String,
    },
    #[serde(rename = "project.create")]
    ProjectCreate {
        machine_id: String,
        action_id: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    #[serde(rename = "project.remove")]
    ProjectRemove {
        project_id: String,
        action_id: String,
    },
    #[serde(rename = "conversation.list")]
    ConversationList {
        machine_id: String,
        project_id: String,
        limit: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        archived: Option<String>,
    },
    #[serde(rename = "conversation.search")]
    ConversationSearch {
        project_id: String,
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        archive: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u8>,
    },
    #[serde(rename = "conversation.get")]
    ConversationGet {
        machine_id: String,
        project_id: String,
        conversation_id: String,
    },
    #[serde(rename = "conversation.history")]
    ConversationHistory {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        limit: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    #[serde(rename = "conversation.live.read")]
    ConversationLiveRead {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        cursor: String,
        limit: u8,
        wait_ms: u16,
    },
    #[serde(rename = "action.get")]
    ActionGet { action_id: String },
    #[serde(rename = "conversation.create")]
    ConversationCreate {
        action_id: String,
        machine_id: String,
        project_id: String,
        provider: String,
        input: TurnInput,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning: Option<String>,
    },
    #[serde(rename = "conversation.turn.start")]
    ConversationTurnStart {
        action_id: String,
        machine_id: String,
        project_id: String,
        conversation_id: String,
        input: TurnInput,
    },
    #[serde(rename = "conversation.recent")]
    ConversationRecent {
        machine_id: String,
        #[serde(default = "default_limit")]
        limit: u8,
    },
    #[serde(rename = "conversation.changes")]
    ConversationChanges {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        #[serde(default)]
        offset: u16,
    },
    #[serde(rename = "conversation.archive")]
    ConversationArchive {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        action_id: String,
    },
    #[serde(rename = "conversation.pin")]
    ConversationPin {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        action_id: String,
        pinned: bool,
    },
    #[serde(rename = "conversation.rename")]
    ConversationRename {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        action_id: String,
        title: String,
    },
    #[serde(rename = "conversation.restore")]
    ConversationRestore {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        action_id: String,
    },
    #[serde(rename = "attention.list")]
    AttentionList {
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        attention_type: Option<String>,
        #[serde(default = "open_attention")]
        status: String,
        #[serde(default = "default_limit")]
        limit: u8,
    },
    #[serde(rename = "attention.resolve")]
    AttentionResolve {
        attention_id: String,
        action_id: String,
    },
    #[serde(rename = "approval.resolve")]
    ApprovalResolve {
        approval_id: String,
        action_id: String,
        decision: String,
    },
    #[serde(rename = "turn.interrupt")]
    TurnInterrupt {
        machine_id: String,
        project_id: String,
        conversation_id: String,
        turn_id: String,
        action_id: String,
    },
}

fn default_limit() -> u8 {
    50
}
fn open_attention() -> String {
    "open".into()
}

impl Operation {
    pub fn requires_control(&self) -> bool {
        matches!(
            self,
            Self::ProjectCreate { .. }
                | Self::ProjectRemove { .. }
                | Self::ConversationCreate { .. }
                | Self::ConversationTurnStart { .. }
                | Self::ConversationArchive { .. }
                | Self::ConversationPin { .. }
                | Self::ConversationRename { .. }
                | Self::ConversationRestore { .. }
                | Self::AttentionResolve { .. }
                | Self::ApprovalResolve { .. }
                | Self::TurnInterrupt { .. }
        )
    }

    fn wait_ms(&self) -> u64 {
        match self {
            Self::ConversationLiveRead { wait_ms, .. } => u64::from(*wait_ms),
            _ => 0,
        }
    }

    pub fn validate(&self) -> Result<(), MobileError> {
        use Operation::*;
        let machine = |id: &str| valid_id(id, "machine_", 16);
        let project = |id: &str| valid_id(id, "proj_", 16);
        let scope =
            |m: &str, p: &str, c: &str| machine(m) && project(p) && valid_id(c, "conv_", 16);
        let action = |id: &str| valid_id(id, "act_", 6);
        let directory_page = |limit: &u8, cursor: &Option<String>| {
            (1..=100).contains(limit)
                && cursor
                    .as_ref()
                    .is_none_or(|v| v.len() <= 2048 && is_url_token(v))
        };
        let input_valid = |input: &TurnInput| {
            input.kind == "text"
                && !input.text.trim().is_empty()
                && input.text.encode_utf16().count() <= 1024 * 1024
        };
        let bounded_trimmed =
            |s: &str, max| !s.is_empty() && s.trim() == s && s.encode_utf16().count() <= max;
        let valid = match self {
            HostBootstrap | MachineList => true,
            MachineGet { machine_id } => machine(machine_id),
            ProjectList {
                machine_id,
                limit,
                cursor,
            } => machine(machine_id) && directory_page(limit, cursor),
            ProjectGet {
                machine_id,
                project_id,
            } => machine(machine_id) && project(project_id),
            ProjectCreate {
                machine_id,
                action_id,
                path,
                name,
            } => {
                machine(machine_id)
                    && action(action_id)
                    && (1..=4096).contains(&path.len())
                    && name.as_ref().is_none_or(|value| {
                        !value.trim().is_empty() && value.encode_utf16().count() <= 240
                    })
            }
            ProjectRemove {
                project_id,
                action_id,
            } => project(project_id) && action(action_id),
            ConversationList {
                machine_id,
                project_id,
                limit,
                cursor,
                archived,
            } => {
                machine(machine_id)
                    && project(project_id)
                    && directory_page(limit, cursor)
                    && archived
                        .as_deref()
                        .is_none_or(|value| matches!(value, "active" | "archived" | "all"))
            }
            ConversationSearch {
                project_id,
                query,
                archive,
                provider,
                status,
                cursor,
                limit,
            } => {
                project(project_id)
                    && !query.trim().is_empty()
                    && query.encode_utf16().count() <= 256
                    && archive
                        .as_deref()
                        .is_none_or(|value| matches!(value, "active" | "archived" | "all"))
                    && provider
                        .as_deref()
                        .is_none_or(|value| matches!(value, "codex" | "claude-code"))
                    && status.as_deref().is_none_or(|value| {
                        matches!(
                            value,
                            "idle" | "running" | "waiting" | "completed" | "failed"
                        )
                    })
                    && cursor.as_ref().is_none_or(|value| {
                        (20..=2048).contains(&value.len())
                            && value.strip_prefix("csc_").is_some_and(is_url_token)
                    })
                    && limit.is_none_or(|value| (1..=100).contains(&value))
            }
            ConversationGet {
                machine_id,
                project_id,
                conversation_id,
            } => scope(machine_id, project_id, conversation_id),
            ConversationHistory {
                machine_id,
                project_id,
                conversation_id,
                limit,
                cursor,
            } => {
                scope(machine_id, project_id, conversation_id)
                    && (1..=50).contains(limit)
                    && cursor.as_ref().is_none_or(|value| {
                        value.len() <= 256
                            && value.strip_prefix("history_").is_some_and(is_url_token)
                    })
            }
            ConversationLiveRead {
                machine_id,
                project_id,
                conversation_id,
                cursor,
                limit,
                wait_ms,
            } => {
                scope(machine_id, project_id, conversation_id)
                    && (1..=64).contains(limit)
                    && *wait_ms <= 15_000
                    && valid_live_cursor(cursor)
            }
            ActionGet { action_id } => action(action_id),
            ConversationCreate {
                action_id,
                machine_id,
                project_id,
                provider,
                input,
                model,
                reasoning,
            } => {
                action(action_id)
                    && machine(machine_id)
                    && project(project_id)
                    && matches!(provider.as_str(), "codex" | "claude-code")
                    && input_valid(input)
                    && model.as_ref().is_none_or(|v| bounded_trimmed(v, 240))
                    && reasoning.as_ref().is_none_or(|v| bounded_trimmed(v, 120))
            }
            ConversationTurnStart {
                action_id,
                machine_id,
                project_id,
                conversation_id,
                input,
            } => {
                action(action_id)
                    && scope(machine_id, project_id, conversation_id)
                    && input_valid(input)
            }
            ConversationRecent { machine_id, limit } => {
                machine(machine_id) && (1..=100).contains(limit)
            }
            ConversationChanges {
                machine_id,
                project_id,
                conversation_id,
                offset,
            } => scope(machine_id, project_id, conversation_id) && *offset <= 2048,
            ConversationArchive {
                machine_id,
                project_id,
                conversation_id,
                action_id,
            } => scope(machine_id, project_id, conversation_id) && action(action_id),
            ConversationPin {
                machine_id,
                project_id,
                conversation_id,
                action_id,
                ..
            }
            | ConversationRestore {
                machine_id,
                project_id,
                conversation_id,
                action_id,
            } => scope(machine_id, project_id, conversation_id) && action(action_id),
            ConversationRename {
                machine_id,
                project_id,
                conversation_id,
                action_id,
                title,
            } => {
                scope(machine_id, project_id, conversation_id)
                    && action(action_id)
                    && !title.trim().is_empty()
                    && title.encode_utf16().count() <= 240
            }
            AttentionList {
                project_id,
                attention_type,
                status,
                limit,
            } => {
                project_id.as_ref().is_none_or(|id| project(id))
                    && attention_type.as_deref().is_none_or(|kind| {
                        matches!(kind, "approval" | "completed_review" | "failed")
                    })
                    && matches!(status.as_str(), "open" | "resolved" | "expired")
                    && (1..=100).contains(limit)
            }
            AttentionResolve {
                attention_id,
                action_id,
            } => valid_id(attention_id, "attn_", 6) && action(action_id),
            ApprovalResolve {
                approval_id,
                action_id,
                decision,
            } => {
                valid_id(approval_id, "approval_", 6)
                    && action(action_id)
                    && matches!(decision.as_str(), "accept" | "decline")
            }
            TurnInterrupt {
                machine_id,
                project_id,
                conversation_id,
                turn_id,
                action_id,
            } => {
                scope(machine_id, project_id, conversation_id)
                    && action(action_id)
                    && valid_id(turn_id, "turn_", 6)
            }
        };
        if valid {
            Ok(())
        } else {
            Err(MobileError::code("invalid_request"))
        }
    }
}

fn valid_live_cursor(cursor: &str) -> bool {
    if cursor.len() > 128 {
        return false;
    }
    cursor.split_once(':').is_some_and(|(epoch, sequence)| {
        epoch.len() == 36
            && Uuid::parse_str(epoch).is_ok_and(|uuid| {
                uuid.get_variant() == Variant::RFC4122 && (1..=8).contains(&uuid.get_version_num())
            })
            && !sequence.is_empty()
            && (sequence == "0" || !sequence.starts_with('0'))
            && sequence.bytes().all(|byte| byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::{response_outcome, Operation, Response};
    use serde_json::{json, Value};

    const MACHINE: &str = "machine_1234567890abcdef";
    const PROJECT: &str = "proj_1234567890abcdef";
    const CONVERSATION: &str = "conv_1234567890abcdef";
    const ACTION: &str = "act_fixture_action";

    #[test]
    fn b4a_operations_validate_their_scopes_and_control_permissions() {
        let requests = [
            (
                json!({"operation":"project.create","machineId":MACHINE,"actionId":ACTION,"path":"C:\\work","name":"Work"}),
                true,
            ),
            (
                json!({"operation":"project.remove","projectId":PROJECT,"actionId":ACTION}),
                true,
            ),
            (
                json!({"operation":"conversation.list","machineId":MACHINE,"projectId":PROJECT,"limit":50}),
                false,
            ),
            (
                json!({"operation":"conversation.list","machineId":MACHINE,"projectId":PROJECT,"limit":50,"archived":"archived"}),
                false,
            ),
            (
                json!({"operation":"conversation.search","projectId":PROJECT,"query":"needle"}),
                false,
            ),
            (
                json!({"operation":"conversation.pin","machineId":MACHINE,"projectId":PROJECT,"conversationId":CONVERSATION,"actionId":ACTION,"pinned":true}),
                true,
            ),
            (
                json!({"operation":"conversation.rename","machineId":MACHINE,"projectId":PROJECT,"conversationId":CONVERSATION,"actionId":ACTION,"title":"New title"}),
                true,
            ),
            (
                json!({"operation":"conversation.restore","machineId":MACHINE,"projectId":PROJECT,"conversationId":CONVERSATION,"actionId":ACTION}),
                true,
            ),
        ];
        for (request, control) in requests {
            let operation: Operation = serde_json::from_value(request).expect("operation shape");
            operation.validate().expect("valid operation");
            assert_eq!(operation.requires_control(), control);
        }
    }

    #[test]
    fn b4a_operations_reject_bad_bounds_and_filters() {
        let invalid = [
            json!({"operation":"project.create","machineId":MACHINE,"actionId":ACTION,"path":"x".repeat(4097)}),
            json!({"operation":"conversation.list","machineId":MACHINE,"projectId":PROJECT,"limit":50,"archived":"active_only"}),
            json!({"operation":"conversation.search","projectId":PROJECT,"query":"x".repeat(257)}),
            json!({"operation":"conversation.search","projectId":PROJECT,"query":"needle","cursor":"bad"}),
            json!({"operation":"conversation.search","projectId":PROJECT,"query":"needle","limit":101}),
            json!({"operation":"conversation.rename","machineId":MACHINE,"projectId":PROJECT,"conversationId":CONVERSATION,"actionId":ACTION,"title":"x".repeat(241)}),
            json!({"operation":"conversation.restore","machineId":MACHINE,"projectId":PROJECT,"conversationId":CONVERSATION,"actionId":"bad"}),
        ];
        for request in invalid {
            match serde_json::from_value::<Operation>(request) {
                Ok(operation) => assert!(operation.validate().is_err()),
                Err(_) => {}
            }
        }
    }

    #[test]
    fn omitted_archive_filter_uses_the_hosts_active_default() {
        let request: Operation = serde_json::from_value(json!({
            "operation":"conversation.list",
            "machineId":MACHINE,
            "projectId":PROJECT,
            "limit":50
        }))
        .expect("list request without an archive filter");
        let value = serde_json::to_value(request).expect("serialize list request");
        assert!(value.get("archived").is_none());

        let request: Operation = serde_json::from_value(json!({
            "operation":"conversation.list",
            "machineId":MACHINE,
            "projectId":PROJECT,
            "limit":50,
            "archived":"all"
        }))
        .expect("explicit all request");
        let value = serde_json::to_value(request).expect("serialize list request");
        assert_eq!(value["archived"], "all");
    }

    #[test]
    fn failure_reason_is_exposed_from_the_response_envelope() {
        let response: Response = serde_json::from_value(json!({
            "type":"supervisor.response",
            "protocolVersion":1,
            "requestId":"sreq_fixture",
            "ok":false,
            "code":"conflict",
            "reason":"project_has_conversations"
        }))
        .expect("failure response");
        let error = response_outcome(response, "sreq_fixture")
            .expect("valid frame")
            .expect_err("failure result");
        assert_eq!(error.error_code(), "conflict");
        assert_eq!(error.reason(), Some("project_has_conversations"));

        let data_only: Response = serde_json::from_value(json!({
            "type":"supervisor.response",
            "protocolVersion":1,
            "requestId":"sreq_fixture",
            "ok":false,
            "code":"conflict",
            "data":{"reason":"legacy_data_reason"}
        }))
        .expect("failure response with legacy data");
        let error = response_outcome(data_only, "sreq_fixture")
            .expect("valid frame")
            .expect_err("failure result");
        assert_eq!(error.reason(), Some("legacy_data_reason"));

        let both: Response = serde_json::from_value(json!({
            "type":"supervisor.response",
            "protocolVersion":1,
            "requestId":"sreq_fixture",
            "ok":false,
            "code":"conflict",
            "reason":"project_has_conversations",
            "data":{"reason":"legacy_data_reason"}
        }))
        .expect("failure response with both reason locations");
        let error = response_outcome(both, "sreq_fixture")
            .expect("valid frame")
            .expect_err("failure result");
        assert_eq!(error.reason(), Some("project_has_conversations"));

        let response: Response = serde_json::from_value(json!({
            "type":"supervisor.response",
            "protocolVersion":1,
            "requestId":"sreq_fixture",
            "ok":true,
            "data":{"reason":"ordinary_data"}
        }))
        .expect("success response");
        let data: Value = response_outcome(response, "sreq_fixture")
            .expect("valid frame")
            .expect("success result");
        assert_eq!(data["reason"], "ordinary_data");

        let invalid_success: Response = serde_json::from_value(json!({
            "type":"supervisor.response",
            "protocolVersion":1,
            "requestId":"sreq_fixture",
            "ok":true,
            "reason":"project_has_conversations",
            "data":{}
        }))
        .expect("syntactically valid response");
        assert!(response_outcome(invalid_success, "sreq_fixture").is_err());
    }
}
