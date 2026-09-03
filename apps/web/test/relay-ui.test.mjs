import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  parseRelayConfigurationInput,
  relayCanRetry,
  relayConnectivityPresentation,
  relayEndpointLabel,
  relayNodePresenceLabel,
} from '../.tmp/test-dist/components/machines/machine-relay-presentation.js'

const sourceRoot = new URL('../src/', import.meta.url)

test('Relay presentation exhaustively distinguishes connection and presence truth', () => {
  const states = [
    ['not_configured', '未配置'],
    ['enrollment_required', '需要注册'],
    ['connecting', '正在连接'],
    ['connected', '已连接'],
    ['reconnecting', '正在重连'],
    ['offline', '离线'],
    ['identity_mismatch', '身份不匹配'],
    ['authentication_failed', '身份验证失败'],
    ['revoked', '注册已撤销'],
    ['incompatible', '版本不兼容'],
  ]
  for (const [state, label] of states) {
    const presentation = relayConnectivityPresentation(state)
    assert.equal(presentation.label, label)
    assert.ok(presentation.description.length > 0)
    assert.ok(presentation.tone.length > 0)
  }

  assert.equal(relayNodePresenceLabel('not_observed'), '尚未观察')
  assert.equal(relayNodePresenceLabel('online'), '在线')
  assert.equal(relayNodePresenceLabel('offline'), '离线')
  assert.equal(relayNodePresenceLabel('unauthorized'), '未获授权')
})

test('Relay configuration parser accepts only bounded typed endpoint and identity input', () => {
  const parsed = parseRelayConfigurationInput({
    host: 'relay.example.com',
    port: '443',
    transportSecurity: 'public_ca',
    relayIdentityFingerprint: 'A'.repeat(43),
    displayLabel: ' Owner Relay ',
  })
  assert.deepEqual(parsed, {
    endpoint: {
      host: 'relay.example.com',
      port: 443,
      transportSecurity: 'public_ca',
    },
    relayIdentityFingerprint: 'A'.repeat(43),
    displayLabel: 'Owner Relay',
  })
  assert.equal(relayEndpointLabel(parsed.endpoint), 'relay.example.com:443')
  assert.equal(
    relayEndpointLabel({
      host: '2001:db8::1',
      port: 443,
      transportSecurity: 'pinned_identity',
    }),
    '[2001:db8::1]:443',
  )

  for (const invalid of [
    { host: 'https://relay.example.com', port: '443' },
    { host: 'relay.example.com', port: '0' },
    { host: 'relay.example.com', port: '443', fingerprint: 'short' },
  ]) {
    assert.equal(
      parseRelayConfigurationInput({
        host: invalid.host,
        port: invalid.port,
        transportSecurity: 'public_ca',
        relayIdentityFingerprint: invalid.fingerprint ?? 'A'.repeat(43),
        displayLabel: '',
      }),
      undefined,
    )
  }
})

test('Retry is offered only to enrolled terminal connection failures', () => {
  assert.equal(relayCanRetry(relay('offline', 'enrolled')), true)
  assert.equal(relayCanRetry(relay('authentication_failed', 'enrolled')), true)
  assert.equal(relayCanRetry(relay('identity_mismatch', 'enrolled')), false)
  assert.equal(relayCanRetry(relay('revoked', 'revoked')), false)
  assert.equal(relayCanRetry(relay('enrollment_required', 'required')), false)
})

test('Machine Detail Relay UI stays Host-owned, accessible, bounded, and execution-disabled', async () => {
  const [detail, section, actions] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-relay-section.tsx'),
    source('runtime/host/relay-actions.ts'),
  ])

  assert.match(detail, /<MachineRelaySection/u)
  assert.match(detail, /relay=\{machineQuery\.data\.relay\}/u)
  assert.match(section, /aria-labelledby="machine-relay-heading"/u)
  assert.match(section, /role="status"/u)
  assert.match(section, /role="alert"/u)
  assert.match(section, /<details/u)
  assert.match(section, /<summary/u)
  assert.match(section, /type="checkbox"/u)
  assert.match(section, /type="password"/u)
  assert.match(section, /autoComplete="off"/u)
  assert.match(section, /setToken\(''\)/u)
  assert.match(section, /onBlur=/u)
  assert.match(section, /maxLength=\{56\}/u)
  assert.match(section, /maxLength=\{43\}/u)
  assert.match(section, /maxLength=\{253\}/u)
  assert.match(section, /Internet Relay 执行尚未启用/u)
  assert.match(section, /Agent 执行仍只使用现有局域网直连/u)
  assert.match(section, /使用新令牌重新注册/u)
  assert.match(section, /撤销后的普通重连仍会被拒绝/u)
  assert.match(section, /lg:grid-cols/u)
  assert.match(section, /break-all/u)

  assert.match(actions, /configureMachineRelay/u)
  assert.match(actions, /enrollMachineRelay/u)
  assert.match(actions, /retryMachineRelay/u)
  assert.match(actions, /disconnectMachineRelay/u)
  assert.match(actions, /removeMachineRelay/u)
  assert.doesNotMatch(section, /WebSocket|fetch\(|wss?:\/\//u)
  assert.doesNotMatch(
    section,
    /localStorage|sessionStorage|zustand|location\./iu,
  )
  assert.doesNotMatch(actions, /JSON\.stringify\([^)]*enrollmentToken/isu)
  assert.doesNotMatch(section, /Prompt|Provider output|Conversation event/u)
})

function relay(state, enrollment) {
  return {
    state,
    enrollment,
    nodePresence: 'not_observed',
    internetExecutionEnabled: false,
    endpoint: {
      host: 'relay.example.com',
      port: 443,
      transportSecurity: 'public_ca',
    },
    relayIdentityFingerprint: 'A'.repeat(43),
  }
}

async function source(path) {
  return await readFile(new URL(path, sourceRoot), 'utf8')
}
