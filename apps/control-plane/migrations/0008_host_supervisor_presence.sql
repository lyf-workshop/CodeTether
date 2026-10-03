-- Host transport reachability is independent of ProductDevice authorization.
-- Grant material remains on the existing exact host_device_authorizations row.
CREATE TABLE control_plane.host_supervisor_presence (
  host_id text PRIMARY KEY REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  proof text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (octet_length(payload::text) <= 32768),
  CHECK (octet_length(proof) <= 8192),
  CHECK (expires_at > updated_at)
);

CREATE INDEX host_supervisor_presence_expiry
  ON control_plane.host_supervisor_presence(expires_at);
