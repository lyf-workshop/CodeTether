CREATE TABLE control_plane.users (
  user_id text PRIMARY KEY CHECK (user_id ~ '^usr_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deletion_pending')),
  display_name text CHECK (
    display_name IS NULL OR (
      char_length(display_name) BETWEEN 1 AND 120
      AND display_name = btrim(display_name)
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE control_plane.login_identities (
  issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 120 AND issuer = btrim(issuer)),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 256 AND subject = btrim(subject)),
  user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  PRIMARY KEY (issuer, subject),
  CHECK (last_seen_at IS NULL OR last_seen_at >= created_at)
);

CREATE TABLE control_plane.spaces (
  space_id text PRIMARY KEY CHECK (space_id ~ '^space_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  kind text NOT NULL CHECK (kind IN ('personal', 'organization')),
  name text NOT NULL CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
  ),
  personal_owner_user_id text REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (kind = 'personal' AND personal_owner_user_id IS NOT NULL)
    OR (kind = 'organization' AND personal_owner_user_id IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX spaces_one_personal_space_per_user
  ON control_plane.spaces(personal_owner_user_id)
  WHERE kind = 'personal';

CREATE TABLE control_plane.space_memberships (
  space_id text NOT NULL REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX space_memberships_user
  ON control_plane.space_memberships(user_id);

ALTER TABLE control_plane.spaces
  ADD CONSTRAINT spaces_personal_owner_membership
  FOREIGN KEY (space_id, personal_owner_user_id)
  REFERENCES control_plane.space_memberships(space_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE control_plane.product_devices (
  device_id text PRIMARY KEY CHECK (device_id ~ '^dev_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  owner_user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  device_type text NOT NULL CHECK (device_type IN ('desktop_host', 'desktop_client', 'mobile', 'tablet')),
  public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 32 AND 8192),
  key_algorithm text NOT NULL CHECK (key_algorithm ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120 AND label = btrim(label)),
  platform text NOT NULL CHECK (platform ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$'),
  app_version text NOT NULL CHECK (char_length(app_version) BETWEEN 1 AND 64 AND app_version = btrim(app_version)),
  protocol_version integer NOT NULL CHECK (protocol_version > 0),
  key_generation integer NOT NULL CHECK (key_generation >= 0),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CHECK (last_seen_at IS NULL OR last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (device_id, owner_user_id),
  UNIQUE (device_id, owner_user_id, key_generation),
  UNIQUE (device_id, owner_user_id, key_generation, fingerprint),
  UNIQUE (device_id, key_generation, fingerprint)
);

CREATE INDEX product_devices_owner_user
  ON control_plane.product_devices(owner_user_id);

CREATE TABLE control_plane.hosts (
  host_id text PRIMARY KEY CHECK (host_id ~ '^host_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  owning_space_id text NOT NULL REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  public_key text NOT NULL CHECK (char_length(public_key) BETWEEN 32 AND 8192),
  key_algorithm text NOT NULL CHECK (key_algorithm ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  safe_label text NOT NULL CHECK (char_length(safe_label) BETWEEN 1 AND 120 AND safe_label = btrim(safe_label)),
  coarse_platform text NOT NULL CHECK (coarse_platform IN ('windows', 'macos', 'linux', 'unknown')),
  protocol_version_min integer NOT NULL CHECK (protocol_version_min > 0),
  protocol_version_max integer NOT NULL CHECK (protocol_version_max > 0),
  claim_generation integer NOT NULL CHECK (claim_generation >= 0),
  claim_state text NOT NULL CHECK (claim_state IN ('pending', 'claimed', 'unlinked', 'revoked')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (protocol_version_max >= protocol_version_min),
  CHECK (updated_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (host_id, owning_space_id),
  UNIQUE (host_id, claim_generation),
  UNIQUE (host_id, owning_space_id, claim_generation)
);

CREATE INDEX hosts_owning_space
  ON control_plane.hosts(owning_space_id);

CREATE TABLE control_plane.enrollment_challenges (
  challenge_id text PRIMARY KEY CHECK (challenge_id ~ '^enroll_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  purpose text NOT NULL CHECK (purpose IN ('device_registration', 'host_claim')),
  target_user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  target_space_id text REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  target_device_id text REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  target_host_id text REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  nonce_hash text NOT NULL UNIQUE CHECK (nonce_hash ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (
    (purpose = 'device_registration' AND target_space_id IS NULL AND target_host_id IS NULL)
    OR (
      purpose = 'host_claim'
      AND target_space_id IS NOT NULL
      AND target_device_id IS NOT NULL
      AND target_host_id IS NOT NULL
    )
  )
);

CREATE INDEX enrollment_challenges_expiry
  ON control_plane.enrollment_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE control_plane.host_claims (
  claim_id text PRIMARY KEY CHECK (claim_id ~ '^hclaim_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  host_id text NOT NULL REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  space_id text NOT NULL REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  requesting_user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  requesting_device_id text NOT NULL REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  claim_generation integer NOT NULL CHECK (claim_generation >= 0),
  challenge_id text NOT NULL UNIQUE REFERENCES control_plane.enrollment_challenges(challenge_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('requested', 'confirmed', 'completed', 'expired', 'rejected', 'revoked')),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > requested_at),
  CHECK (confirmed_at IS NULL OR confirmed_at >= requested_at),
  CHECK (completed_at IS NULL OR (confirmed_at IS NOT NULL AND completed_at >= confirmed_at)),
  CHECK (revoked_at IS NULL OR revoked_at >= requested_at),
  CHECK ((state <> 'confirmed') OR confirmed_at IS NOT NULL),
  CHECK ((state <> 'completed') OR completed_at IS NOT NULL),
  FOREIGN KEY (host_id, space_id, claim_generation)
    REFERENCES control_plane.hosts(host_id, owning_space_id, claim_generation)
    ON DELETE RESTRICT,
  FOREIGN KEY (requesting_device_id, requesting_user_id)
    REFERENCES control_plane.product_devices(device_id, owner_user_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX host_claims_one_active_generation
  ON control_plane.host_claims(host_id, claim_generation)
  WHERE state IN ('requested', 'confirmed');

CREATE TABLE control_plane.host_device_authorizations (
  authorization_id text PRIMARY KEY CHECK (authorization_id ~ '^hauth_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  host_id text NOT NULL REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  claim_generation integer NOT NULL CHECK (claim_generation >= 0),
  device_id text NOT NULL REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  device_key_generation integer NOT NULL CHECK (device_key_generation >= 0),
  device_fingerprint text NOT NULL CHECK (device_fingerprint ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  space_id text NOT NULL REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('supervisor_read')),
  authorization_serial bigint NOT NULL CHECK (authorization_serial >= 0),
  authorization_generation integer NOT NULL CHECK (authorization_generation >= 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
  UNIQUE (host_id, authorization_serial),
  FOREIGN KEY (host_id, space_id, claim_generation)
    REFERENCES control_plane.hosts(host_id, owning_space_id, claim_generation)
    ON DELETE RESTRICT,
  FOREIGN KEY (device_id, user_id, device_key_generation, device_fingerprint)
    REFERENCES control_plane.product_devices(device_id, owner_user_id, key_generation, fingerprint)
    ON DELETE RESTRICT
);

CREATE INDEX host_device_authorizations_device
  ON control_plane.host_device_authorizations(device_id);

CREATE TABLE control_plane.device_session_bindings (
  binding_id text PRIMARY KEY CHECK (binding_id ~ '^dsb_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  external_auth_session_hash text NOT NULL CHECK (external_auth_session_hash ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  device_id text NOT NULL REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  device_key_generation integer NOT NULL CHECK (device_key_generation >= 0),
  binding_generation integer NOT NULL CHECK (binding_generation >= 0),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (last_seen_at IS NULL OR last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (external_auth_session_hash, device_id, binding_generation),
  FOREIGN KEY (device_id, user_id, device_key_generation)
    REFERENCES control_plane.product_devices(device_id, owner_user_id, key_generation)
    ON DELETE RESTRICT
);

CREATE INDEX device_session_bindings_user_device
  ON control_plane.device_session_bindings(user_id, device_id);

CREATE INDEX device_session_bindings_expiry
  ON control_plane.device_session_bindings(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE control_plane.relay_rendezvous_bindings (
  binding_id text PRIMARY KEY CHECK (binding_id ~ '^rvb_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  host_id text NOT NULL REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  device_id text NOT NULL REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  opaque_relay_binding_id text NOT NULL UNIQUE CHECK (
    char_length(opaque_relay_binding_id) BETWEEN 16 AND 160
    AND opaque_relay_binding_id = btrim(opaque_relay_binding_id)
  ),
  binding_role text NOT NULL CHECK (binding_role IN ('host', 'supervisor_device')),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX relay_rendezvous_bindings_host_device
  ON control_plane.relay_rendezvous_bindings(host_id, device_id);

CREATE TABLE control_plane.security_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^sevt_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  event_type text NOT NULL CHECK (event_type IN (
    'sign_in',
    'sign_out',
    'device_registered',
    'device_revoked',
    'host_claim_requested',
    'host_claimed',
    'host_unlinked',
    'host_transfer_requested',
    'host_transferred',
    'supervisor_authorized',
    'supervisor_revoked',
    'replay_rejected'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'device', 'host', 'control_plane')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND actor_id = btrim(actor_id)),
  target_kind text CHECK (target_kind IS NULL OR target_kind IN ('user', 'space', 'device', 'host', 'authorization', 'session')),
  target_id text CHECK (target_id IS NULL OR (char_length(target_id) BETWEEN 1 AND 128 AND target_id = btrim(target_id))),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  correlation_id text CHECK (correlation_id IS NULL OR (char_length(correlation_id) BETWEEN 8 AND 128 AND correlation_id = btrim(correlation_id))),
  occurred_at timestamptz NOT NULL,
  CHECK ((target_kind IS NULL) = (target_id IS NULL))
);

CREATE FUNCTION control_plane.reject_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'security_events is append-only';
END;
$$;

CREATE TRIGGER security_events_no_update
BEFORE UPDATE ON control_plane.security_events
FOR EACH ROW EXECUTE FUNCTION control_plane.reject_security_event_mutation();

CREATE TRIGGER security_events_no_delete
BEFORE DELETE ON control_plane.security_events
FOR EACH ROW EXECUTE FUNCTION control_plane.reject_security_event_mutation();

CREATE INDEX security_events_occurred_at
  ON control_plane.security_events(occurred_at);

CREATE INDEX security_events_actor
  ON control_plane.security_events(actor_kind, actor_id, occurred_at);
