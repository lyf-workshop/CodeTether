import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { conversationOrganizationSource } from './fixtures/conversation-organization-source.mjs'

const source = (name) =>
  name.endsWith('/conversation-organization-controls.tsx')
    ? conversationOrganizationSource()
    : readFile(new URL('../src/' + name, import.meta.url), 'utf8')
const prefix = 'components/conversations/'

test('F14–16 use one settings dialog with the original canonical mutation and synchronous close guards', async () => {
  const controls = await source(
    prefix + 'conversation-organization-controls.tsx',
  )
  assert.match(controls, /<DialogTitle>会话设置<\/DialogTitle>/u)
  assert.match(controls, /<ConversationSettingsFields/u)
  assert.match(controls, /operationPendingRef\.current/u)
  assert.match(controls, /menuOperationPendingRef\.current/u)
  assert.match(
    controls,
    /useState<\s*'settings' \| 'archive' \| null\s*>\(null\)/u,
  )
  assert.doesNotMatch(controls, /\[renameOpen,|\[archiveOpen,/u)
  assert.match(
    controls,
    /if \(!nextOpen && operationPendingRef\.current\) return/u,
  )
  for (const action of [
    'renameConversation',
    'pinConversation',
    'unpinConversation',
    'archiveConversation',
    'unarchiveConversation',
  ])
    assert.ok(controls.includes('runtime.' + action + '('), action)
  assert.doesNotMatch(
    controls,
    /createActionId|actionId:|startTurn|createConversation|setQueryData/u,
  )
  assert.match(controls, /conversationOrganizationErrorMessage/u)
  assert.match(controls, /returnFocus/u)
  assert.match(controls, /restoreTriggerFocus/u)
  const fields = await source(prefix + 'conversation-settings-fields.tsx')
  assert.doesNotMatch(fields, /style=|!important/u)
})

test('settings reads the exact immutable device location and never chooses another location', async () => {
  const controls = await source(
    prefix + 'conversation-organization-controls.tsx',
  )
  assert.match(
    controls,
    /conversationDetailQueryOptions\(\s*runtime,\s*conversation\.conversationId,?\s*\)/u,
  )
  assert.match(
    controls,
    /projectLocationForMachine\(\s*project\.data,\s*detail\.data\.conversation\.machineId,?\s*\)/u,
  )
  assert.match(controls, /enabled: detail\.data !== undefined/u)
  assert.match(
    controls,
    /candidate\.machineId === detail\.data\?\.conversation\.machineId/u,
  )
  assert.doesNotMatch(
    controls,
    /locations\[0\]|soleProjectLocation|selectMachine|selectProvider|probeProvider|refreshMachineProviders/u,
  )
})

test('active rows expose hover and keyboard pin/archive without nesting actions in navigation', async () => {
  const [controls, group] = await Promise.all([
    source(prefix + 'conversation-organization-controls.tsx'),
    source(prefix + 'conversation-group.tsx'),
  ])
  assert.match(group, /quickActions=\{!archived\}/u)
  assert.match(group, /group\/conversation-row/u)
  assert.match(group, /group-focus-within\/conversation-row:opacity-100/u)
  assert.match(controls, /data-slot="conversation-quick-pin"/u)
  assert.match(controls, /data-slot="conversation-quick-archive"/u)
  assert.match(
    controls,
    /disabled=\{archiveBlockedReason !== undefined \|\| menuBusy\}/u,
  )
  assert.match(controls, /onClick=\{openQuickArchive\}/u)
  assert.match(group, /primaryAction=\{/u)
  assert.match(group, /actions=\{organizationActions\}/u)
})

function fields(options = {}) {
  const { ConversationSettingsFields } = loadWebComponent(
    prefix + 'conversation-settings-fields.tsx',
  )
  return renderToStaticMarkup(
    h(ConversationSettingsFields, {
      conversationId: 'conv_settings_fixture',
      title: '现有会话',
      pinned: false,
      archived: false,
      pending: false,
      location: {
        machineName: '远程设备',
        projectName: '项目',
        rootPath: '/exact/project',
        providerName: 'Codex',
      },
      onTitleChange() {},
      onPinChange() {},
      onArchiveChange() {},
      ...options,
    }),
  )
}

test('settings fields render approved name, read-only location, pin and archive with bounded title feedback', () => {
  const html = fields({ pinned: true })
  assert.match(html, /名称/u)
  assert.match(html, /位置/u)
  assert.match(html, /远程设备/u)
  assert.match(html, /\/exact\/project/u)
  assert.match(html, /不能移动/u)
  assert.match(html, /240/u)
  assert.equal((html.match(/role="switch"/gu) ?? []).length, 2)
  assert.match(switchElement(html, '置顶会话'), /aria-checked="true"/u)
  assert.doesNotMatch(html, /role="combobox"|<select|type="file"/u)
})

test('running and waiting settings explain the archive boundary while archived cannot pin', () => {
  for (const reason of [
    '运行中的会话暂时不能归档。',
    '当前会话仍在等待你的确认。',
  ]) {
    const html = fields({ archiveBlockedReason: reason })
    assert.match(html, new RegExp(reason, 'u'))
    assert.match(switchElement(html, '归档会话'), /disabled=""/u)
  }
  const archived = fields({ archived: true })
  assert.match(archived, /已归档的会话不能置顶/u)
  assert.match(switchElement(archived, '置顶会话'), /disabled=""/u)
  assert.match(archived, /归档会取消置顶/u)
})

test('unknown location and mutation errors stay explicit with no fabricated local fallback', () => {
  const html = fields({
    location: undefined,
    locationMessage: '位置暂时无法读取。',
    error: '无法保存，请重试。',
    pending: true,
  })
  assert.match(html, /位置暂时无法读取/u)
  assert.match(html, /role="alert"/u)
  assert.doesNotMatch(html, /这台电脑|\/exact\/project/u)
  assert.match(switchElement(html, '置顶会话'), /disabled=""/u)
})

function switchElement(html, label) {
  const element = [...html.matchAll(/<button\b[^>]+>/gu)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`aria-label="${label}"`))
  assert.ok(element, label)
  assert.match(element, /role="switch"/u)
  return element
}

test('quick archive cannot leave a stale menu-focus flag and restores its own trigger', async () => {
  const controls = await source(
    prefix + 'conversation-organization-controls.tsx',
  )
  assert.match(controls, /dialogOpeningRef\.current = menuOpen/u)
  assert.match(controls, /archiveTriggerRef\.current = event\.currentTarget/u)
  assert.match(
    controls,
    /returnFocus=\{\(\) => archiveTriggerRef\.current \?\? triggerRef\.current\}/u,
  )
})

test('settings title prevalidation reuses the unchanged normalized Protocol title contract', async () => {
  const controls = await source(
    prefix + 'conversation-organization-controls.tsx',
  )
  assert.match(
    controls,
    /ManualConversationTitleSchema\.safeParse\(title\)\.success/u,
  )
  assert.doesNotMatch(controls, /title\.length > 240/u)
  const { ManualConversationTitleSchema } = await import('@codetether/protocol')
  assert.equal(
    ManualConversationTitleSchema.safeParse(' '.repeat(250) + '有效名称')
      .success,
    true,
  )
  assert.equal(
    ManualConversationTitleSchema.safeParse('a'.repeat(241)).success,
    false,
  )
  assert.equal(ManualConversationTitleSchema.safeParse('   ').success, false)
})
