import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GetConversationResponseSchema,
  MachineProviderLifecycleSchema,
  ProviderBackendObservationSchema,
  ProviderCompatibilityObservationSchema,
  ProviderInstallationSummarySchema,
  RefreshMachineProvidersDataSchema,
} from '../dist/index.js'

const observedAt = '2026-10-05T12:00:00.000Z'

test('validates a bounded Provider lifecycle with observed, enabled, and effective capabilities', () => {
  const lifecycle = providerLifecycle()
  assert.deepEqual(MachineProviderLifecycleSchema.parse(lifecycle), lifecycle)

  assert.equal(
    ProviderCompatibilityObservationSchema.safeParse({
      ...lifecycle.installations[0].compatibility,
      capabilities: {
        ...lifecycle.installations[0].compatibility.capabilities,
        fileRead: {
          observed: 'supported',
          enabled: false,
          effective: true,
        },
      },
    }).success,
    false,
  )
  assert.equal(
    MachineProviderLifecycleSchema.safeParse({
      ...lifecycle,
      selectedInstallationId: undefined,
    }).success,
    false,
  )
  assert.equal(
    MachineProviderLifecycleSchema.safeParse({
      ...lifecycle,
      installations: [lifecycle.installations[0], lifecycle.installations[0]],
    }).success,
    false,
  )
})

test('keeps runtime compatibility and backend readiness as independent strict observations', () => {
  const lifecycle = providerLifecycle()
  const installation = lifecycle.installations[0]
  assert.equal(installation.compatibility.state, 'verified')
  assert.equal(installation.compatibility.runtimeReadiness, 'ready')
  assert.equal(installation.backend.mode, 'custom_gateway')
  assert.equal(installation.backend.readiness, 'unavailable')
  assert.equal(
    ProviderBackendObservationSchema.safeParse({
      ...installation.backend,
      sanitizedOrigin: 'gateway.example.test:8443',
    }).success,
    true,
  )

  assert.equal(
    ProviderCompatibilityObservationSchema.safeParse({
      ...installation.compatibility,
      state: 'incompatible',
      runtimeReadiness: 'ready',
    }).success,
    false,
  )
  assert.equal(
    ProviderBackendObservationSchema.safeParse({
      ...installation.backend,
      sanitizedOrigin: 'https://user:secret@gateway.example.test/path?q=x',
    }).success,
    false,
  )
  assert.equal(
    ProviderBackendObservationSchema.safeParse({
      ...installation.backend,
      mode: 'custom_gateway',
      configuration: {
        ...installation.backend.configuration,
        hasBaseUrl: false,
      },
    }).success,
    false,
  )
  assert.equal(
    ProviderBackendObservationSchema.safeParse({
      ...installation.backend,
      mode: 'unknown',
      readiness: 'misconfigured',
      sanitizedOrigin: undefined,
      configuration: {
        ...installation.backend.configuration,
        bedrockConfigured: true,
        vertexConfigured: true,
      },
    }).success,
    true,
  )
})

test('requires current observations to bind to an executable revision', () => {
  const installation = providerLifecycle().installations[0]
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      revision: undefined,
    }).success,
    false,
  )
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      compatibility: undefined,
      revision: undefined,
    }).success,
    false,
  )
  const unavailableCapabilities = Object.fromEntries(
    Object.keys(installation.compatibility.capabilities).map((name) => [
      name,
      { observed: 'unavailable', enabled: false, effective: false },
    ]),
  )
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      availability: 'unavailable',
      revision: undefined,
      compatibility: {
        state: 'unavailable',
        runtimeReadiness: 'unavailable',
        freshness: 'current',
        contractVersion: 1,
        observedAt,
        capabilities: unavailableCapabilities,
      },
    }).success,
    true,
  )
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      availability: 'unavailable',
    }).success,
    false,
  )
  assert.equal(
    ProviderCompatibilityObservationSchema.safeParse({
      ...installation.compatibility,
      freshness: 'not_observed',
      observedAt: undefined,
    }).success,
    false,
  )
})

test('required execution and streaming contracts cannot be presented as compatible when ineffective', () => {
  const compatibility = providerLifecycle().installations[0].compatibility
  for (const capabilityName of ['execution', 'streaming']) {
    assert.equal(
      ProviderCompatibilityObservationSchema.safeParse({
        ...compatibility,
        capabilities: {
          ...compatibility.capabilities,
          [capabilityName]: {
            observed: 'unsupported',
            enabled: true,
            effective: false,
          },
        },
      }).success,
      false,
    )
  }
})

test('adds lifecycle detail to Provider refresh without permitting orphan or duplicate Provider groups', () => {
  const lifecycle = providerLifecycle()
  const refresh = {
    machineId: 'machine_lifecycle01',
    providers: [providerDescriptor('claude-code')],
    providerLifecycles: [lifecycle],
    providerDiscovery: { state: 'current', observedAt },
  }
  assert.deepEqual(RefreshMachineProvidersDataSchema.parse(refresh), refresh)
  assert.equal(
    RefreshMachineProvidersDataSchema.safeParse({
      ...refresh,
      providers: [providerDescriptor('codex')],
    }).success,
    false,
  )
  assert.equal(
    RefreshMachineProvidersDataSchema.safeParse({
      ...refresh,
      providerLifecycles: [lifecycle, lifecycle],
    }).success,
    false,
  )
})

test('conversation lifecycle projection must match the immutable Conversation Provider', () => {
  const installation = providerLifecycle().installations[0]
  const response = {
    protocolVersion: 1,
    conversation: {
      conversationId: 'conv_lifecycle01',
      projectId: 'proj_lifecycle01',
      machineId: 'machine_lifecycle01',
      title: 'Lifecycle test',
      titleSource: 'generated',
      provider: 'claude-code',
      status: 'idle',
      createdAt: observedAt,
      updatedAt: observedAt,
      lastActivityAt: observedAt,
    },
    providerLifecycle: installation,
    runtime: {
      conversationId: 'conv_lifecycle01',
      turns: [],
      messages: [],
      tools: [],
      changes: [],
      terminal: { text: '', truncated: false },
      history: {
        evictedTurns: 0,
        evictedMessages: 0,
        evictedTools: 0,
        evictedChanges: 0,
        truncated: false,
      },
    },
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 0,
      totalTurnCount: 0,
    },
    pendingApprovals: [],
    approvalHistory: [],
  }
  assert.deepEqual(GetConversationResponseSchema.parse(response), response)
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      conversation: { ...response.conversation, provider: 'codex' },
    }).success,
    false,
  )
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      conversation: {
        ...response.conversation,
        providerInstallationId: installation.installationId,
      },
    }).success,
    false,
  )
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      launcherPath: '/private/provider/claude',
    }).success,
    false,
  )
  assert.equal(
    ProviderInstallationSummarySchema.safeParse({
      ...installation,
      backend: {
        ...installation.backend,
        configuration: {
          ...installation.backend.configuration,
          authToken: 'must-never-cross-the-protocol',
        },
      },
    }).success,
    false,
  )
})

function providerLifecycle() {
  const supported = (enabled = true) => ({
    observed: 'supported',
    enabled,
    effective: enabled,
  })
  return {
    provider: 'claude-code',
    selectedInstallationId: 'pinst_claude_primary0001',
    installations: [
      {
        installationId: 'pinst_claude_primary0001',
        provider: 'claude-code',
        selected: true,
        version: '2.1.263',
        launcherKind: 'symlink',
        installMethod: 'native_installer',
        availability: 'available',
        revision: 'prev_claude_primary0001',
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        compatibility: {
          state: 'verified',
          runtimeReadiness: 'ready',
          freshness: 'current',
          contractVersion: 1,
          observedAt,
          capabilities: {
            execution: supported(),
            streaming: supported(),
            nativeResume: supported(),
            nativeSessionDiscovery: supported(),
            fileRead: supported(),
            search: supported(),
            toolEvents: supported(),
            reasoningControl: supported(),
          },
        },
        backend: {
          mode: 'custom_gateway',
          readiness: 'unavailable',
          freshness: 'current',
          configurationRevision: 'pbcfg_claude_primary0001',
          configuration: {
            source: 'process_environment',
            hasBaseUrl: true,
            hasApiKey: false,
            hasAuthToken: true,
            hasOAuthToken: false,
            bedrockConfigured: false,
            vertexConfigured: false,
          },
          sanitizedOrigin: 'https://gateway.example.test',
          observedAt,
          failure: {
            reason: 'provider_service_unavailable',
            category: 'provider',
            retryability: 'retry_later',
            userAction: 'wait',
            source: 'provider',
            occurredAt: observedAt,
            technicalCode: 'provider_service_unavailable',
          },
        },
      },
    ],
  }
}

function providerDescriptor(provider) {
  return {
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    availability: 'available',
    capabilities: {
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
    },
  }
}
