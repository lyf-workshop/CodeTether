import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CodexExecutableNotFoundError,
  CodexProcessError,
  CodexProcessExitError,
} from '@codetether/adapter-codex'

import { codexUnavailableDescriptor } from '../dist/api/local-codex-host.js'
import { classifyCanonicalFailure } from '../dist/api/canonical-failure.js'

const observedAt = '2026-09-02T21:00:00.000Z'

test('keeps local Codex installation truth separate from execution health', () => {
  const cases = [
    {
      error: new CodexExecutableNotFoundError('PRIVATE executable'),
      availability: 'not_installed',
      reason: 'provider_not_installed',
    },
    {
      error: new CodexProcessError('PRIVATE permission failure', {
        failureReason: 'provider_misconfigured',
      }),
      availability: 'misconfigured',
      reason: 'provider_misconfigured',
    },
    {
      error: new CodexProcessExitError(17, null),
      availability: 'available',
      reason: 'provider_crashed',
    },
  ]

  for (const scenario of cases) {
    const descriptor = codexUnavailableDescriptor(scenario.error, observedAt)
    assert.equal(descriptor.availability, scenario.availability)
    assert.equal(
      descriptor.executionHealth.state,
      scenario.reason === 'provider_crashed' ? 'degraded' : 'unavailable',
    )
    assert.equal(descriptor.executionHealth.freshness, 'current')
    assert.equal(descriptor.executionHealth.failure.reason, scenario.reason)
    assert.equal(descriptor.executionHealth.failure.occurredAt, observedAt)
    assert.doesNotMatch(
      JSON.stringify(descriptor),
      /PRIVATE|executable|permission/u,
    )
  }
})

test('keeps broad legacy Provider failures generic and loss codes fail closed', () => {
  const broad = classifyCanonicalFailure(
    { code: 'provider_unavailable', message: 'private old-node detail' },
    observedAt,
  )
  const contradictoryLoss = classifyCanonicalFailure(
    {
      code: 'remote_execution_lost',
      failure: {
        category: 'provider',
        reason: 'provider_start_failed',
        retryability: 'retry_now',
        userAction: 'retry',
        source: 'provider',
        occurredAt: observedAt,
        technicalCode: 'provider_start_failed',
      },
    },
    observedAt,
  )

  assert.equal(broad.reason, 'provider_error')
  assert.equal(broad.retryability, 'unknown')
  assert.equal(contradictoryLoss.reason, 'execution_lost')
  assert.equal(contradictoryLoss.retryability, 'not_retryable')
  assert.doesNotMatch(JSON.stringify({ broad, contradictoryLoss }), /private/u)
})
