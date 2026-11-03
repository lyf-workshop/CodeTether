use std::sync::{Arc, OnceLock};

use serde_json::Value;
use tokio::{runtime::Runtime, sync::Mutex};
use tokio_util::sync::CancellationToken;

mod crypto;
mod relay;
mod tls;
mod wire;

pub use crypto::canonical_json;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MobileError {
    #[error("{code}")]
    Failure {
        code: String,
        http_status: Option<u16>,
    },
}

impl MobileError {
    pub fn code(code: impl Into<String>) -> Self {
        Self::Failure {
            code: code.into(),
            http_status: None,
        }
    }

    pub fn error_code(&self) -> &str {
        match self {
            Self::Failure { code, .. } => code,
        }
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Failure { http_status, .. } => *http_status,
        }
    }

    fn protocol() -> Self {
        Self::code("protocol_error")
    }

    fn identity() -> Self {
        Self::code("host_identity_mismatch")
    }
}

#[uniffi::export(callback_interface)]
pub trait DeviceSigner: Send + Sync {
    fn sign_der(&self, message: Vec<u8>) -> Result<Vec<u8>, MobileError>;
}

#[derive(Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConnectionMode {
    Auto,
    Direct,
    Relay,
}

#[derive(uniffi::Record)]
pub struct ConnectOptions {
    pub host_id: String,
    pub host_fingerprint: String,
    pub host_identity_generation: u64,
    pub host_public_jwk_json: String,
    pub device_id: String,
    pub device_key_generation: u64,
    pub grant_json: String,
    pub descriptor_json: String,
    pub access_token: String,
    pub mode: ConnectionMode,
}

#[derive(uniffi::Object)]
pub struct SupervisorSession {
    wire: Mutex<Option<wire::Session>>,
    closed: CancellationToken,
    expires_at: String,
    expires_unix: i64,
    control: bool,
    transport: &'static str,
}

fn runtime() -> Result<&'static Runtime, MobileError> {
    static RUNTIME: OnceLock<Result<Runtime, ()>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .worker_threads(2)
                .thread_name("supervisor-mobile")
                .build()
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| MobileError::code("runtime_unavailable"))
}

#[uniffi::export]
pub fn connect_supervisor(
    options: ConnectOptions,
    signer: Box<dyn DeviceSigner>,
) -> Result<Arc<SupervisorSession>, MobileError> {
    // JNI calls this synchronous entry point from Dispatchers.IO.
    runtime()?.block_on(async {
        let admitted = wire::Connection::validate(&options)?;
        let pending = admitted.open(options.mode).await?;
        let wire::Admission {
            wire,
            transport,
            control,
            expires_at,
            expires_unix,
        } = admitted
            .authenticate(pending, &options.access_token, signer.as_ref())
            .await?;
        Ok(Arc::new(SupervisorSession {
            wire: Mutex::new(Some(wire)),
            closed: CancellationToken::new(),
            expires_at,
            expires_unix,
            control,
            transport,
        }))
    })
}

#[uniffi::export]
impl SupervisorSession {
    pub fn request(&self, operation_json: String) -> Result<String, MobileError> {
        if operation_json.len() > wire::HOST_FRAME_BYTES {
            return Err(MobileError::code("invalid_request"));
        }
        let operation: wire::Operation = serde_json::from_str(&operation_json)
            .map_err(|_| MobileError::code("invalid_request"))?;
        operation.validate()?;
        if operation.requires_control() && !self.control {
            return Err(MobileError::code("operation_not_allowed"));
        }
        runtime()?.block_on(async {
            let mut slot = tokio::select! {
                biased;
                _ = self.closed.cancelled() => return Err(MobileError::code("connection_closed")),
                slot = self.wire.lock() => slot,
            };
            if self.expires_unix <= crypto::now() {
                slot.take();
                return Err(MobileError::code("session_expired"));
            }
            let wire = slot
                .as_mut()
                .ok_or_else(|| MobileError::code("connection_closed"))?;
            let outcome = tokio::select! {
                biased;
                _ = self.closed.cancelled() => None,
                result = wire.request(operation) => Some(result),
            };
            match outcome {
                Some(Ok(response)) => response.map(|value| value.to_string()),
                Some(Err(error)) => {
                    slot.take();
                    Err(error)
                }
                None => {
                    slot.take();
                    Err(MobileError::code("connection_closed"))
                }
            }
        })
    }

    pub fn disconnect(&self) {
        self.closed.cancel();
        if let Ok(mut slot) = self.wire.try_lock() {
            slot.take();
        }
    }

    pub fn transport(&self) -> String {
        self.transport.into()
    }

    pub fn control(&self) -> String {
        if self.control { "control" } else { "read" }.into()
    }

    pub fn expires_at(&self) -> String {
        self.expires_at.clone()
    }
}

impl SupervisorSession {
    pub fn close(&self) {
        self.disconnect();
    }
}

#[uniffi::export]
pub fn device_request_proof(
    access_token: String,
    device_id: String,
    key_generation: u64,
    method: String,
    resource: String,
    body: Vec<u8>,
    signer: Box<dyn DeviceSigner>,
) -> Result<String, MobileError> {
    crypto::request_proof(
        &access_token,
        &device_id,
        key_generation,
        &method,
        &resource,
        &body,
        signer.as_ref(),
    )
}

#[uniffi::export]
pub fn sign_compact_proof(
    proof_type: String,
    payload_json: String,
    signer: Box<dyn DeviceSigner>,
) -> Result<String, MobileError> {
    if proof_type != "codetether-device-registration+jws" || payload_json.len() > 4096 {
        return Err(MobileError::code("invalid_request"));
    }
    let value: Value = serde_json::from_str(&payload_json).map_err(|_| MobileError::protocol())?;
    if !value.is_object() {
        return Err(MobileError::protocol());
    }
    crypto::sign_proof(&proof_type, &value, signer.as_ref())
}

#[uniffi::export]
pub fn new_nonce() -> Result<String, MobileError> {
    crypto::nonce()
}

#[uniffi::export]
pub fn sha256_digest(bytes: Vec<u8>) -> String {
    crypto::digest_string(&bytes)
}
