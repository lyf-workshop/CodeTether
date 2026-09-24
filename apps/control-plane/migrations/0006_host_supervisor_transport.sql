ALTER TABLE control_plane.host_device_authorizations
  ADD COLUMN supervisor_grant_payload jsonb,
  ADD COLUMN supervisor_grant_proof text,
  ADD COLUMN supervisor_grant_materialized_at timestamptz,
  ADD COLUMN supervisor_transport_payload jsonb,
  ADD COLUMN supervisor_transport_proof text,
  ADD COLUMN supervisor_transport_expires_at timestamptz;

ALTER TABLE control_plane.host_device_authorizations
  ADD CONSTRAINT host_device_authorizations_supervisor_grant_complete
  CHECK (
    (supervisor_grant_payload IS NULL
      AND supervisor_grant_proof IS NULL
      AND supervisor_grant_materialized_at IS NULL)
    OR
    (supervisor_grant_payload IS NOT NULL
      AND supervisor_grant_proof IS NOT NULL
      AND supervisor_grant_materialized_at IS NOT NULL
      AND octet_length(supervisor_grant_payload::text) <= 16384
      AND octet_length(supervisor_grant_proof) <= 8192)
  ),
  ADD CONSTRAINT host_device_authorizations_supervisor_transport_complete
  CHECK (
    (supervisor_transport_payload IS NULL
      AND supervisor_transport_proof IS NULL
      AND supervisor_transport_expires_at IS NULL)
    OR
    (supervisor_transport_payload IS NOT NULL
      AND supervisor_transport_proof IS NOT NULL
      AND supervisor_transport_expires_at IS NOT NULL
      AND octet_length(supervisor_transport_payload::text) <= 32768
      AND octet_length(supervisor_transport_proof) <= 8192)
  );

CREATE INDEX host_device_authorizations_supervisor_transport_expiry
  ON control_plane.host_device_authorizations(supervisor_transport_expires_at)
  WHERE supervisor_transport_expires_at IS NOT NULL;
