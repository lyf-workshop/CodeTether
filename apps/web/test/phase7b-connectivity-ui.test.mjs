import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MachineSummarySchema,
  RelayMachineConnectivitySchema,
  RemoteMachineConnectionSchema,
} from '@codetether/protocol'

import {
  deriveComposerEligibility,
  deriveConversationExecutionBoundaryReason,
} from '../.tmp/test-dist/components/conversation/conversation-controls.js'
import {
  relayConnectivityPresentation,
  relayNodePresenceLabel,
} from '../.tmp/test-dist/components/machines/machine-relay-presentation.js'
import { executionFailurePresentation } from '../.tmp/test-dist/failures/failure-presentation.js'

const sourceRoot = new URL('../src/', import.meta.url)
const timestamp = '2026-09-03T20:00:00.000Z'

test('Machine connectivity matrix keeps Direct, Relay, and effective execution truth independent', () => {
  const cases = [
    {
      name: 'Direct and Relay available selects Direct',
      connection: directConnection(),
      relay: connectedRelay(),
      expectedRelay: '已连接',
      expectedPresence: '在线',
      expectedBoundary: undefined,
    },
    {
      name: 'Direct unavailable and Relay available selects Relay',
      connection: relayConnection(),
      relay: connectedRelay(),
      expectedRelay: '已连接',
      expectedPresence: '在线',
      expectedBoundary: undefined,
    },
    {
      name: 'Relay reconnecting exposes reconnecting rather than online',
      connection: unavailableConnection('connecting'),
      relay: configuredRelay({
        state: 'reconnecting',
        nodePresence: 'offline',
      }),
      expectedRelay: '正在重连',
      expectedPresence: '离线',
      expectedBoundary: 'reconnecting',
    },
    {
      name: 'Relay-connected Node offline remains unavailable',
      connection: unavailableConnection('offline'),
      relay: configuredRelay({
        state: 'connected',
        nodePresence: 'offline',
      }),
      expectedRelay: '已连接',
      expectedPresence: '离线',
      expectedBoundary: 'machine_offline',
    },
    {
      name: 'Direct and Relay unavailable remains Machine offline',
      connection: unavailableConnection('offline'),
      relay: configuredRelay({
        state: 'offline',
        nodePresence: 'offline',
      }),
      expectedRelay: '离线',
      expectedPresence: '离线',
      expectedBoundary: 'machine_offline',
    },
  ]

  for (const entry of cases) {
    const connection = RemoteMachineConnectionSchema.parse(entry.connection)
    const relay = RelayMachineConnectivitySchema.parse(entry.relay)
    const machine = remoteMachine(connection)

    assert.equal(
      relayConnectivityPresentation(relay.state).label,
      entry.expectedRelay,
      entry.name,
    )
    assert.equal(
      relayNodePresenceLabel(relay.nodePresence),
      entry.expectedPresence,
      entry.name,
    )
    if (entry.expectedBoundary !== undefined) {
      assert.equal(
        deriveConversationExecutionBoundaryReason(machine),
        entry.expectedBoundary,
        entry.name,
      )
    }

    const composerBoundary = deriveComposerEligibility({
      connectionState: 'connected',
      currentTurnStatus: 'completed',
      machine,
      projectAvailability: 'available',
      provider: availableProvider(),
    })
    assert.equal(composerBoundary?.reason, entry.expectedBoundary, entry.name)
  }
})

test('Relay channel loss, ownership uncertainty, and capacity retain safe recovery semantics', () => {
  const cases = [
    {
      failure: canonicalFailure('relay_channel_lost'),
      title: 'Internet Relay 执行通道已中断',
      noReplay: true,
    },
    {
      failure: canonicalFailure('execution_ownership_uncertain'),
      title: '执行归属无法确认',
      noReplay: true,
    },
    {
      failure: canonicalFailure('relay_transport_capacity_reached'),
      title: 'Internet Relay 执行通道已满',
      noReplay: false,
    },
    {
      failure: canonicalFailure('execution_capacity_reached'),
      title: '执行容量已满',
      noReplay: false,
    },
  ]

  for (const entry of cases) {
    const presentation = executionFailurePresentation({
      code: 'machine_connection_failed',
      message:
        '\u001b[31mECONNRESET\n<script>fake login</script> https://unsafe.invalid',
      details: { authorization: 'Bearer secret', frame: 'raw payload' },
      failure: entry.failure,
    })

    assert.equal(presentation.title, entry.title)
    assert.equal(presentation.canStartNewTurn, false)
    assert.match(presentation.historyNote, /已保存的会话历史仍可查看/u)
    if (entry.noReplay) {
      assert.match(presentation.historyNote, /未自动重新发送原请求/u)
    }
    assert.doesNotMatch(
      JSON.stringify(presentation),
      /ECONNRESET|script|unsafe\.invalid|Bearer|secret|raw payload/iu,
    )
  }
})

test('Machine connectivity surfaces keep responsive and accessible semantic contracts', async () => {
  const [detail, relaySection, failureCard] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-relay-section.tsx'),
    source('components/conversation/conversation-failure-card.tsx'),
  ])

  assert.match(detail, /connection\.directState \?\? connection\.state/u)
  assert.match(detail, /label="当前执行路径"/u)
  assert.match(
    detail,
    /value=\{executionTransportLabel\(connection\.executionTransport\)\}/u,
  )
  assert.match(detail, /label="局域网直连"/u)
  assert.match(detail, /<MachineRelaySection/u)
  assert.doesNotMatch(
    detail,
    /transport(?:Mode)?Select|setExecutionTransport|onTransportChange/u,
  )

  assert.match(relaySection, /aria-labelledby="machine-relay-heading"/u)
  assert.match(relaySection, /id="machine-relay-heading"/u)
  assert.match(relaySection, /role="status"/u)
  assert.match(relaySection, /<dl/u)
  assert.match(relaySection, /<dt/u)
  assert.match(relaySection, /<dd/u)
  assert.match(relaySection, /<details/u)
  assert.match(relaySection, /<summary/u)
  assert.match(relaySection, /focus-visible:ring/u)
  assert.match(relaySection, /aria-hidden="true"/u)
  assert.match(relaySection, /label="Node 在线状态"/u)
  assert.match(relaySection, /label="Internet 执行"/u)
  assert.match(relaySection, /\{status\.description\}/u)
  assert.match(relaySection, /\{value\}[\s\S]*<\/dd>/u)

  assert.match(relaySection, /min-w-0/u)
  assert.match(relaySection, /flex-wrap/u)
  assert.match(relaySection, /lg:grid-cols/u)
  assert.match(relaySection, /overflow-x-hidden/u)
  assert.match(relaySection, /break-words/u)
  assert.match(relaySection, /break-all/u)
  assert.match(detail, /xl:grid-cols-\[minmax\(0,1fr\)_20rem\]/u)

  assert.match(failureCard, /<article/u)
  assert.match(failureCard, /role="status"/u)
  assert.match(failureCard, /aria-live="polite"/u)
  assert.match(failureCard, /aria-labelledby=\{titleId\}/u)
  assert.match(failureCard, /aria-describedby=\{descriptionId\}/u)
  assert.match(failureCard, /<details/u)
  assert.match(failureCard, /<summary/u)
  assert.match(failureCard, /min-w-0/u)
  assert.match(failureCard, /flex-wrap/u)
})

function directConnection() {
  return {
    state: 'online',
    directState: 'online',
    executionTransport: 'direct',
    currentEndpoint: { host: 'node.lan', port: 4317 },
    lastSuccessfulAt: timestamp,
    lastAttemptAt: timestamp,
  }
}

function relayConnection() {
  return {
    state: 'online',
    directState: 'offline',
    executionTransport: 'relay',
    lastSuccessfulAt: timestamp,
    lastAttemptAt: timestamp,
  }
}

function unavailableConnection(state) {
  return {
    state,
    directState: state === 'connecting' ? 'connecting' : 'offline',
    executionTransport: 'unavailable',
    lastAttemptAt: timestamp,
  }
}

function connectedRelay() {
  return configuredRelay({
    state: 'connected',
    nodePresence: 'online',
    internetExecutionEnabled: true,
  })
}

function configuredRelay({
  state,
  nodePresence,
  internetExecutionEnabled = false,
}) {
  return {
    state,
    enrollment: 'enrolled',
    nodePresence,
    internetExecutionEnabled,
    endpoint: {
      host: 'relay.example.com',
      port: 443,
      transportSecurity: 'public_ca',
    },
    relayIdentityFingerprint: 'A'.repeat(43),
    displayLabel: 'Owner Relay',
    lastAttemptAt: timestamp,
    ...(state === 'connected' ? { lastConnectedAt: timestamp } : {}),
  }
}

function remoteMachine(connection) {
  return MachineSummarySchema.parse({
    machineId: 'machine_phase7b_ui_matrix',
    displayName: 'Remote Machine with a deliberately long but bounded name',
    kind: 'remote',
    platform: 'linux',
    architecture: 'x64',
    availability: connection.state === 'online' ? 'available' : 'unavailable',
    connectionState: connection.state,
    trustState: 'trusted',
    isLocal: false,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    capabilities: {
      projectAccess: true,
      providerExecution: connection.executionTransport !== 'unavailable',
      backgroundRuntime: true,
      nativeFolderPicker: false,
      notifications: false,
    },
  })
}

function availableProvider() {
  return {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'available',
    capabilities: { streaming: true, resume: true },
  }
}

function canonicalFailure(reason) {
  const profile = {
    relay_channel_lost: {
      category: 'transport',
      retryability: 'not_retryable',
      userAction: 'view_details',
      source: 'relay',
    },
    execution_ownership_uncertain: {
      category: 'runtime',
      retryability: 'not_retryable',
      userAction: 'view_details',
      source: 'runtime',
    },
    relay_transport_capacity_reached: {
      category: 'runtime',
      retryability: 'retry_later',
      userAction: 'reduce_active_work',
      source: 'relay',
    },
    execution_capacity_reached: {
      category: 'runtime',
      retryability: 'retry_later',
      userAction: 'reduce_active_work',
      source: 'runtime',
    },
  }[reason]
  if (profile === undefined) throw new Error(`Missing profile for ${reason}`)
  return {
    ...profile,
    reason,
    occurredAt: timestamp,
    technicalCode: reason,
  }
}

async function source(path) {
  return await readFile(new URL(path, sourceRoot), 'utf8')
}
