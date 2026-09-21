ALTER TABLE control_plane.product_devices
  DROP CONSTRAINT product_devices_key_algorithm_check;

ALTER TABLE control_plane.product_devices
  ADD CONSTRAINT product_devices_key_algorithm_check
    CHECK (
      key_algorithm = 'ES256'
      OR key_algorithm ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
    );

CREATE TABLE control_plane.device_registration_challenges (
  challenge_id text PRIMARY KEY
    REFERENCES control_plane.enrollment_challenges(challenge_id) ON DELETE RESTRICT,
  candidate_device_id text NOT NULL UNIQUE
    CHECK (candidate_device_id ~ '^dev_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  candidate_public_jwk text NOT NULL
    CHECK (char_length(candidate_public_jwk) BETWEEN 120 AND 1024),
  candidate_fingerprint text NOT NULL
    CHECK (candidate_fingerprint ~ '^sha256:[A-Za-z0-9_-]{43}$'),
  candidate_key_algorithm text NOT NULL
    CHECK (candidate_key_algorithm = 'ES256'),
  device_type text NOT NULL
    CHECK (device_type IN ('desktop_host', 'desktop_client', 'mobile', 'tablet')),
  label text NOT NULL
    CHECK (char_length(label) BETWEEN 1 AND 120 AND label = btrim(label)),
  platform text NOT NULL
    CHECK (platform ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$'),
  app_version text NOT NULL
    CHECK (char_length(app_version) BETWEEN 1 AND 64 AND app_version = btrim(app_version)),
  protocol_version integer NOT NULL CHECK (protocol_version = 1),
  proof_version integer NOT NULL CHECK (proof_version = 1),
  audience text NOT NULL CHECK (audience = 'codetether-control-plane')
);

CREATE INDEX device_registration_challenges_fingerprint
  ON control_plane.device_registration_challenges(candidate_fingerprint);

CREATE TABLE control_plane.device_request_nonces (
  device_id text NOT NULL,
  key_generation integer NOT NULL CHECK (key_generation > 0),
  auth_token_hash text NOT NULL
    CHECK (auth_token_hash ~ '^sha256:[A-Za-z0-9_-]{43}$'),
  nonce_hash text NOT NULL
    CHECK (nonce_hash ~ '^sha256:[A-Za-z0-9_-]{43}$'),
  issued_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, key_generation, nonce_hash),
  FOREIGN KEY (device_id)
    REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  CHECK (expires_at > issued_at),
  CHECK (observed_at >= issued_at - interval '120 seconds'),
  CHECK (expires_at > observed_at)
);

CREATE INDEX device_request_nonces_expiry
  ON control_plane.device_request_nonces(expires_at);
