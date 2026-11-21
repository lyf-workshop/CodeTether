import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { deriveLiveControlAvailability } from '../.tmp/test-dist/components/conversation/conversation-controls.js'

const { Composer } = loadWebComponent('components/conversation/composer.tsx')
const { conversationDrafts } = loadWebComponent(
  'components/conversation/conversation-drafts.ts',
)
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
  assert.doesNotMatch(markup, /支付项目 · 这台电脑/u)
})

test('disabled attachment and voice controls leave hover hints on pointer-receiving wrappers', () => {
  const document = new JSDOM(render()).window.document
  for (const label of ['附件即将推出', '语音即将推出']) {
    const button = document.querySelector(`button[aria-label="${label}"]`)
    assert.ok(button)
    assert.equal(button.disabled, true)
    assert.equal(button.classList.contains('pointer-events-none'), true)
    assert.equal(button.parentElement?.getAttribute('title'), '即将推出')
  }
})

test('submitting keeps the mounted editor visible and readonly with Send disabled', () => {
  const markup = render({ controller: controller('submitting') })
  assert.match(markup, /data-composer-state="submitting"/u)
  assert.doesNotMatch(markup, /hidden=""/u)
  assert.match(markup, /<textarea[^>]*readOnly=""/u)
  assert.match(markup, /aria-disabled="true"/u)
  assert.match(markup, /<button[^>]*aria-label="发送消息"[^>]*disabled=""/u)
  assert.match(markup, /title="正在发送消息"/u)
  assert.match(markup, /回车发送，Shift \+ 回车换行/u)
  assert.doesNotMatch(markup, /草稿会保留，CodeTether 不会自动重发消息/u)
  assert.doesNotMatch(markup, /演示/u)
})

test('ready, sending, running and waiting keep the same Composer rows', () => {
  const states = [
    render(),
    render({ controller: controller('submitting') }),
    render({
      capabilities: { ...capabilities, canCompose: false },
      controller: controller('running'),
    }),
    render({
      capabilities: { ...capabilities, canCompose: false },
      controller: controller('waiting'),
    }),
  ]
  const rows = states.map((markup) => {
    const document = new JSDOM(markup).window.document
    const form = document.querySelector('form[data-composer-state]')
    assert.ok(form)
    assert.ok(form.querySelector('[data-composer-editor]'))
    assert.equal(form.querySelector('[data-composer-editor]').hidden, false)
    return [...form.children].map((child) =>
      child.getAttribute('data-composer-editor') === ''
        ? 'editor'
        : child.tagName,
    )
  })
  for (const actual of rows.slice(1)) assert.deepEqual(actual, rows[0])
})

test('running and waiting keep the editor editable, show state in the action bar and block Send', () => {
  const markup = render({
    capabilities: { ...capabilities, canCompose: false },
    controller: controller('running'),
  })
  assert.match(markup, /data-composer-state="running"/u)
  assert.doesNotMatch(markup, /hidden=""[^>]*data-composer-editor/u)
  assert.doesNotMatch(markup, /<textarea[^>]*readOnly=""/u)
  assert.match(markup, /Codex 正在工作/u)
  assert.match(markup, /这一轮结束后：回车发送，Shift \+ 回车换行/u)
  assert.match(markup, /<button[^>]*aria-label="发送消息"[^>]*disabled=""/u)
  assert.doesNotMatch(markup, /min-h-16/u)

  const waiting = render({
    capabilities: { ...capabilities, canCompose: false },
    controller: controller('waiting'),
  })
  assert.doesNotMatch(waiting, /<textarea[^>]*readOnly=""/u)
  assert.match(waiting, /等你批准/u)
  assert.match(waiting, /批准后：回车发送，Shift \+ 回车换行/u)
  assert.match(waiting, /<button[^>]*aria-label="发送消息"[^>]*disabled=""/u)
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
  assert.doesNotMatch(markup, /<button[^>]*aria-label="发送消息"/u)
  assert.match(markup, /class="[^"]*w-20 justify-center/u)
})

test('Claude Code keeps disabled Send with a reason while running', () => {
  const markup = render({
    agent: 'claude',
    providerName: 'Claude Code',
    capabilities: { ...capabilities, canCompose: false },
    controller: controller('running'),
  })
  assert.match(markup, /Claude Code 正在工作/u)
  assert.match(markup, /<button[^>]*aria-label="发送消息"[^>]*disabled=""/u)
  assert.match(markup, /title="这一轮完成后可以发送下一条消息/u)
  assert.doesNotMatch(markup, />停止<\/button>/u)
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
    capabilities: {
      ...capabilities,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    interruptController: { pending: false, async execute() {} },
    recoveryAction: h('button', { type: 'button' }, '恢复会话'),
  })
  assert.match(markup, /data-composer-state="archived"/u)
  assert.match(markup, /<textarea/u)
  assert.match(markup, /恢复会话/u)
  assert.match(markup, /历史记录仍可查看/u)
  assert.doesNotMatch(markup, />停止<\/button>/u)
})

test('unavailable panel without interrupt authority does not offer Stop', () => {
  const markup = render({
    controller: controller('unavailable'),
    capabilities: {
      ...capabilities,
      canInterrupt: false,
      supportsInterrupt: true,
    },
    interruptController: { pending: false, async execute() {} },
  })
  assert.match(markup, /data-composer-state="unavailable"/u)
  assert.doesNotMatch(markup, />停止<\/button>/u)
})

test('read and search limitation moves to the placeholder while Claude keeps the keyboard hint', () => {
  const markup = render({
    agent: 'claude',
    providerName: '测试 AI 工具',
    context: { ...context, readSearchOnly: true },
  })
  assert.match(markup, /placeholder="问 Claude 一个问题（只读取和搜索文件）…"/u)
  assert.match(markup, /回车发送，Shift \+ 回车换行/u)
  assert.doesNotMatch(markup, /在这里只读取和搜索文件，不会修改代码/u)
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
      conversationId: 'conv_gate01',
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

test('catalog warnings preserve the unavailable model and require a readable catalog', () => {
  conversationDrafts.write('conv_gate01', 'Send this message')
  try {
    const modelSettings = {
      currentModel: 'account-unavailable-model',
      availableModels: [],
      reasoningOptions: [],
      canSelectModel: true,
      canSelectReasoning: false,
    }
    const control = {
      pending: false,
      loadingModels: false,
      async refreshModels() {},
      async update() {},
    }
    const renderCatalog = (catalog) =>
      render({
        modelSettings,
        modelSwitchController: { ...control, catalog },
      })
    const markup = renderCatalog({
      availableModels: [{ id: 'available-model', name: 'Available' }],
    })
    assert.match(markup, /account-unavailable-model 不在此账号的可用模型中/u)
    assert.match(markup, /请先从模型菜单选择可用模型/u)
    assert.match(markup, /切换模型，当前 account-unavailable-model/u)
    const blocked = new JSDOM(markup).window.document.querySelector(
      'button[aria-label="发送消息"]',
    )
    assert.equal(blocked?.disabled, true)
    assert.equal(
      blocked?.parentElement?.getAttribute('title'),
      '请先从模型菜单选择可用模型，再发送消息',
    )
    const recordFallback = render({
      model: 'record-unlisted-model',
      modelSettings: { ...modelSettings, currentModel: undefined },
      modelSwitchController: {
        ...control,
        catalog: {
          availableModels: [{ id: 'available-model', name: 'Available' }],
        },
      },
    })
    assert.match(
      recordFallback,
      /record-unlisted-model 不在此账号的可用模型中/u,
    )
    assert.equal(
      new JSDOM(recordFallback).window.document.querySelector(
        'button[aria-label="发送消息"]',
      )?.disabled,
      true,
    )
    assert.match(markup, /附件即将推出/u)
    assert.match(markup, /语音即将推出/u)
    assert.doesNotMatch(markup, /剩余上下文/u)
    assert.doesNotMatch(markup, /模型切换功能开发中/u)
    for (const catalog of [
      undefined,
      {},
      {
        availableModels: [{ id: modelSettings.currentModel, name: 'Current' }],
      },
    ]) {
      const permitted = renderCatalog(catalog)
      assert.doesNotMatch(permitted, /不在此账号的可用模型中/u)
      assert.equal(
        new JSDOM(permitted).window.document.querySelector(
          'button[aria-label="发送消息"]',
        )?.disabled,
        false,
      )
    }
  } finally {
    conversationDrafts.clear('conv_gate01')
  }
})

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
