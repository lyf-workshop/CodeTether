import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { deriveLiveControlAvailability } from '../.tmp/test-dist/components/conversation/conversation-controls.js'

const { Composer } = loadWebComponent('components/conversation/composer.tsx')
const capabilities = {
  canCompose: true,
  canInterrupt: false,
  canStop: false,
  canResolveApproval: false,
  supportsInterrupt: false,
  supportsApprovals: false,
  supportsDiff: false,
  supportsShell: false,
  supportsToolOutput: false,
  supportsReasoningControl: false,
}
const context = {
  machineId: 'machine_owner',
  projectId: 'proj_owner',
  machineName: '这台电脑',
  machineKind: 'local',
  projectName: '支付项目',
  projectPath: 'C:\\工作区\\支付项目',
  readSearchOnly: false,
}

test('ready composer renders the real editable textarea and canonical form', () => {
  const markup = render()
  assert.match(markup, /aria-label="会话输入区"/u)
  assert.match(markup, /data-composer-state="ready"/u)
  assert.match(markup, /<textarea[^>]*id="conversation-composer"/u)
  assert.doesNotMatch(markup, /hidden=""|readOnly=""/u)
  assert.match(markup, /支付项目 · 这台电脑/u)
})

test('running gate keeps the draft editor mounted but hidden and readonly', () => {
  const markup = render({
    capabilities: { ...capabilities, canCompose: false },
    controller: controller('running'),
  })
  assert.match(markup, /data-composer-state="running"/u)
  assert.match(markup, /hidden=""[^>]*data-composer-editor/u)
  assert.match(markup, /<textarea[^>]*readOnly=""/u)
  assert.match(markup, /Codex 正在工作/u)
  assert.match(markup, /草稿会保留/u)
})

test('stop exists once only for a descriptor-supported known local active Turn', () => {
  const markup = render({
    capabilities: {
      ...capabilities,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    controller: controller('running'),
    interruptController: { pending: false, async execute() {} },
  })
  assert.equal((markup.match(/>停止<\/button>/gu) ?? []).length, 1)
})

test('paired session never renders Stop and explicitly explains that boundary', () => {
  const markup = render({
    context: { ...context, machineKind: 'remote' },
    capabilities: {
      ...capabilities,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    controller: controller('running'),
    interruptController: { pending: false, async execute() {} },
  })
  assert.doesNotMatch(markup, />停止<\/button>/u)
  assert.match(markup, /配对设备.+这里不能停止/u)
})

test('archive swaps visible input for a real restore action without deleting the textarea', () => {
  const markup = render({
    archived: true,
    recoveryAction: h('button', { type: 'button' }, '恢复会话'),
  })
  assert.match(markup, /data-composer-state="archived"/u)
  assert.match(markup, /<textarea/u)
  assert.match(markup, /恢复会话/u)
  assert.match(markup, /历史记录仍可查看/u)
})

test('read and search limitation is shown from context capabilities, not a name check', () => {
  const markup = render({
    providerName: '测试 AI 工具',
    context: { ...context, readSearchOnly: true },
  })
  assert.match(markup, /测试 AI 工具 在这里只读取和搜索文件，不会修改代码/u)
})

test('canonical errors remain visible and do not replace state or invent retry work', () => {
  const markup = render({
    externalError: '消息尚未发送，请检查连接。',
    controller: controller('unavailable'),
    recoveryAction: h('a', { href: '/devices/machine_owner' }, '查看设备'),
  })
  assert.match(markup, /role="alert"/u)
  assert.match(markup, /消息尚未发送，请检查连接/u)
  assert.match(markup, /查看设备/u)
  assert.doesNotMatch(markup, /重新发送|自动重试/u)
})

function render(overrides = {}) {
  return renderToStaticMarkup(
    h(Composer, {
      capabilities,
      controller: controller('idle'),
      context,
      providerName: 'Codex',
      ...overrides,
    }),
  )
}

function controller(state) {
  return {
    state,
    async submit() {
      return false
    },
  }
}

for (const [reason, title] of [
  ['project_location_missing', '这台电脑缺少项目位置'],
  ['project_location_invalid', '已注册的项目位置已改变'],
  ['project_location_unavailable', '项目位置当前不可用'],
]) {
  test(
    'project gate preserves typed reason, history, safety reassurance and repair action: ' +
      reason,
    () => {
      const markup = render({
        capabilities: {
          ...capabilities,
          canCompose: false,
          composerDisabled: {
            reason: 'project_location_unavailable',
            message: '这台电脑当前无法访问已注册的项目位置。',
            navigation: 'project',
          },
        },
        controller: controller('unavailable'),
        projectBoundary: {
          projectId: context.projectId,
          projectName: context.projectName,
          reason,
        },
        recoveryAction: h(
          'a',
          {
            href: '/projects/proj_owner?machineId=machine_owner',
            'aria-label': '查看支付项目的项目详情',
          },
          '查看项目',
        ),
      })
      assert.match(markup, /data-composer-state="unavailable"/u)
      assert.match(markup, /role="status"/u)
      assert.ok(markup.includes(title))
      assert.match(markup, /历史记录仍可查看/u)
      assert.match(markup, /不会改用其他目录/u)
      if (reason !== 'project_location_missing')
        assert.match(markup, /CodeTether 未删除项目文件/u)
      assert.match(
        markup,
        /href="\/projects\/proj_owner\?machineId=machine_owner"/u,
      )
      assert.match(markup, /aria-label="查看支付项目的项目详情"/u)
      assert.match(markup, /<textarea[^>]*readOnly=""/u)
      assert.match(markup, /hidden=""[^>]*data-composer-editor/u)
      assert.doesNotMatch(markup, />停止<\/button>|重新发送|自动重试/u)
    },
  )
}

for (const [scenario, kind, canonicalInterrupt, expectedStops] of [
  ['local project unavailable with owned active turn', 'local', true, 1],
  ['local backend unavailable with owned active turn', 'local', true, 1],
  ['remote stale positive capability', 'remote', true, 0],
  ['unknown machine provenance', undefined, true, 0],
  ['connection not authoritative', 'local', false, 0],
  ['archived owned active turn', 'local', true, 0],
]) {
  test(
    'unavailable Composer preserves canonical Stop authority: ' + scenario,
    () => {
      const disabled = {
        reason: scenario.includes('backend')
          ? 'provider_service_unavailable'
          : 'project_location_unavailable',
        message: '当前不能开始新轮次。',
        navigation: scenario.includes('backend') ? 'machine' : 'project',
      }
      const canonical = deriveLiveControlAvailability(
        canonicalInterrupt ? 'connected' : 'reconnecting',
        {
          streaming: true,
          interrupt: true,
          approvals: false,
          diff: false,
          shell: false,
          toolEvents: false,
          reasoningControl: false,
        },
        'running',
        disabled,
      )
      assert.equal(canonical.canInterrupt, canonicalInterrupt)
      const markup = render({
        context: { ...context, machineKind: kind },
        capabilities: {
          ...capabilities,
          ...canonical,
        },
        archived: scenario.includes('archived'),
        controller: controller('unavailable'),
        interruptController: { pending: false, async execute() {} },
        projectBoundary:
          disabled.navigation === 'project'
            ? {
                projectId: context.projectId,
                projectName: context.projectName,
                reason: 'project_location_unavailable',
              }
            : undefined,
      })
      assert.equal(
        (markup.match(/>停止<\/button>/gu) ?? []).length,
        expectedStops,
      )
      assert.match(
        markup,
        scenario.includes('archived')
          ? /data-composer-state="archived"/u
          : /data-composer-state="unavailable"/u,
      )
      assert.match(markup, /hidden=""[^>]*data-composer-editor/u)
      assert.match(markup, /<textarea[^>]*readOnly=""/u)
    },
  )
}
