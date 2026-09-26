# CodeTether Phase 9C macOS ProductDevice Key Storage

The macOS ProductDevice backend uses the same ES256 contract as Windows:
ECDSA P-256, SHA-256 prehashing, and the raw 64-byte `r || s` signature wire
format. Public keys are exposed as the existing `EC` / `P-256` JWK with
base64url `x` and `y` coordinates, so Control Plane fingerprint derivation and
proof verification remain platform-independent.

macOS uses a persistent Keychain-backed software key through
Security.framework. The private key is generated with `kSecAttrIsExtractable`
false, stored with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, and
marked non-synchronizable. Its stable CodeTether application label is the
opaque `CodeTether.ProductDevice.<uuid>` handle already used by the Windows
backend. Only the public key description and local signatures leave the native
layer.

Secure Enclave was not selected. The existing protocol needs a P-256 key with
the same Security.framework ECDSA digest signing behavior, while Secure Enclave
availability and keychain requirements vary by Mac and app signing state. A
Keychain-protected non-exportable key preserves the protocol without adding a
Secure Enclave-only enrollment failure mode. No iCloud Keychain synchronization
or Data Protection access group is configured.

The backend reopens keys by their exact label after app restart, reports
generation `1`, rejects duplicate labels, normalizes Security.framework's DER
X9.62 signature to the existing raw 64-byte form, and deletes only the exact
key reference requested by the ProductDevice destroy operation.

The macOS-targeted Rust module type-checks in an isolated `aarch64-apple-darwin`
crate on the Windows build machine. A physical macOS build, Keychain runtime
test, and ProductDevice enrollment remain Owner/device steps and are not
claimed here.
