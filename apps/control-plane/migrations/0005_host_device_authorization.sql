ALTER TABLE control_plane.enrollment_challenges
  DROP CONSTRAINT enrollment_challenges_purpose_check;

ALTER TABLE control_plane.enrollment_challenges
  DROP CONSTRAINT enrollment_challenges_check2;

ALTER TABLE control_plane.enrollment_challenges
  ADD CONSTRAINT enrollment_challenges_purpose_check
  CHECK (purpose IN (
    'device_registration',
    'host_claim',
    'host_device_authorization'
  ));

ALTER TABLE control_plane.enrollment_challenges
  ADD CONSTRAINT enrollment_challenges_target_check
  CHECK (
    (
      purpose = 'device_registration'
      AND target_space_id IS NULL
      AND target_host_id IS NULL
    )
    OR (
      purpose IN ('host_claim', 'host_device_authorization')
      AND target_space_id IS NOT NULL
      AND target_device_id IS NOT NULL
      AND target_host_id IS NOT NULL
    )
  );
