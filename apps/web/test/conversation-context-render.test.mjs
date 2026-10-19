import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
  permission: '不支持审批',
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

test('Files panel exposes actual read/search limitations without a fake Changes action', () => {
  const markup = panel()
  assert.match(markup, /文件面板视图/u)
  assert.match(markup, />文件<\/button>/u)
  assert.match(markup, /工具输出/u)
  assert.doesNotMatch(markup, />变更<\/button>/u)
  assert.match(markup, /只读取和搜索文件/u)
  assert.match(markup, /因此没有“变更”/u)
})

test('known remote Machine suppresses unsupported Diff even beside stale positive descriptor data', () => {
  const markup = panel({
    conversation: {
      ...conversation,
      capabilities: { ...capabilities, supportsDiff: true },
    },
    displayContext: { ...context, readSearchOnly: false },
  })
  assert.doesNotMatch(markup, />变更<\/button>/u)
  assert.match(markup, /配对设备上运行的会话暂不报告文件差异/u)
})

test('unknown Machine provenance cannot advertise local-only Diff controls', () => {
  const markup = panel({
    conversation: {
      ...conversation,
      capabilities: { ...capabilities, supportsDiff: true },
    },
    displayContext: undefined,
  })
  assert.doesNotMatch(markup, />变更<\/button>/u)
  assert.doesNotMatch(markup, /查看变更/u)
  assert.match(markup, /当前 AI 工具不报告文件差异/u)
})

test('supported local Diff is a real tab and can select the original reported change', () => {
  const markup = panel({
    conversation: {
      ...conversation,
      capabilities: { ...capabilities, supportsDiff: true },
    },
    displayContext: { ...context, machineKind: 'local' },
  })
  assert.match(markup, />变更<\/button>/u)
  assert.match(markup, />文件<\/button>/u)
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

test('editable context header links only the immutable device and exact ProjectLocation', async () => {
  const markup = await header()
  assert.match(markup, /href="\/devices\/machine_owner"/u)
  assert.match(
    markup,
    /href="\/projects\/proj_owner\?machineId=machine_owner"/u,
  )
  assert.match(markup, /title="\/srv\/支付 项目"/u)
  assert.match(markup, /从 Claude Code 导入/u)
  assert.match(markup, /推理强度：高/u)
  assert.doesNotMatch(markup, /role="combobox"/u)
})

test('unset reasoning and non-imported conversation do not manufacture metadata badges', async () => {
  const markup = await header({
    context: { ...context, reasoning: undefined, importedFrom: undefined },
  })
  assert.doesNotMatch(markup, /推理强度：|从 Claude Code 导入/u)
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
