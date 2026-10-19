import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const {
  MachinePairingEntry,
  MachinePairingConfirmation,
  MachinePairingComplete,
} = loadWebComponent('components/machines/machine-pairing-steps.tsx')
const { NodeSetupInstructions } = loadWebComponent(
  'components/machines/node-setup-instructions.tsx',
)
const noop = () => {}
const pairing = {
  address: '',
  pairingCode: '',
  busy: false,
  otherTrustBusy: false,
  beginning: false,
  error: '',
  addressInvalid: false,
  pairingCodeInvalid: false,
  handleSubmit: noop,
  setAddress: noop,
  setPairingCode: noop,
}
const candidate = {
  pairingAttemptId: 'attempt_private',
  machineId: 'machine_not_yet_trusted',
  displayName: '开发设备',
  platform: 'Linux',
  architecture: 'aarch64',
  verificationCode: '314159',
  expiresAt: '2026-10-20T15:20:00.000Z',
  address: { host: '192.0.2.2', port: 4318 },
}
const machine = {
  machineId: 'machine_confirmed',
  displayName: '远程开发设备',
  platform: 'Linux',
  architecture: 'aarch64',
}

test('actual entry keeps keyboard labels, one-time numeric bounds, and no secret URL', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingEntry, { pairing, onBack: noop }),
  )
  assert.match(html, /data-machine-pairing-step="entry"/u)
  assert.match(html, /设备地址或配对链接/u)
  assert.match(html, /autoComplete="one-time-code"/u)
  assert.match(html, /inputMode="numeric"/u)
  assert.match(html, /maxLength="6"/u)
  assert.match(html, /pattern="\[0-9\]\{6\}"/u)
  assert.doesNotMatch(html, /href=|action=/u)
})
test('actual field errors bind aria-invalid and aria-errormessage to the visible alert', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingEntry, {
      pairing: { ...pairing, pairingCodeInvalid: true, error: '配对码已过期' },
      onBack: noop,
    }),
  )
  assert.match(html, /aria-invalid="true"/u)
  assert.match(html, /aria-errormessage="([^"]+)"/u)
  const errorId = html.match(/aria-errormessage="([^"]+)"/u)[1]
  assert.ok(html.includes(`id="${errorId}"`))
  assert.match(html, /role="alert"/u)
  assert.match(html, /配对码已过期/u)
})
test('another real trust flow disables both inputs and submit without hiding back', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingEntry, {
      pairing: { ...pairing, otherTrustBusy: true },
      onBack: noop,
    }),
  )
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 3)
  assert.match(html, /上一步/u)
})
test('confirmation displays returned verification, exact address and no untrusted IDs', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingConfirmation, {
      candidate,
      error: '',
      busy: false,
      confirming: false,
      onBack: noop,
      onConfirm: noop,
    }),
  )
  assert.match(html, /314159/u)
  assert.match(html, /192\.0\.2\.2:4318/u)
  assert.match(html, /验证码一致，确认配对/u)
  assert.doesNotMatch(html, /machine_not_yet_trusted|attempt_private/u)
})
test('Relay candidate confirmation says Relay, not fabricated LAN endpoint', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingConfirmation, {
      candidate: { ...candidate, address: undefined },
      error: '',
      busy: true,
      confirming: true,
      onBack: noop,
      onConfirm: noop,
    }),
  )
  assert.match(html, /通过 Relay/u)
  assert.match(html, /正在建立信任/u)
  assert.doesNotMatch(html, /192\.0\.2\.2/u)
  assert.equal((html.match(/disabled=""/gu) ?? []).length, 2)
})
test('completion requires real Machine props and never claims Provider execution Ready', () => {
  const html = renderToStaticMarkup(
    h(MachinePairingComplete, {
      machine,
      onAddProject: noop,
      onViewDevice: noop,
    }),
  )
  assert.match(html, /设备已配对/u)
  assert.match(html, /添加项目/u)
  assert.match(html, /已配对不等于可以执行/u)
  assert.match(html, /恢复原 Node 后台服务/u)
  assert.doesNotMatch(html, /machine_confirmed|现在可以.*运行/u)
})
test('shared setup has real service stop/pair/start, supported platforms and state warning', () => {
  const html = renderToStaticMarkup(
    h(NodeSetupInstructions, { platform: 'macos' }),
  )
  assert.match(html, /Linux x64 \/ ARM64、macOS ARM64/u)
  assert.match(html, /Windows 暂时不能作为配对设备/u)
  assert.match(html, /service stop/u)
  assert.match(html, /--pair --data-dir/u)
  assert.match(html, /service start/u)
  assert.match(html, /原服务实际使用的同一目录/u)
  assert.match(html, /默认只在本机监听/u)
  assert.doesNotMatch(html, /sudo |\.bashrc|\.zshrc|--bind 0\.0\.0\.0/u)
})
