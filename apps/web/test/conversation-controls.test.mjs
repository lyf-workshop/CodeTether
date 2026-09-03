import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveComposerControlState,
  deriveComposerEligibility,
  deriveConversationExecutionBoundaryReason,
  deriveProjectLocationBoundaryReason,
  deriveLiveControlAvailability,
  draftAfterSubmit,
  isComposerEditableState,
  isNearTimelineBottom,
  providerExecutionHealthAllowsExplicitStart,
  conversationExecutionBoundaryPresentation,
  shouldSubmitComposerKey,
} from '../.tmp/test-dist/components/conversation/conversation-controls.js'

const capabilities = {
  codex: true,
  approvals: true,
  interrupt: true,
  resume: true,
  diff: true,
  streaming: true,
}

test('Enter submits while Shift+Enter and IME composition remain text input', () => {
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
    }),
    true,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 229,
    }),
    false,
  )
  assert.equal(
    shouldSubmitComposerKey({
      key: 'a',
      shiftKey: false,
      isComposing: false,
    }),
    false,
  )
})

test('draft clears only after an accepted matching submission', () => {
  assert.equal(draftAfterSubmit('hello', 'hello', true), '')
  assert.equal(draftAfterSubmit('hello', 'hello', false), 'hello')
  assert.equal(draftAfterSubmit('edited', 'hello', true), 'edited')
})

test('capabilities, connection and active Turn jointly gate controls', () => {
  assert.deepEqual(
    deriveLiveControlAvailability('connected', capabilities, 'completed'),
    {
      canCompose: true,
      canInterrupt: false,
      canStop: false,
      canResolveApproval: true,
      supportsInterrupt: true,
      supportsApprovals: true,
      supportsDiff: true,
      supportsShell: true,
      supportsReasoningControl: true,
    },
  )
  assert.deepEqual(
    deriveLiveControlAvailability('connected', capabilities, 'running'),
    {
      canCompose: false,
      canInterrupt: true,
      canStop: false,
      canResolveApproval: true,
      supportsInterrupt: true,
      supportsApprovals: true,
      supportsDiff: true,
      supportsShell: true,
      supportsReasoningControl: true,
    },
  )
  assert.deepEqual(
    deriveLiveControlAvailability('reconnecting', capabilities, 'running'),
    {
      canCompose: false,
      canInterrupt: false,
      canStop: false,
      canResolveApproval: false,
      supportsInterrupt: true,
      supportsApprovals: true,
      supportsDiff: true,
      supportsShell: true,
      supportsReasoningControl: true,
    },
  )
  assert.equal(
    deriveLiveControlAvailability(
      'connected',
      { ...capabilities, interrupt: false },
      'running',
    ).canInterrupt,
    false,
  )
})

test('Claude capabilities do not inherit unsupported Codex controls', () => {
  const claude = {
    streaming: true,
    resume: true,
    interrupt: false,
    approvals: false,
    fileRead: true,
    fileEdit: false,
    shell: false,
    search: true,
    diff: false,
    toolEvents: true,
    modelSelection: false,
    reasoningControl: true,
  }

  assert.deepEqual(
    deriveLiveControlAvailability('connected', claude, 'completed'),
    {
      canCompose: true,
      canInterrupt: false,
      canStop: false,
      canResolveApproval: false,
      supportsInterrupt: false,
      supportsApprovals: false,
      supportsDiff: false,
      supportsShell: false,
      supportsReasoningControl: true,
    },
  )
})

test('HTTP awaiting, active, approval and interrupted states remain distinct', () => {
  assert.equal(
    deriveComposerControlState('connected', 'awaiting-event', undefined, 0),
    'submitting',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'running', 0),
    'running',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'running', 2),
    'waiting',
  )
  assert.equal(
    deriveComposerControlState('connected', 'idle', 'interrupted', 0),
    'interrupted',
  )
  assert.equal(
    deriveComposerControlState('unavailable', 'idle', 'completed', 0),
    'unavailable',
  )
})

test('an interrupted Turn re-enables Composer editing', () => {
  assert.equal(isComposerEditableState('idle'), true)
  assert.equal(isComposerEditableState('interrupted'), true)
  assert.equal(isComposerEditableState('submitting'), false)
  assert.equal(isComposerEditableState('running'), false)
  assert.equal(isComposerEditableState('waiting'), false)
  assert.equal(isComposerEditableState('unavailable'), false)
})

test('Approval resolution leaves waiting state and terminal completion re-enables Composer', () => {
  const waiting = deriveComposerControlState('connected', 'idle', 'running', 1)
  const resumed = deriveComposerControlState('connected', 'idle', 'running', 0)
  const completed = deriveComposerControlState(
    'connected',
    'idle',
    'completed',
    0,
  )

  assert.equal(waiting, 'waiting')
  assert.equal(resumed, 'running')
  assert.equal(completed, 'idle')
  assert.equal(isComposerEditableState(waiting), false)
  assert.equal(isComposerEditableState(resumed), false)
  assert.equal(isComposerEditableState(completed), true)
})

test('Composer eligibility explains typed connectivity, Project, Provider, health, and busy gates in order', () => {
  const machine = {
    kind: 'remote',
    connectionState: 'online',
    capabilities: { providerExecution: true },
  }
  const provider = {
    availability: 'available',
    capabilities: { streaming: true, resume: true },
  }
  const base = {
    connectionState: 'connected',
    currentTurnStatus: 'completed',
    machine,
    projectAvailability: 'available',
    provider,
  }

  assert.equal(deriveComposerEligibility(base), undefined)
  assert.equal(
    deriveComposerEligibility({ ...base, connectionState: 'reconnecting' })
      .reason,
    'reconnecting',
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      machine: { ...machine, connectionState: 'offline' },
      projectAvailability: 'unavailable',
    }).reason,
    'machine_offline',
  )
  assert.equal(
    deriveComposerEligibility({ ...base, projectAvailability: 'unavailable' })
      .reason,
    'project_location_unavailable',
  )
  assert.equal(
    deriveComposerEligibility({ ...base, provider: undefined }).reason,
    'remote_execution_unavailable',
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      provider: { ...provider, availability: 'not_installed' },
    }).reason,
    'provider_not_installed',
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      provider: { ...provider, availability: 'unsupported_version' },
    }).reason,
    'provider_unsupported_version',
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      provider: {
        ...provider,
        executionHealth: {
          state: 'unavailable',
          freshness: 'current',
          failure: canonicalFailure('login_required'),
        },
      },
    }),
    undefined,
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      provider: {
        ...provider,
        capabilities: { ...provider.capabilities, resume: false },
        executionHealth: {
          state: 'unavailable',
          freshness: 'current',
          failure: canonicalFailure('login_required'),
        },
      },
    }).reason,
    'login_required',
  )
  assert.equal(
    deriveComposerEligibility({
      ...base,
      provider: {
        ...provider,
        capabilities: { ...provider.capabilities, resume: false },
      },
    }).reason,
    'provider_capability_unsupported',
  )
  assert.equal(
    deriveComposerEligibility({ ...base, currentTurnStatus: 'running' }).reason,
    'conversation_busy',
  )
})

test('a terminal failure observation is advisory for the next explicit action', () => {
  assert.equal(
    providerExecutionHealthAllowsExplicitStart(
      { state: 'unknown', freshness: 'current' },
      true,
      undefined,
    ),
    true,
  )
  for (const reason of [
    'provider_crashed',
    'usage_limit_reached',
    'rate_limited',
    'provider_capacity_limited',
    'provider_service_unavailable',
    'login_required',
    'authentication_invalid',
    'provider_session_lost',
    'provider_protocol_error',
    'execution_capacity_reached',
    'execution_ownership_uncertain',
  ]) {
    const health = {
      state: 'unavailable',
      freshness: 'current',
      failure: canonicalFailure(reason),
    }
    assert.equal(
      providerExecutionHealthAllowsExplicitStart(health, true, 'completed'),
      true,
    )
    assert.equal(
      providerExecutionHealthAllowsExplicitStart(health, true, 'failed'),
      true,
    )
    assert.equal(
      providerExecutionHealthAllowsExplicitStart(health, true, 'interrupted'),
      true,
    )
  }
})

test('Composer can explicitly revalidate quota or crash health after its failed Turn', () => {
  const machine = {
    kind: 'remote',
    displayName: 'Linux VM',
    connectionState: 'online',
    capabilities: { providerExecution: true },
  }
  for (const reason of ['provider_crashed', 'usage_limit_reached']) {
    const provider = {
      displayName: 'Codex',
      availability: 'available',
      capabilities: { streaming: true, resume: true },
      executionHealth: {
        state: 'unavailable',
        freshness: 'current',
        failure: canonicalFailure(reason),
      },
    }
    assert.equal(
      deriveComposerEligibility({
        connectionState: 'connected',
        currentTurnStatus: 'failed',
        machine,
        projectAvailability: 'available',
        provider,
      }),
      undefined,
    )
  }
})

test('ProjectLocation boundary uses current Location truth and bounded historical refinement', () => {
  assert.equal(
    deriveProjectLocationBoundaryReason('available', {
      code: 'project_location_invalid',
      message: 'ignored legacy text',
      failure: canonicalFailure('project_location_invalid'),
    }),
    undefined,
  )
  assert.equal(
    deriveProjectLocationBoundaryReason('unavailable', {
      code: 'project_unavailable',
      message: 'ignored provider path',
      failure: canonicalFailure('project_location_invalid'),
    }),
    'project_location_invalid',
  )
  assert.equal(
    deriveProjectLocationBoundaryReason('unavailable', {
      code: 'project_location_not_found',
      message: 'legacy safe fallback',
    }),
    'project_location_missing',
  )
  assert.equal(
    deriveProjectLocationBoundaryReason('unavailable', undefined),
    'project_location_unavailable',
  )
})

test('Conversation execution boundary distinguishes reconnect and authentication truth from offline', () => {
  const remote = { kind: 'remote' }
  assert.equal(
    deriveConversationExecutionBoundaryReason({
      ...remote,
      connectionState: 'offline',
    }),
    'machine_offline',
  )
  assert.equal(
    deriveConversationExecutionBoundaryReason({
      ...remote,
      connectionState: 'connecting',
    }),
    'reconnecting',
  )
  assert.equal(
    deriveConversationExecutionBoundaryReason({
      ...remote,
      connectionState: 'authentication_failed',
    }),
    'transport_authentication_failed',
  )
  assert.match(
    conversationExecutionBoundaryPresentation('reconnecting').title,
    /重新连接/u,
  )
  assert.match(
    conversationExecutionBoundaryPresentation('transport_authentication_failed')
      .title,
    /身份验证失败/u,
  )
  assert.doesNotMatch(
    conversationExecutionBoundaryPresentation('transport_authentication_failed')
      .title,
    /离线/u,
  )
})

test('timeline follows only while its viewport remains near the bottom', () => {
  assert.equal(isNearTimelineBottom(452, 500, 1000), true)
  assert.equal(isNearTimelineBottom(400, 500, 1000), false)
  assert.equal(isNearTimelineBottom(0, 500, 400), true)
})

function canonicalFailure(reason) {
  const profile = {
    login_required: {
      category: 'authentication',
      retryability: 'retry_after_user_action',
      userAction: 'login_on_machine',
      source: 'provider',
    },
    execution_capacity_reached: {
      category: 'runtime',
      retryability: 'retry_later',
      userAction: 'reduce_active_work',
      source: 'runtime',
    },
    provider_crashed: {
      category: 'provider',
      retryability: 'unknown',
      userAction: 'view_details',
      source: 'provider',
    },
    usage_limit_reached: {
      category: 'quota',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'provider',
    },
    rate_limited: {
      category: 'quota',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'provider',
    },
    provider_capacity_limited: {
      category: 'quota',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'provider',
    },
    provider_service_unavailable: {
      category: 'provider',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'provider',
    },
    authentication_invalid: {
      category: 'authentication',
      retryability: 'retry_after_user_action',
      userAction: 'login_on_machine',
      source: 'provider',
    },
    provider_session_lost: {
      category: 'provider',
      retryability: 'not_retryable',
      userAction: 'view_details',
      source: 'provider',
    },
    provider_protocol_error: {
      category: 'provider',
      retryability: 'retry_after_user_action',
      userAction: 'update_provider',
      source: 'provider',
    },
    execution_ownership_uncertain: {
      category: 'runtime',
      retryability: 'not_retryable',
      userAction: 'view_details',
      source: 'runtime',
    },
    project_location_invalid: {
      category: 'project',
      retryability: 'retry_after_user_action',
      userAction: 'repair_project_location',
      source: 'project',
    },
  }[reason]
  if (profile === undefined)
    throw new Error(`Missing failure profile: ${reason}`)
  return {
    ...profile,
    reason,
    occurredAt: '2026-09-02T20:00:00.000Z',
    technicalCode: reason,
  }
}
