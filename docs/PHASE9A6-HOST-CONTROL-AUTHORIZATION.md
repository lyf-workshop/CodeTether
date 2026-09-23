# Phase 9A.6 Host Control Authorization

Phase 9A.6 adds one MVP authorization relationship: an authenticated, active
ProductDevice may access the Supervisor entry points of one already-owned Host
after an explicit confirmation on that Host.

## Authority boundary

The relationship is binary at the product boundary:

```text
ProductDevice -> Host = unauthorized | authorized
```

The existing `control_plane.host_device_authorizations` table remains the
single durable Cloud index/delivery record. The Host's explicit confirmation
and signature remain the grant authority; the Control Plane cannot create a
row without verifying that signature. The table's existing `supervisor_read`
scope value is the storage representation for this initial binary Supervisor
admission; Phase 9A.6 does not add roles, scope inheritance, delegation, or
general RBAC.

Effective access always requires all of the following at request time:

- the Supabase-authenticated CodeTether User is active;
- the exact ProductDevice belongs to that User, is at its current key
  generation, and is not revoked;
- the User remains an owner member of the Space that currently owns the Host;
- the Host remains claimed by that Space, is not revoked, and retains the
  identity generation bound to the authorization; and
- the exact Host/ProductDevice authorization is unexpired and not revoked.

Host ownership alone does not grant Supervisor access. ProductDevice
revocation or loss of current Space ownership makes an otherwise durable
authorization ineffective without rewriting Machine trust.

## Explicit Host confirmation

Authorization uses the existing ProductDevice-authenticated Control Plane
request boundary and the existing durable Host ES256 identity:

1. The authenticated User and ProductDevice request authorization for an
   exact owned Host.
2. The Control Plane creates a five-minute, one-use
   `host_device_authorization` enrollment challenge.
3. The Host displays bounded request metadata and requires an explicit local
   Owner action.
4. The existing Host CNG key signs the canonical request payload.
5. The Control Plane verifies the exact Host identity and atomically consumes
   the challenge, stores the authorization, and records one bounded
   `supervisor_authorized` security event.

The signed payload binds the User, Space, ProductDevice, Device key generation
and fingerprint, Host, Host identity generation and fingerprint, challenge,
authorization ID, issuance/expiry, protocol version, and audience. No new key
or identity namespace is introduced. A successful authorization is valid for
30 days in this MVP and can be explicitly revoked.

## API boundary

The narrow authenticated routes are:

- `POST /v1/hosts/:hostId/device-authorization/request`
- `POST /v1/hosts/:hostId/device-authorization/confirm`
- `GET /v1/hosts/:hostId/device-authorization`
- `POST /v1/hosts/:hostId/device-authorization/revoke`

Every route requires both the human Supabase access context and the existing
ProductDevice request proof. Future remote Host features must call the shared
`authorizeHostRequest` service check before admitting a Supervisor operation.
That Control Plane check does not replace the frozen requirement for the Host
endpoint to verify its local authorization state and the signed grant when
Supervisor transport is implemented.

## Persistence and privacy

Migration `0005_host_device_authorization.sql` only extends the existing
private-schema enrollment challenge purpose constraint. It does not create a
second authorization system. The challenge remains short-lived, one-use, and
stores only the nonce digest.

The Cloud persists public identity metadata, exact durable IDs, authorization
state, and bounded timestamps. It does not persist a ProductDevice private key,
Host private key, Supabase JWT or OTP, Provider credential, Controller secret,
Prompt, transcript, or source code.

## Frozen execution authorities

ProductDevice Host authorization is not Machine Controller trust. It does not
create or expose a `controller_*` identity, pair a Node, enroll a Relay peer,
select a ProviderInstallation, or change Project, Conversation, Turn, native
session, or Provider execution ownership. Those Phase 8D authorities remain
unchanged.
