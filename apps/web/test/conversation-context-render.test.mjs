import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveConversationInspectorTab } from '../.tmp/test-dist/components/conversation/conversation-inspector-state.js'
import { loadWebComponent } from './fixtures/render-ui.mjs'

// The source renderer transpiles TSX to CJS. Use that exact Router instance so
// its real Link reads the same context; ESM and CJS have distinct module stores.
const {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} = createRequire(import.meta.url)('@tanstack/react-router')

const { InspectorPanel } = loadWebComponent(
  'components/conversation/inspector-panel.tsx',
)
const { ConversationHeader } = loadWebComponent(
  'components/conversation/conversation-header.tsx',
)
const { ConversationDetailRoute } = loadWebComponent(
  'components/conversation/conversation-detail-route.tsx',
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
  supportsToolOutput: true,
  supportsReasoningControl: false,
}
const context = {
  machineId: 'machine_owner',
  projectId: 'proj_owner',
  machineName: '配对设备',
  machineKind: 'remote',
  projectName: '支付项目',
  projectPath: '/srv/支付 项目',
  readSearchOnly: true,
  importedFrom: 'Claude Code',
  reasoning: '高',
}
const conversation = {
  id: 'conv_owner',
  title: '分析支付回调',
  titleSource: 'manual',
  status: 'idle',
  agent: 'claude',
  provider: 'claude-code',
  model: '默认模型',
  reasoning: '默认',
  permission: '不支持批准',
  machine: '配对设备',
  branch: '未提供',
  duration: '尚未开始',
  capabilities,
  timeline: { blocks: [] },
  changes: { files: [], totals: { additions: 0, deletions: 0 } },
  terminal: { lines: [], truncated: false },
  context: [],
  pendingApprovals: [],
}

test('Claude gets viewed files only when a recorded path exists', () => {
  const blank = panel()
  assert.doesNotMatch(blank, />工具输出<\/button>/u)
  assert.doesNotMatch(blank, /已查看文件|因此没有“变更”|>文件<|>变更</u)
  const markup = panel({
    conversation: { ...conversation, viewedFiles: ['docs/README.md'] },
  })
  assert.match(markup, /已查看文件<\/button>/u)
  assert.match(markup, /docs\/README\.md/u)
  assert.doesNotMatch(markup, />变更<\/button>|>工具输出<\/button>/u)
  assert.match(
    markup,
    /aria-selected="true"[^>]*tab-?[^>]*files|aria-selected="true"[^>]*trigger-files/u,
  )
})

test('known remote or unknown provenance cannot advertise local-only Diff', () => {
  const supportsDiff = {
    ...conversation,
    agent: 'codex',
    provider: 'codex',
    viewedFiles: ['docs/README.md'],
    capabilities: { ...capabilities, supportsDiff: true },
  }
  for (const displayContext of [context, undefined]) {
    const markup = panel({ conversation: supportsDiff, displayContext })
    assert.doesNotMatch(markup, />变更<\/button>|查看变更/u)
    assert.match(markup, /已查看文件<\/button>/u)
  }
})

test('local Diff owns its one changes tab and hides zero count chips', () => {
  const change = {
    id: 'change1',
    path: 'src/write.ts',
    additions: 3,
    deletions: 0,
  }
  const markup = panel({
    conversation: {
      ...conversation,
      agent: 'codex',
      provider: 'codex',
      viewedFiles: ['docs/README.md'],
      capabilities: { ...capabilities, supportsDiff: true },
    },
    displayContext: { ...context, machineKind: 'local' },
    changes: { files: [change], totals: { additions: 3, deletions: 0 } },
    onChangeSelect: () => {},
  })
  assert.match(markup, />变更<\/button>/u)
  assert.match(markup, /src\/write\.ts/u)
  assert.match(markup, />\+3</u)
  assert.doesNotMatch(markup, /已查看文件|>文件<\/button>|>-0<|<h3[^>]*>变更/u)
})

test('Codex history keeps changes and tool output tabs while its runtime is unavailable', () => {
  const localCodex = {
    ...conversation,
    agent: 'codex',
    provider: 'codex',
    capabilities: {
      ...capabilities,
      supportsDiff: false,
      supportsToolOutput: false,
      supportsShell: false,
    },
    terminal: { lines: ['test output'], truncated: false },
    changes: {
      files: [
        { id: 'change1', path: 'src/write.ts', additions: 3, deletions: 0 },
      ],
      totals: { additions: 3, deletions: 0 },
    },
  }
  const markup = panel({
    conversation: localCodex,
    displayContext: { ...context, machineKind: 'local' },
    changes: localCodex.changes,
    terminal: localCodex.terminal,
  })
  assert.match(markup, />变更<\/button>/u)
  assert.match(markup, /工具输出<\/button>/u)
})

test('Inspector honors explicit deep links and selects first supported tab with content', () => {
  const from = {
    supportsDiff: true,
    hasChanges: false,
    hasViewedFiles: true,
    supportsToolOutput: true,
    hasToolOutput: true,
  }
  assert.equal(resolveConversationInspectorTab(undefined, from), 'tools')
  assert.equal(
    resolveConversationInspectorTab('overview', { ...from, hasChanges: true }),
    'changes',
  )
  assert.equal(resolveConversationInspectorTab('changes', from), 'changes')
  assert.equal(resolveConversationInspectorTab('terminal', from), 'tools')
  assert.equal(
    resolveConversationInspectorTab('changes', {
      ...from,
      supportsDiff: false,
    }),
    'files',
  )
  assert.equal(
    resolveConversationInspectorTab(undefined, {
      supportsDiff: false,
      hasChanges: false,
      hasViewedFiles: false,
      supportsToolOutput: false,
      hasToolOutput: false,
    }),
    undefined,
  )
})

test('unreported Tool output is hidden rather than promoted into a terminal feature', () => {
  const markup = panel({
    conversation: {
      ...conversation,
      capabilities: {
        ...capabilities,
        supportsToolOutput: false,
        supportsShell: false,
      },
    },
  })
  assert.doesNotMatch(markup, /value="tools"|id="[^"]*trigger-tools"/u)
  assert.doesNotMatch(markup, /<input[^>]*terminal/u)
})

test('Claude history with unavailable live controls shows only its viewed files', () => {
  const markup = panel({
    conversation: {
      ...conversation,
      viewedFiles: ['README.md'],
      capabilities: {
        ...capabilities,
        supportsToolOutput: false,
        supportsDiff: false,
      },
    },
    displayContext: { ...context, machineKind: 'local' },
  })
  assert.match(markup, /已查看文件<\/button>/u)
  assert.doesNotMatch(markup, />变更<\/button>|>工具输出<\/button>/u)
})

test('title context keeps Provider, model and reasoning without repeating location', async () => {
  const markup = await header()
  assert.match(markup, /Claude Code/u)
  assert.match(markup, /默认模型/u)
  assert.match(markup, /从 Claude Code 导入/u)
  assert.match(markup, /推理：高/u)
  assert.doesNotMatch(markup, /配对设备|支付项目|role="combobox"/u)
})

test('unset reasoning and non-imported conversation do not manufacture metadata badges', async () => {
  const markup = await header({
    context: { ...context, reasoning: undefined, importedFrom: undefined },
  })
  assert.doesNotMatch(markup, /推理：|从 Claude Code 导入/u)
})

function panel(overrides = {}) {
  return renderToStaticMarkup(
    h(InspectorPanel, {
      conversation,
      changes: conversation.changes,
      terminal: conversation.terminal,
      displayContext: context,
      ...overrides,
    }),
  )
}

async function header(overrides = {}) {
  const routeTree = createRootRoute({
    component: () =>
      h(ConversationHeader, { conversation, context, ...overrides }),
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: true,
  })
  await router.load()
  return renderToStaticMarkup(h(RouterProvider, { router }))
}

for (const prefix of ['/c/', '/conversations/']) {
  test(`invalid ${prefix} identity renders a real missing state, not an executable demo`, async () => {
    const root = createRootRoute()
    const detail = createRoute({
      getParentRoute: () => root,
      path: `${prefix}$conversationId`,
      component: ConversationDetailRoute,
    })
    const devices = createRoute({
      getParentRoute: () => root,
      path: '/devices',
      component: () => null,
    })
    const router = createRouter({
      routeTree: root.addChildren([detail, devices]),
      history: createMemoryHistory({
        initialEntries: [`${prefix}not-a-conversation`],
      }),
      isServer: true,
    })
    await router.load()
    const markup = renderToStaticMarkup(h(RouterProvider, { router }))
    assert.match(markup, /找不到这个会话/u)
    assert.match(markup, /返回设备/u)
    assert.doesNotMatch(
      markup,
      /conversation-composer|发送消息|允许一次|data-composer-state/u,
    )
  })
}
