import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { CodeTetherResponseError } from '@codetether/client'
import { machineErrorMessage } from '../.tmp/test-dist/runtime/host/machine-actions.js'
import { relayErrorMessage } from '../.tmp/test-dist/runtime/host/relay-actions.js'

const error = (code) =>
  new CodeTetherResponseError(503, {
    protocolVersion: 1,
    code,
    message: 'private Agent Controller transport diagnostic',
  })

test('provider refresh safe errors use ordinary Chinese tool nouns without changing error authority', () => {
  assert.equal(
    machineErrorMessage(error('machine_unreachable'), 'refresh-providers'),
    '远程电脑当前不可连接，无法刷新 AI 工具信息。',
  )
  assert.equal(
    machineErrorMessage(error('internal'), 'refresh-providers'),
    'CodeTether 未能刷新这台电脑上的 AI 工具信息。',
  )
  assert.equal(
    machineErrorMessage(error('machine_unreachable'), 'retry'),
    '远程电脑当前不可连接，请检查地址和局域网连接。',
  )
})

test('Relay safe errors use the same local-controller noun and preserve trust warnings', () => {
  assert.equal(
    relayErrorMessage(error('relay_authentication_failed')),
    'Relay 无法验证此本地控制端；现有电脑信任关系未更改。',
  )
  assert.equal(
    relayErrorMessage(error('relay_revoked')),
    '此本地控制端的 Relay 注册已被撤销，需要重新注册。',
  )
  assert.equal(
    relayErrorMessage(error('relay_identity_mismatch')),
    'Relay 身份与已确认指纹不一致，CodeTether 已拒绝连接。',
  )
})

test('computer detail presents four sections in order with responsive project cards', async () => {
  const [projects, detail] = await Promise.all([
    readFile(
      new URL(
        '../src/components/machines/machine-projects-section.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../src/components/machines/machine-detail-page.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ])
  assert.match(detail, /className="min-w-0 space-y-9"/u)
  const sections = [
    '<MachineProjectsSection',
    '<MachineConversationsSection',
    '<MachineProvidersSection',
    '<MachineConnectionSection',
  ]
  const positions = sections.map((section) => detail.indexOf(section))
  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  assert.match(projects, /sm:grid-cols-2 desktop:grid-cols-3/u)
  assert.doesNotMatch(detail, /style=\{/u)
})
