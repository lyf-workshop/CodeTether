ALTER TABLE control_plane.hosts
  DROP CONSTRAINT hosts_claim_state_check;

ALTER TABLE control_plane.hosts
  DROP CONSTRAINT hosts_key_algorithm_check;

ALTER TABLE control_plane.hosts
  ADD CONSTRAINT hosts_claim_state_check
  CHECK (claim_state IN ('unclaimed', 'pending', 'claimed', 'unlinked', 'revoked'));

ALTER TABLE control_plane.hosts
  ADD CONSTRAINT hosts_key_algorithm_check
  CHECK (key_algorithm IN ('ES256', 'ed25519'));

ALTER TABLE control_plane.hosts
  ALTER COLUMN owning_space_id DROP NOT NULL;

ALTER TABLE control_plane.host_claims
  DROP CONSTRAINT host_claims_host_id_space_id_claim_generation_fkey;

ALTER TABLE control_plane.host_claims
  ADD CONSTRAINT host_claims_host_generation_fkey
  FOREIGN KEY (host_id, claim_generation)
  REFERENCES control_plane.hosts(host_id, claim_generation)
  ON DELETE RESTRICT;

CREATE FUNCTION control_plane.validate_host_claim_space()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_space text;
BEGIN
  SELECT owning_space_id INTO current_space
    FROM control_plane.hosts
   WHERE host_id = NEW.host_id;
  IF current_space IS NOT NULL AND current_space <> NEW.space_id THEN
    RAISE EXCEPTION 'Host claim space does not match Host ownership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER host_claims_space_matches_host
BEFORE INSERT OR UPDATE OF host_id, space_id ON control_plane.host_claims
FOR EACH ROW EXECUTE FUNCTION control_plane.validate_host_claim_space();

CREATE TABLE control_plane.host_registration_challenges (
  challenge_id text PRIMARY KEY CHECK (challenge_id ~ '^enroll_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  candidate_host_id text NOT NULL CHECK (candidate_host_id ~ '^host_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  candidate_public_key text NOT NULL CHECK (char_length(candidate_public_key) BETWEEN 32 AND 8192),
  candidate_key_algorithm text NOT NULL CHECK (candidate_key_algorithm = 'ES256'),
  candidate_fingerprint text NOT NULL CHECK (candidate_fingerprint ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  safe_label text NOT NULL CHECK (char_length(safe_label) BETWEEN 1 AND 120 AND safe_label = btrim(safe_label)),
  coarse_platform text NOT NULL CHECK (coarse_platform IN ('windows', 'macos', 'linux', 'unknown')),
  protocol_version_min integer NOT NULL CHECK (protocol_version_min > 0),
  protocol_version_max integer NOT NULL CHECK (protocol_version_max >= protocol_version_min),
  nonce_hash text NOT NULL UNIQUE CHECK (nonce_hash ~ '^sha256:[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX host_registration_challenges_expiry
  ON control_plane.host_registration_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX host_registration_challenges_active_host
  ON control_plane.host_registration_challenges(candidate_host_id)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX host_registration_challenges_active_fingerprint
  ON control_plane.host_registration_challenges(candidate_fingerprint)
  WHERE consumed_at IS NULL;

ALTER TABLE control_plane.host_claims
  ADD COLUMN proof_version integer NOT NULL DEFAULT 1 CHECK (proof_version = 1),
  ADD COLUMN audience text NOT NULL DEFAULT 'codetether-control-plane-host'
    CHECK (audience = 'codetether-control-plane-host');

ALTER TABLE control_plane.security_events
  DROP CONSTRAINT security_events_event_type_check;

ALTER TABLE control_plane.security_events
  ADD CONSTRAINT security_events_event_type_check
  CHECK (event_type IN (
    'sign_in', 'sign_out', 'device_registered', 'device_revoked',
    'host_identity_registered', 'host_claim_requested', 'host_claim_confirmed',
    'host_claim_completed', 'host_claim_rejected', 'host_claim_expired',
    'host_claimed', 'host_unlinked', 'host_transfer_requested',
    'host_transferred', 'supervisor_authorized', 'supervisor_revoked',
    'replay_rejected'
  ));
