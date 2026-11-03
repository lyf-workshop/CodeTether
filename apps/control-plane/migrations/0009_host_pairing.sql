ALTER TABLE control_plane.host_device_authorizations
  DROP CONSTRAINT host_device_authorizations_scope_check;

ALTER TABLE control_plane.host_device_authorizations
  ADD CONSTRAINT host_device_authorizations_scope_check
    CHECK (scope IN ('supervisor_read', 'supervisor_control'));

CREATE TABLE control_plane.host_pairing_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^enroll_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  user_id text NOT NULL REFERENCES control_plane.users(user_id) ON DELETE RESTRICT,
  space_id text NOT NULL REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  host_id text NOT NULL REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  host_identity_generation integer NOT NULL CHECK (host_identity_generation >= 0),
  managing_device_id text NOT NULL REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  managing_device_key_generation integer NOT NULL CHECK (managing_device_key_generation >= 0),
  code_hash text CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  code_index integer CHECK (code_index BETWEEN 0 AND 31),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  state text NOT NULL CHECK (state IN ('pending', 'claimed', 'paired', 'cancelled', 'rate_limited')),
  proposal jsonb CHECK (octet_length(proposal::text) <= 16384),
  previous_authorization_id text
    REFERENCES control_plane.host_device_authorizations(authorization_id) ON DELETE RESTRICT,
  completed_authorization_id text UNIQUE
    REFERENCES control_plane.host_device_authorizations(authorization_id) ON DELETE RESTRICT,
  pairing_root_authorization_id text
    REFERENCES control_plane.host_device_authorizations(authorization_id) ON DELETE RESTRICT,
  superseded_by_authorization_id text
    REFERENCES control_plane.host_device_authorizations(authorization_id) ON DELETE RESTRICT,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  CHECK ((code_hash IS NOT NULL AND code_index IS NOT NULL AND previous_authorization_id IS NULL)
      OR (code_hash IS NULL AND code_index IS NULL AND previous_authorization_id IS NOT NULL)),
  CHECK (state NOT IN ('claimed', 'paired') OR proposal IS NOT NULL),
  CHECK ((state = 'paired') = (completed_authorization_id IS NOT NULL)),
  CHECK ((state = 'paired') = (pairing_root_authorization_id IS NOT NULL)),
  CHECK (state = 'paired' OR (last_used_at IS NULL AND superseded_by_authorization_id IS NULL)),
  CHECK (superseded_by_authorization_id IS NULL OR superseded_by_authorization_id <> completed_authorization_id)
);

CREATE INDEX host_pairing_sessions_account_live
  ON control_plane.host_pairing_sessions(user_id, expires_at) WHERE state = 'pending';
CREATE INDEX host_pairing_sessions_account_code
  ON control_plane.host_pairing_sessions(user_id, code_hash, created_at DESC);
CREATE INDEX host_pairing_sessions_previous_authorization
  ON control_plane.host_pairing_sessions(previous_authorization_id, created_at DESC)
  WHERE previous_authorization_id IS NOT NULL;
CREATE INDEX host_pairing_sessions_lineage
  ON control_plane.host_pairing_sessions(host_id, pairing_root_authorization_id)
  WHERE state = 'paired';
