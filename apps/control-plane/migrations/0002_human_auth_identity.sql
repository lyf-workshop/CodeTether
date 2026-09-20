DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM control_plane.login_identities LIMIT 1) THEN
    RAISE EXCEPTION
      '0002 requires an empty pre-production login_identities table; review existing identities before migrating';
  END IF;
END;
$$;

ALTER TABLE control_plane.login_identities
  DROP CONSTRAINT login_identities_pkey;

ALTER TABLE control_plane.login_identities
  RENAME COLUMN last_seen_at TO last_used_at;

ALTER TABLE control_plane.login_identities
  ADD COLUMN login_identity_id text NOT NULL,
  ADD COLUMN verified_normalized_email text;

ALTER TABLE control_plane.login_identities
  ADD CONSTRAINT login_identities_pkey PRIMARY KEY (login_identity_id),
  ADD CONSTRAINT login_identities_id_format CHECK (
    login_identity_id ~ '^login_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'
  ),
  ADD CONSTRAINT login_identities_issuer_subject_unique UNIQUE (issuer, subject),
  ADD CONSTRAINT login_identities_verified_email_safe CHECK (
    verified_normalized_email IS NULL OR (
      char_length(verified_normalized_email) BETWEEN 3 AND 320
      AND verified_normalized_email = lower(btrim(verified_normalized_email))
    )
  );

CREATE INDEX login_identities_user
  ON control_plane.login_identities(user_id);
