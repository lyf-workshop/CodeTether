# Supervisor mobile transport

The Android app calls this Rust library through UniFFI. The wire protocol follows the TypeScript implementation in `packages/supervisor-transport` and `packages/relay-protocol`.

`connect_supervisor` verifies the Host-signed grant and descriptor against the Host key from the authenticated directory. Direct connections use fresh TLS 1.3 with the descriptor's Host SPKI pin. Relay connections verify the Relay's signed challenge against its published key pin, then carry a second, independently pinned Host TLS connection through the bounded Relay channel. The `tls:` Relay endpoint uses CA and DNS validation for its outer connection. The `tls+pinned:` endpoint checks the outer certificate SPKI pin.

The inner TLS exporter binds the device proof to the actual Host connection. Android supplies a DER ES256 signature through `DeviceSigner`. Rust generates a separate ephemeral key for transport TLS and Relay authentication. Android keeps the device signing key in its Keystore.

`SupervisorSession.request` validates the operation name and arguments against the Supervisor request shape. It sends one request at a time and matches response IDs before returning the server's `data` JSON. The caller supplies action IDs. A connection failure closes the session, and the caller decides how to reconcile an action with an uncertain outcome. `disconnect` cancels pending reads and closes the transport. The Kotlin binding's `close` releases its native object.

Run the crate tests after building the repository's existing TypeScript fixture dependencies. The integration test launches only a local ephemeral Supervisor server and Relay.

```powershell
pnpm --filter "@codetether/supervisor-transport..." --filter "@codetether/relay..." --filter "@codetether/control-plane..." build
cargo test --manifest-path packages/supervisor-mobile/Cargo.toml --locked
```
