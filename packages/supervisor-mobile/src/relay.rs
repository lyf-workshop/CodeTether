use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};

use p256::ecdsa::{signature::Signer, Signature};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream, ReadBuf},
    net::TcpStream,
    task::JoinHandle,
    time::{sleep_until, timeout, Instant},
};
use tokio_rustls::client::TlsStream;
use tokio_util::codec::{Framed, LengthDelimitedCodec};
use url::Url;
use uuid::Uuid;

use crate::{
    crypto,
    tls::{self, TransportIdentity},
    wire::{self, RelayDescriptor},
    MobileError,
};

const FRAME_BYTES: usize = 8 * 1024;
const CHANNEL_BYTES: usize = 4 * 1024;
const CHANNEL_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(target_os = "ios")]
const BUILD_ID: &str = concat!("ios-", env!("CARGO_PKG_VERSION"));
#[cfg(not(target_os = "ios"))]
const BUILD_ID: &str = concat!("android-", env!("CARGO_PKG_VERSION"));
type RelayWire = Framed<TlsStream<TcpStream>, LengthDelimitedCodec>;

pub(crate) struct Tunnel {
    pipe: DuplexStream,
    worker: JoinHandle<()>,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

impl AsyncRead for Tunnel {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.pipe).poll_read(cx, buf)
    }
}

impl AsyncWrite for Tunnel {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.pipe).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.pipe).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.pipe).poll_shutdown(cx)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Challenge {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    relay_id: String,
    relay_public_key_spki: String,
    relay_fingerprint: String,
    challenge_id: String,
    nonce: String,
    issued_at: String,
    expires_at: String,
    signature: String,
}

impl Challenge {
    fn fields(&self) -> Vec<Value> {
        vec![
            json!(self.protocol_version),
            json!(self.relay_id),
            json!(self.relay_public_key_spki),
            json!(self.relay_fingerprint),
            json!(self.challenge_id),
            json!(self.nonce),
            json!(self.issued_at),
            json!(self.expires_at),
        ]
    }

    fn verify(&self, descriptor: &RelayDescriptor) -> Result<(), MobileError> {
        let bad_identity = || MobileError::code("relay_identity_mismatch");
        let now = crypto::now();
        if self.kind != "relay.challenge"
            || self.protocol_version != 2
            || self.relay_id != descriptor.relay_id
            || !crypto::constant_eq(&self.relay_fingerprint, &descriptor.relay_fingerprint)
            || self.relay_public_key_spki.len() > 256
            || !wire::valid_id(&self.challenge_id, "relay_challenge_", 6)
            || !wire::valid_pin(&self.nonce)
            || wire::date(&self.issued_at)? > now + 60
            || wire::date(&self.expires_at)? <= now
        {
            return Err(bad_identity());
        }
        let spki = crypto::decode(&self.relay_public_key_spki).map_err(|_| bad_identity())?;
        if !crypto::constant_eq(&crypto::sha256(&spki), &descriptor.relay_fingerprint) {
            return Err(bad_identity());
        }
        crypto::verify_spki_signature(
            &spki,
            &transcript("CodeTether Relay challenge v1", &self.fields())?,
            &self.signature,
        )
        .map_err(|_| bad_identity())
    }
}

fn transcript(domain: &str, fields: &[Value]) -> Result<Vec<u8>, MobileError> {
    let mut bytes = domain.as_bytes().to_vec();
    bytes.push(0);
    bytes.extend(serde_json::to_vec(fields).map_err(|_| MobileError::protocol())?);
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ready {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    role: String,
    connection_epoch: String,
    heartbeat_interval_ms: u64,
    heartbeat_timeout_ms: u64,
    authenticated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Opened {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u8,
    request_id: String,
    connection_epoch: String,
    channel_id: String,
    channel_generation: String,
    device_connection_epoch: String,
    host_connection_epoch: String,
}

impl Opened {
    fn valid(&self, ready: &Ready, request_id: &str) -> bool {
        self.kind == "supervisor.channel.opened"
            && self.protocol_version == 2
            && self.request_id == request_id
            && self.connection_epoch == ready.connection_epoch
            && self.device_connection_epoch == self.connection_epoch
            && wire::valid_id(&self.host_connection_epoch, "relay_connection_", 6)
            && wire::valid_id(&self.channel_id, "relay_channel_", 6)
            && wire::valid_id(&self.channel_generation, "relay_channel_generation_", 6)
    }

    fn matches(&self, message: &Value) -> bool {
        message["protocolVersion"] == 2
            && message["connectionEpoch"] == self.connection_epoch
            && message["deviceConnectionEpoch"] == self.device_connection_epoch
            && message["hostConnectionEpoch"] == self.host_connection_epoch
            && message["channelId"] == self.channel_id
            && message["channelGeneration"] == self.channel_generation
    }

    fn message(&self, kind: &str) -> Value {
        json!({
            "type": kind,
            "protocolVersion": 2,
            "connectionEpoch": self.connection_epoch,
            "deviceConnectionEpoch": self.device_connection_epoch,
            "hostConnectionEpoch": self.host_connection_epoch,
            "channelId": self.channel_id,
            "channelGeneration": self.channel_generation,
        })
    }
}

pub(crate) async fn open(
    descriptor: &RelayDescriptor,
    identity: &TransportIdentity,
) -> Result<Tunnel, MobileError> {
    let endpoint = Url::parse(&descriptor.endpoint)
        .map_err(|_| MobileError::code("relay_identity_mismatch"))?;
    if !matches!(endpoint.scheme(), "tls" | "tls+pinned")
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || !matches!(endpoint.path(), "" | "/")
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(MobileError::code("relay_identity_mismatch"));
    }
    let host = endpoint
        .host_str()
        .ok_or_else(|| MobileError::code("relay_identity_mismatch"))?
        .trim_start_matches('[')
        .trim_end_matches(']');
    let tcp = tls::tcp(host, endpoint.port().unwrap_or(443)).await?;
    // A public-CA TLS endpoint authenticates its DNS name. Both modes separately
    // verify the signed Relay challenge against the Host-published Relay key pin.
    let pin = (endpoint.scheme() == "tls+pinned").then_some(descriptor.relay_fingerprint.as_str());
    let stream = tls::connect(tcp, host, tls::RELAY_ALPN, pin, None)
        .await
        .map_err(|error| {
            if error.error_code() == "host_identity_mismatch" {
                MobileError::code("relay_identity_mismatch")
            } else {
                error
            }
        })?;
    let mut wire = wire::frames(stream, FRAME_BYTES);
    let challenge: Challenge = wire::parse(wire::receive(&mut wire, CHANNEL_TIMEOUT).await?)?;
    challenge.verify(descriptor)?;

    let request_id = format!("relay_request_{}", Uuid::new_v4().simple());
    let transport_public_key_spki = crypto::b64(&identity.spki);
    let transport_fingerprint = crypto::sha256(&identity.spki);
    let mut fields = challenge.fields();
    fields.extend([
        json!("device"),
        json!(descriptor.rendezvous_id),
        json!(crypto::sha256(descriptor.rendezvous_capability.as_bytes())),
        json!(descriptor.host_transport_fingerprint),
        json!(transport_public_key_spki),
        json!(transport_fingerprint),
        json!(BUILD_ID),
        json!(request_id),
    ]);
    let signature: Signature = identity.signer.sign(&transcript(
        "CodeTether Relay Supervisor authentication v1",
        &fields,
    )?);
    wire::send(
        &mut wire,
        &json!({
            "type": "supervisor.device.connect",
            "protocolVersion": 2,
            "role": "device",
            "requestId": request_id,
            "rendezvousId": descriptor.rendezvous_id,
            "rendezvousCapability": descriptor.rendezvous_capability,
            "hostTransportFingerprint": descriptor.host_transport_fingerprint,
            "transportPublicKeySpki": transport_public_key_spki,
            "transportFingerprint": transport_fingerprint,
            "clientBuildIdentity": BUILD_ID,
            "signature": crypto::b64(&signature.to_bytes())
        }),
    )
    .await?;
    let frame = wire::receive(&mut wire, CHANNEL_TIMEOUT).await?;
    if frame["type"] != "supervisor.ready" {
        return Err(MobileError::code("relay_unavailable"));
    }
    let ready: Ready = wire::parse(frame)?;
    if ready.kind != "supervisor.ready"
        || ready.protocol_version != 2
        || ready.role != "device"
        || !wire::valid_id(&ready.connection_epoch, "relay_connection_", 6)
        || !(10..=60_000).contains(&ready.heartbeat_interval_ms)
        || !(20..=180_000).contains(&ready.heartbeat_timeout_ms)
        || wire::date(&ready.authenticated_at).is_err()
    {
        return Err(MobileError::code("relay_protocol_error"));
    }
    let binding = timeout(CHANNEL_TIMEOUT, async {
        loop {
            let message = wire::read(&mut wire).await?;
            match message["type"].as_str() {
                Some("heartbeat.ping") => {
                    pong(&mut wire, &ready.connection_epoch, &message).await?
                }
                Some("supervisor.channel.opened") => {
                    let opened: Opened = wire::parse(message)?;
                    if !opened.valid(&ready, &request_id) {
                        return Err(MobileError::code("relay_protocol_error"));
                    }
                    return Ok(opened);
                }
                _ => return Err(MobileError::code("relay_unavailable")),
            }
        }
    })
    .await
    .map_err(|_| MobileError::code("relay_unavailable"))??;

    // The duplex buffers remain bounded. Each direction has at most one
    // unacknowledged chunk and preserves its own sequence.
    let (pipe, peer) = tokio::io::duplex(32 * 1024);
    let worker = tokio::spawn(async move {
        let _ = forward(
            wire,
            peer,
            binding,
            Duration::from_millis(ready.heartbeat_timeout_ms),
        )
        .await;
    });
    Ok(Tunnel { pipe, worker })
}

async fn pong(wire: &mut RelayWire, epoch: &str, message: &Value) -> Result<(), MobileError> {
    let ping = message["pingId"]
        .as_str()
        .ok_or_else(MobileError::protocol)?;
    if message["protocolVersion"] != 2
        || message["connectionEpoch"] != epoch
        || !wire::valid_id(ping, "relay_ping_", 6)
        || message["sentAt"]
            .as_str()
            .is_none_or(|value| wire::date(value).is_err())
    {
        return Err(MobileError::code("relay_protocol_error"));
    }
    wire::send(
        wire,
        &json!({
            "type": "heartbeat.pong", "protocolVersion": 2,
            "connectionEpoch": epoch, "pingId": ping
        }),
    )
    .await
}

async fn forward(
    mut wire: RelayWire,
    mut pipe: DuplexStream,
    binding: Opened,
    heartbeat_timeout: Duration,
) -> Result<(), MobileError> {
    let mut incoming = 1;
    let mut outgoing = 1;
    let mut pending_ack = None;
    let mut ping_deadline = Instant::now() + heartbeat_timeout;
    let mut buffer = [0; CHANNEL_BYTES];
    loop {
        let deadline = pending_ack.map_or(ping_deadline, |ack: Instant| ping_deadline.min(ack));
        tokio::select! {
            _ = sleep_until(deadline) => return Err(MobileError::code("relay_unavailable")),
            bytes = pipe.read(&mut buffer), if pending_ack.is_none() => {
                let count = bytes.map_err(|_| MobileError::code("relay_unavailable"))?;
                if count == 0 {
                    let mut close = binding.message("supervisor.channel.close");
                    close["reason"] = json!("completed");
                    return wire::send(&mut wire, &close).await;
                }
                let mut message = binding.message("supervisor.channel.data");
                message["sequence"] = json!(outgoing);
                message["data"] = json!(crypto::b64(&buffer[..count]));
                wire::send(&mut wire, &message).await?;
                pending_ack = Some(Instant::now() + CHANNEL_TIMEOUT);
            }
            frame = wire::read(&mut wire) => {
                let message = frame?;
                if message["type"] == "heartbeat.ping" {
                    pong(&mut wire, &binding.connection_epoch, &message).await?;
                    ping_deadline = Instant::now() + heartbeat_timeout;
                    continue;
                }
                if !binding.matches(&message) {
                    return Err(MobileError::code("relay_protocol_error"));
                }
                match message["type"].as_str() {
                    Some("supervisor.channel.data") if message["sequence"] == incoming => {
                        let data = message["data"].as_str().ok_or_else(MobileError::protocol)?;
                        if data.len() > 5462 {
                            return Err(MobileError::code("relay_protocol_error"));
                        }
                        let chunk = crypto::decode(data)?;
                        if chunk.is_empty() || chunk.len() > CHANNEL_BYTES {
                            return Err(MobileError::code("relay_protocol_error"));
                        }
                        timeout(CHANNEL_TIMEOUT, pipe.write_all(&chunk)).await
                            .map_err(|_| MobileError::code("relay_unavailable"))?
                            .map_err(|_| MobileError::code("relay_unavailable"))?;
                        let mut ack = binding.message("supervisor.channel.data.ack");
                        ack["acknowledgedSequence"] = json!(incoming);
                        wire::send(&mut wire, &ack).await?;
                        incoming += 1;
                    }
                    Some("supervisor.channel.data.ack")
                        if pending_ack.is_some() && message["acknowledgedSequence"] == outgoing =>
                    {
                        outgoing += 1;
                        pending_ack = None;
                    }
                    Some("supervisor.channel.closed") if message["requestId"] == binding.request_id => {
                        return Ok(());
                    }
                    _ => return Err(MobileError::code("relay_protocol_error")),
                }
            }
        }
    }
}
