CREATE TABLE control_plane.host_access_requests (
  request_id text PRIMARY KEY
    CHECK (request_id ~ '^hreq_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$'),
  requesting_device_id text NOT NULL
    REFERENCES control_plane.product_devices(device_id) ON DELETE RESTRICT,
  target_host_id text NOT NULL
    REFERENCES control_plane.hosts(host_id) ON DELETE RESTRICT,
  space_id text NOT NULL
    REFERENCES control_plane.spaces(space_id) ON DELETE RESTRICT,
  requested_scope text NOT NULL CHECK (requested_scope IN ('supervisor_read')),
  status text NOT NULL
    CHECK (status IN ('pending', 'denied', 'cancelled', 'expired', 'completed')),
  challenge_id text NOT NULL UNIQUE
    REFERENCES control_plane.enrollment_challenges(challenge_id) ON DELETE RESTRICT,
  authorization_payload jsonb NOT NULL
    CHECK (octet_length(authorization_payload::text) <= 16384),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_authorization_id text
    REFERENCES control_plane.host_device_authorizations(authorization_id)
    ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'completed' AND completed_authorization_id IS NOT NULL)
    OR (status <> 'completed' AND completed_authorization_id IS NULL)
  ),
  FOREIGN KEY (target_host_id, space_id)
    REFERENCES control_plane.hosts(host_id, owning_space_id) ON DELETE RESTRICT
);

CREATE INDEX host_access_requests_target_pending
  ON control_plane.host_access_requests(target_host_id, status, expires_at);

CREATE INDEX host_access_requests_requesting_device
  ON control_plane.host_access_requests(requesting_device_id, created_at DESC);

CREATE UNIQUE INDEX host_access_requests_one_pending
  ON control_plane.host_access_requests(requesting_device_id, target_host_id, requested_scope)
  WHERE status = 'pending';
