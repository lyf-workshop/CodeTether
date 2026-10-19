import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'
import {
  parseRelayConfigurationInput,
  relayConnectivityPresentation,
} from '../.tmp/test-dist/components/machines/machine-relay-presentation.js'

const source = (name) =>
  readFile(new URL('../src/' + name, import.meta.url), 'utf8')

test('onboarding first-party service and authentication guidance use Chinese tool terminology', () => {
  const { backendModeLabel, providerRepairText } = loadWebComponent(
    'components/onboarding/onboarding-model.ts',
  )
  assert.equal(backendModeLabel({ mode: 'first_party' }), '官方 AI 服务')
  const copy = providerRepairText({
    freshness: 'current',
    installed: true,
    compatibility: 'verified',
    runtimeReadiness: 'ready',
    backend: { mode: 'first_party', readiness: 'authentication_required' },
  })
  assert.match(copy, /AI 工具的官方登录流程/u)
  assert.doesNotMatch(copy, /Provider/u)
})

test('shared diff presentation uses Chinese labels without changing the file or hunk contents', () => {
  const { DiffCard } = loadUiComponent('components/product/diff-card.tsx')
  const fileName = 'src/ProviderController.ts'
  const content = 'Machine Controller Diff relay.example.com'
  const html = renderToStaticMarkup(
    createElement(DiffCard, {
      fileName,
      lines: [{ kind: 'addition', content, newLineNumber: 4 }],
    }),
  )
  assert.match(
    html,
    /<section aria-label="src\/ProviderController\.ts 的变更"/u,
  )
  assert.match(html, />变更<\/span>/u)
  assert.match(html, /src\/ProviderController\.ts/u)
  assert.match(html, /Machine Controller Diff relay\.example\.com/u)
  assert.match(html, /data-kind="addition"/u)
  assert.match(html, /新增/u)
})

test('conversation change fallback explains unavailable difference content in Chinese', async () => {
  const timeline = await source(
    'components/conversation/conversation-timeline.tsx',
  )
  assert.match(timeline, /文件已变更，CodeTether 未提供可展示的差异内容/u)
  assert.doesNotMatch(timeline, /未提供可展示的 Diff/u)
  assert.match(timeline, /<DiffCard/u)
})

test('advanced device connection UI uses Chinese ordinary labels and display-name example', async () => {
  const section = await source('components/machines/machine-relay-section.tsx')
  for (const text of [
    '受限的设备传输',
    'label="互联网执行"',
    '当前不能承载新的设备执行',
    'label="设备传输"',
    '设置本地控制端的出站 Relay 控制连接',
    'placeholder="我的中继服务"',
    '重新注册同一本地控制端身份',
    '将现有本地控制端身份注册到 Relay',
  ])
    assert.ok(section.includes(text), text)
  assert.doesNotMatch(
    section,
    /受限的 Machine|新的 Machine|label="Machine 传输"|label="Internet 执行"|placeholder="Owner Relay"|\bController\b/u,
  )
})

test('relay guidance translates ordinary control-side subjects without changing state truth', () => {
  assert.deepEqual(relayConnectivityPresentation('connected'), {
    label: '已连接',
    description: '本地控制端已通过身份验证连接到 Internet Relay。',
    tone: 'success',
  })
  assert.match(
    relayConnectivityPresentation('authentication_failed').description,
    /无法验证此本地控制端；电脑配对信任未发生变化/u,
  )
  assert.match(
    relayConnectivityPresentation('revoked').description,
    /此本地控制端已被 Relay 撤销/u,
  )
  assert.match(
    relayConnectivityPresentation('revoked').description,
    /普通重连会被拒绝.*新的一次性令牌/u,
  )
})

test('locale cleanup preserves raw connection values, endpoint examples and caller display names', async () => {
  const section = await source('components/machines/machine-relay-section.tsx')
  for (const exact of [
    'value={relay.state}',
    'value={relay.enrollment}',
    "relay.internetExecutionEnabled ? 'eligible' : 'unavailable'",
    'value={relay.relayIdentityFingerprint',
    'value={relay.failure?.technicalCode',
    'placeholder="relay.example.com"',
    '<option value="public_ca">',
    '<option value="pinned_identity">',
    'type="password"',
    "setToken('')",
  ])
    assert.ok(section.includes(exact), exact)
  assert.equal(
    parseRelayConfigurationInput({
      host: 'relay.example.com',
      port: '443',
      transportSecurity: 'public_ca',
      relayIdentityFingerprint: 'A'.repeat(43),
      displayLabel: ' Owner Relay ',
    }).displayLabel,
    'Owner Relay',
  )
})
