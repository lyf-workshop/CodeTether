import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalFailure,
  canonicalFailureReasons,
} from '@codetether/agent-core'

import { CanonicalFailureSchema } from '../dist/index.js'

const occurredAt = '2026-09-02T20:00:00.000Z'

const expectedProfiles = {
  login_required: [
    'authentication',
    'retry_after_user_action',
    'login_on_machine',
    'provider',
  ],
  authentication_expired: [
    'authentication',
    'retry_after_user_action',
    'login_on_machine',
    'provider',
  ],
  authentication_invalid: [
    'authentication',
    'retry_after_user_action',
    'login_on_machine',
    'provider',
  ],
  account_unavailable: [
    'authentication',
    'retry_after_user_action',
    'contact_provider',
    'provider',
  ],
  usage_limit_reached: ['quota', 'retry_later', 'wait', 'provider'],
  rate_limited: ['quota', 'retry_later', 'wait', 'provider'],
  provider_capacity_limited: ['quota', 'retry_later', 'wait', 'provider'],
  provider_not_installed: [
    'provider',
    'retry_after_user_action',
    'reinstall_provider',
    'provider',
  ],
  provider_unsupported_version: [
    'provider',
    'retry_after_user_action',
    'update_provider',
    'provider',
  ],
  provider_misconfigured: [
    'provider',
    'retry_after_user_action',
    'open_machine',
    'provider',
  ],
  provider_service_unavailable: ['provider', 'retry_later', 'wait', 'provider'],
  provider_start_failed: ['provider', 'retry_now', 'retry', 'provider'],
  provider_crashed: ['provider', 'unknown', 'view_details', 'provider'],
  provider_session_lost: [
    'provider',
    'not_retryable',
    'view_details',
    'provider',
  ],
  provider_protocol_error: [
    'provider',
    'retry_after_user_action',
    'update_provider',
    'provider',
  ],
  machine_offline: ['machine', 'retry_later', 'reconnect_machine', 'machine'],
  node_disconnected: ['machine', 'retry_later', 'reconnect_machine', 'machine'],
  machine_identity_mismatch: [
    'machine',
    'retry_after_user_action',
    'open_machine',
    'machine',
  ],
  remote_execution_unavailable: [
    'machine',
    'retry_after_user_action',
    'open_machine',
    'machine',
  ],
  project_location_missing: [
    'project',
    'retry_after_user_action',
    'repair_project_location',
    'project',
  ],
  project_location_invalid: [
    'project',
    'retry_after_user_action',
    'repair_project_location',
    'project',
  ],
  project_location_unavailable: [
    'project',
    'retry_after_user_action',
    'open_project',
    'project',
  ],
  execution_capacity_reached: [
    'runtime',
    'retry_later',
    'reduce_active_work',
    'runtime',
  ],
  conversation_busy: ['runtime', 'retry_later', 'wait', 'runtime'],
  execution_lost: ['runtime', 'not_retryable', 'view_details', 'runtime'],
  execution_ownership_uncertain: [
    'runtime',
    'not_retryable',
    'view_details',
    'runtime',
  ],
  output_limit_exceeded: [
    'runtime',
    'not_retryable',
    'view_details',
    'runtime',
  ],
  protocol_limit_exceeded: [
    'runtime',
    'not_retryable',
    'view_details',
    'runtime',
  ],
  transport_lost: ['transport', 'not_retryable', 'view_details', 'transport'],
  transport_authentication_failed: [
    'transport',
    'retry_after_user_action',
    'open_machine',
    'transport',
  ],
  reconnecting: ['transport', 'retry_later', 'wait', 'transport'],
  relay_not_configured: [
    'transport',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  relay_unreachable: ['transport', 'retry_later', 'wait', 'relay'],
  relay_authentication_failed: [
    'authentication',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  relay_identity_mismatch: [
    'transport',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  relay_protocol_incompatible: [
    'transport',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  relay_revoked: [
    'authentication',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  relay_rate_limited: ['transport', 'retry_later', 'wait', 'relay'],
  relay_channel_open_failed: ['transport', 'retry_later', 'wait', 'relay'],
  relay_channel_lost: ['transport', 'not_retryable', 'view_details', 'relay'],
  relay_peer_offline: ['transport', 'retry_later', 'wait', 'relay'],
  relay_transport_capacity_reached: [
    'runtime',
    'retry_later',
    'reduce_active_work',
    'relay',
  ],
  relay_protocol_error: [
    'transport',
    'retry_after_user_action',
    'open_machine',
    'relay',
  ],
  provider_error: ['generic', 'unknown', 'view_details', 'provider'],
  runtime_error: ['generic', 'unknown', 'view_details', 'runtime'],
  unknown_failure: ['generic', 'unknown', 'view_details', 'runtime'],
}

test('every canonical failure reason has one exact safe recovery profile', () => {
  assert.deepEqual(Object.keys(expectedProfiles), [...canonicalFailureReasons])

  for (const reason of canonicalFailureReasons) {
    const failure = canonicalFailure(reason, occurredAt)
    const [category, retryability, userAction, source] =
      expectedProfiles[reason]
    assert.deepEqual(failure, {
      category,
      reason,
      retryability,
      userAction,
      source,
      occurredAt,
      technicalCode: reason,
    })
    assert.deepEqual(CanonicalFailureSchema.parse(failure), failure)
  }
})

test('the public schema rejects invented, inconsistent, and raw diagnostic fields', () => {
  const failure = canonicalFailure('usage_limit_reached', occurredAt)
  for (const candidate of [
    { ...failure, retryability: 'retry_now' },
    { ...failure, userAction: 'retry' },
    { ...failure, technicalCode: 'rate_limited' },
    { ...failure, rawProviderError: '<script>steal()</script>' },
    { ...failure, reason: 'future_provider_failure' },
  ]) {
    assert.equal(CanonicalFailureSchema.safeParse(candidate).success, false)
  }
})
