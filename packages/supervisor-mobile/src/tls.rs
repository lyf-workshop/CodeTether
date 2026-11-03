use std::{fmt, sync::Arc, time::Duration};

use p256::{ecdsa::SigningKey, pkcs8::DecodePrivateKey};
use rustls::{
    client::{
        danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        Resumption,
    },
    crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    time::timeout,
};
use tokio_rustls::{client::TlsStream, TlsConnector};
use x509_parser::{parse_x509_certificate, prelude::X509Certificate};

use crate::{crypto, MobileError};

pub(crate) const SUPERVISOR_ALPN: &[u8] = b"codetether-supervisor-v1";
pub(crate) const RELAY_ALPN: &[u8] = b"codetether-relay/1";
pub(crate) const EXPORTER_LABEL: &[u8] = b"EXPORTER-CodeTether-Supervisor-v1";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub(crate) trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

pub(crate) struct TransportIdentity {
    cert: CertificateDer<'static>,
    key: PrivatePkcs8KeyDer<'static>,
    pub spki: Vec<u8>,
    pub signer: SigningKey,
}

impl TransportIdentity {
    pub fn generate() -> Result<Self, MobileError> {
        // This connection-scoped TLS key is separate from the Android identity key.
        let generated =
            rcgen::generate_simple_self_signed(vec!["supervisor.codetether.invalid".into()])
                .map_err(|_| MobileError::code("transport_key_unavailable"))?;
        let cert = generated.cert.der().clone();
        let bytes = generated.signing_key.serialize_der();
        let signer = SigningKey::from_pkcs8_der(&bytes)
            .map_err(|_| MobileError::code("transport_key_unavailable"))?;
        Ok(Self {
            spki: certificate(&cert)?.public_key().raw.to_vec(),
            cert,
            key: bytes.into(),
            signer,
        })
    }
}

fn certificate<'a>(bytes: &'a [u8]) -> Result<X509Certificate<'a>, MobileError> {
    if bytes.is_empty() || bytes.len() > 64_000 {
        return Err(MobileError::identity());
    }
    let (remaining, parsed) = parse_x509_certificate(bytes).map_err(|_| MobileError::identity())?;
    if !remaining.is_empty() {
        return Err(MobileError::identity());
    }
    Ok(parsed)
}

struct PinnedCertificate {
    fingerprint: String,
    require_p256: bool,
    algorithms: WebPkiSupportedAlgorithms,
}

impl fmt::Debug for PinnedCertificate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PinnedCertificate")
    }
}

impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        use p256::pkcs8::DecodePublicKey;
        let invalid = || {
            rustls::Error::InvalidCertificate(
                rustls::CertificateError::ApplicationVerificationFailure,
            )
        };
        let parsed = certificate(end_entity).map_err(|_| invalid())?;
        let spki = parsed.public_key().raw;
        if (self.require_p256 && p256::PublicKey::from_public_key_der(spki).is_err())
            || !crypto::constant_eq(&crypto::sha256(spki), &self.fingerprint)
        {
            return Err(invalid());
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

pub(crate) async fn tcp(host: &str, port: u16) -> Result<TcpStream, MobileError> {
    let stream = timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| MobileError::code("remote_host_unreachable"))?
        .map_err(|_| MobileError::code("remote_host_unreachable"))?;
    stream
        .set_nodelay(true)
        .map_err(|_| MobileError::code("remote_host_unreachable"))?;
    Ok(stream)
}

pub(crate) async fn connect<T: Io>(
    stream: T,
    server_name: &str,
    alpn: &[u8],
    pin: Option<&str>,
    client_identity: Option<&TransportIdentity>,
) -> Result<TlsStream<T>, MobileError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let algorithms = provider.signature_verification_algorithms;
    let builder = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| MobileError::code("tls_unavailable"))?;
    let builder = if let Some(fingerprint) = pin {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedCertificate {
                fingerprint: fingerprint.into(),
                require_p256: alpn == SUPERVISOR_ALPN,
                algorithms,
            }))
    } else {
        builder.with_root_certificates(RootCertStore::from_iter(
            webpki_roots::TLS_SERVER_ROOTS.iter().cloned(),
        ))
    };
    let mut config = match client_identity {
        Some(identity) => builder
            .with_client_auth_cert(
                vec![identity.cert.clone()],
                PrivateKeyDer::Pkcs8(identity.key.clone_key()),
            )
            .map_err(|_| MobileError::code("transport_key_unavailable"))?,
        None => builder.with_no_client_auth(),
    };
    config.alpn_protocols = vec![alpn.to_vec()];
    config.resumption = Resumption::disabled();
    config.enable_early_data = false;
    // The inner Supervisor protocol matches the TS client and needs no SNI.
    config.enable_sni = alpn == RELAY_ALPN && pin.is_none();
    let name = ServerName::try_from(server_name.to_owned()).map_err(|_| MobileError::identity())?;
    let tls = timeout(
        CONNECT_TIMEOUT,
        TlsConnector::from(Arc::new(config)).connect(name, stream),
    )
    .await
    .map_err(|_| MobileError::code("remote_host_unreachable"))?
    .map_err(|error| match error.kind() {
        std::io::ErrorKind::InvalidData => MobileError::identity(),
        _ => MobileError::code("remote_host_unreachable"),
    })?;
    if tls.get_ref().1.alpn_protocol() != Some(alpn)
        || tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3)
    {
        return Err(MobileError::identity());
    }
    Ok(tls)
}

pub(crate) fn exporter<T>(stream: &TlsStream<T>) -> Result<String, MobileError> {
    let bytes = stream
        .get_ref()
        .1
        .export_keying_material([0u8; 32], EXPORTER_LABEL, Some(&[]))
        .map_err(|_| MobileError::identity())?;
    Ok(crypto::b64(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_exporter_label_and_empty_context_fixed_vector() {
        use ring::{digest, hkdf};

        // RFC 8446 section 7.5 with a fixed 32-byte exporter master secret.
        // The expected result was generated independently with Node HMAC-SHA256.
        fn expand(secret: &[u8], label: &[u8], context: &[u8]) -> [u8; 32] {
            let length = [0, 32, (6 + label.len()) as u8];
            let context_length = [context.len() as u8];
            let info = [&length[..], b"tls13 ", label, &context_length[..], context];
            let mut result = [0; 32];
            hkdf::Prk::new_less_safe(hkdf::HKDF_SHA256, secret)
                .expand(&info, hkdf::HKDF_SHA256)
                .unwrap()
                .fill(&mut result)
                .unwrap();
            result
        }

        let exporter_master: [u8; 32] = std::array::from_fn(|index| index as u8);
        let empty_context_hash = digest::digest(&digest::SHA256, b"");
        let derived = expand(
            &exporter_master,
            EXPORTER_LABEL,
            empty_context_hash.as_ref(),
        );
        let exported = expand(&derived, b"exporter", empty_context_hash.as_ref());
        assert_eq!(
            crypto::b64(&exported),
            "n8JD1XY2H9RfhMuUH052obZJBkYZmk1irCEkR6g86mE"
        );
    }
}
