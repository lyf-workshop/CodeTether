import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as query from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'
import { createDom, h } from './fixtures/dom.mjs'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const machineId = 'machine_dom01',
  projectId = 'proj_dom01'
const machine = {
  machineId,
  kind: 'local',
  connectionState: 'local',
  availability: 'available',
  displayName: '这台电脑',
  capabilities: { projectAccess: true, providerExecution: true },
}
const project = {
  projectId,
  name: '测试项目',
  locations: [
    { machineId, availability: 'available', rootPath: 'C:/isolated/project' },
  ],
}
const descriptor = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
  capabilities: { streaming: true, resume: true },
  models: [],
  reasoningOptions: [],
}

async function dialogFixture({
  projects = [project],
  providers = [descriptor],
  create,
} = {}) {
  const dom = await createDom()
  const calls = [],
    navigations = []
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  const ui = loadUiComponent('index.ts')
  const tag =
    (name) =>
    ({ children }) =>
      h(name, null, children)
  const runtime = {
    listProjects: async () => ({ projects }),
    listMachines: async () => ({ machines: [machine] }),
    getMachine: async () => ({ machine, providers }),
    createConversation: async (...args) => {
      calls.push(args)
      return await create?.(...args)
    },
  }
  const dependencies = new Map([
    ['@tanstack/react-query', query],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => 'connected',
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => async (options) => {
          navigations.push(options)
        },
      },
    ],
    [
      '@codetether/ui',
      {
        ...ui,
        Dialog: ({ open, children }) =>
          open ? h('section', { role: 'dialog' }, children) : null,
        DialogContent: tag('div'),
        DialogHeader: tag('header'),
        DialogFooter: tag('footer'),
        DialogTitle: tag('h2'),
        DialogDescription: tag('p'),
        DialogClose: ({ children }) => children,
      },
    ],
  ])
  const { NewConversationDialog } = loadWebComponent(
    'components/conversations/new-conversation-dialog.tsx',
    dependencies,
  )
  await dom.render(
    h(
      QueryClientProvider,
      { client: queryClient },
      h(NewConversationDialog, {
        open: true,
        currentProject: project,
        currentMachineId: machineId,
      }),
    ),
  )
  const submit = () => dom.container.querySelector('button[type="submit"]')
  return {
    ...dom,
    calls,
    navigations,
    submit,
    async close() {
      await dom.close()
      queryClient.clear()
    },
  }
}

test('real dialog double-submit dispatches one exact empty conversation without model or initial message', async () => {
  let complete
  const fixture = await dialogFixture({
    create: () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  })
  try {
    await fixture.until(() => fixture.submit()?.disabled === false)
    assert.equal(fixture.container.querySelector('textarea'), null)
    await fixture.perform(() => {
      const form = fixture.submit().closest('form')
      form.dispatchEvent(
        new fixture.window.Event('submit', { bubbles: true, cancelable: true }),
      )
      form.dispatchEvent(
        new fixture.window.Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    assert.deepEqual(fixture.calls, [
      [projectId, { machineId, provider: 'codex' }],
    ])
    await fixture.perform(() =>
      complete({
        data: { conversation: { conversationId: 'conv_dom01', projectId } },
      }),
    )
    await fixture.until(() => fixture.navigations.length === 1)
    assert.deepEqual(fixture.navigations[0].search, { focus: 'composer' })
  } finally {
    await fixture.close()
  }
})

for (const [name, options] of [
  ['missing exact project', { projects: [] }],
  ['no usable AI tool', { providers: [] }],
]) {
  test('real dialog blocks creation for ' + name, async () => {
    const fixture = await dialogFixture(options)
    try {
      await fixture.until(
        () => !fixture.container.textContent.includes('正在读取'),
      )
      assert.equal(fixture.submit().disabled, true)
      await fixture.perform(() =>
        fixture
          .submit()
          .closest('form')
          .dispatchEvent(
            new fixture.window.Event('submit', {
              bubbles: true,
              cancelable: true,
            }),
          ),
      )
      assert.equal(fixture.calls.length, 0)
    } finally {
      await fixture.close()
    }
  })
}

test('real dialog keeps selection after 409 and never retries or navigates automatically', async () => {
  const fixture = await dialogFixture({
    create: async () => {
      throw new CodeTetherResponseError(409, {
        protocolVersion: 1,
        actionId: 'act_dom01',
        code: 'conflict',
        message: 'private fixture diagnostic',
      })
    },
  })
  try {
    await fixture.until(() => fixture.submit()?.disabled === false)
    await fixture.perform(() => fixture.submit().click())
    await fixture.until(() =>
      fixture.container.textContent.includes('项目状态已经变化'),
    )
    assert.match(fixture.container.textContent, /测试项目/u)
    assert.match(fixture.container.textContent, /不会自动重试/u)
    assert.doesNotMatch(
      fixture.container.textContent,
      /private fixture diagnostic/u,
    )
    assert.equal(fixture.calls.length, 1)
    assert.equal(fixture.navigations.length, 0)
  } finally {
    await fixture.close()
  }
})

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

for (const activeState of ['running', 'waiting']) {
  test(`real composer keeps focus through submitting → ${activeState} → idle without sending again`, async () => {
    const dom = await createDom()
    const { Composer } = loadWebComponent(
      'components/conversation/composer.tsx',
    )
    let complete,
      calls = 0
    const controller = {
      state: 'idle',
      submit: () => {
        calls += 1
        return new Promise((resolve) => {
          complete = resolve
        })
      },
    }
    const view = () =>
      h(Composer, {
        conversationId: `conv_active_focus_${activeState}`,
        capabilities,
        controller,
      })
    const submitForm = () =>
      dom.container
        .querySelector('form')
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true }),
        )
    try {
      await dom.render(view())
      const editor = dom.container.querySelector('textarea')
      await dom.perform(() => editor.focus())
      await dom.input(editor, 'synthetic active draft')
      await dom.perform(submitForm)
      for (const state of ['submitting', activeState]) {
        controller.state = state
        await dom.render(view())
        assert.equal(dom.container.querySelector('textarea'), editor)
        assert.ok(
          editor.closest('[hidden]') === null,
          `${state}: editor must stay visible`,
        )
        assert.equal(editor.readOnly, true)
        assert.equal(dom.window.document.activeElement, editor)
        assert.equal(
          dom.container.querySelector('button[type="submit"]').disabled,
          true,
        )
        await dom.perform(submitForm)
        await dom.perform(() =>
          editor.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
            }),
          ),
        )
        assert.equal(calls, 1)
      }
      await dom.perform(() => complete(true))
      assert.equal(dom.window.document.activeElement, editor)
      controller.state = 'idle'
      await dom.render(view())
      assert.equal(dom.window.document.activeElement, editor)
      assert.equal(editor.readOnly, false)
      assert.equal(editor.value, '')
      assert.equal(calls, 1)
    } finally {
      await dom.close()
    }
  })
}

for (const movedFocus of [false, true]) {
  test(
    'real composer ' +
      (movedFocus
        ? 'does not steal moved focus'
        : 'restores original editor focus') +
      ' after submit',
    async () => {
      const dom = await createDom()
      const { Composer } = loadWebComponent(
        'components/conversation/composer.tsx',
      )
      let complete,
        calls = 0
      const controller = {
        state: 'idle',
        submit: () => {
          calls += 1
          return new Promise((resolve) => {
            complete = resolve
          })
        },
      }
      const view = () =>
        h(Composer, {
          conversationId: 'conv_focus_' + movedFocus,
          capabilities,
          controller,
        })
      try {
        await dom.render(view())
        const editor = dom.container.querySelector('textarea')
        await dom.perform(() => editor.focus())
        await dom.input(editor, 'synthetic draft')
        await dom.perform(() =>
          dom.container.querySelector('form').dispatchEvent(
            new dom.window.Event('submit', {
              bubbles: true,
              cancelable: true,
            }),
          ),
        )
        assert.equal(calls, 1)
        controller.state = 'submitting'
        await dom.render(view())
        assert.equal(editor.readOnly, true)
        assert.equal(editor.closest('[hidden]'), null)
        await dom.perform(() =>
          movedFocus
            ? dom.window.document.getElementById('outside').focus()
            : editor.blur(),
        )
        controller.state = 'idle'
        await dom.perform(() => complete(true))
        await dom.render(view())
        assert.equal(
          dom.window.document.activeElement,
          movedFocus ? dom.window.document.getElementById('outside') : editor,
        )
        assert.equal(editor.value, '')
      } finally {
        await dom.close()
      }
    },
  )
}

test('real composer preserves session draft after rejected submission without replay', async () => {
  const dom = await createDom()
  const { Composer } = loadWebComponent('components/conversation/composer.tsx')
  let calls = 0
  try {
    await dom.render(
      h(Composer, {
        conversationId: 'conv_rejected',
        capabilities,
        controller: {
          state: 'idle',
          error: '项目状态已经变化，请刷新后重试。',
          submit: async () => {
            calls += 1
            return false
          },
        },
      }),
    )
    const editor = dom.container.querySelector('textarea')
    await dom.input(editor, 'synthetic retained draft')
    await dom.perform(() =>
      dom.container
        .querySelector('form')
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
    assert.equal(calls, 1)
    assert.equal(editor.value, 'synthetic retained draft')
    assert.match(dom.container.textContent, /项目状态已经变化/u)
    assert.equal(
      dom.window.sessionStorage.getItem(
        'codetether.conversation-draft.conv_rejected',
      ),
      'synthetic retained draft',
    )
  } finally {
    await dom.close()
  }
})
