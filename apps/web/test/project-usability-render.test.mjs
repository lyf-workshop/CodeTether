import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as query from '@tanstack/react-query'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { renderProjectCollection } from './fixtures/render-project-collection.mjs'

const { PreviousConversationsView } = loadWebComponent(
  'components/projects/previous-conversations-view.tsx',
)

const machineId = 'machine_collection01'
const timestamp = '2026-11-01T10:10:05.000Z'

function conversation(index) {
  return {
    conversationId: `conv_small_${index}`,
    projectId: 'proj_collection01',
    machineId,
    provider: 'codex',
    title: `会话 ${index}`,
    titleSource: 'user',
    status: 'completed',
    createdAt: timestamp,
    lastActivityAt: timestamp,
  }
}

test('a small project keeps Search and archived navigation without filter controls', () => {
  const html = renderProjectCollection({
    conversations: [conversation(1)],
  }).html
  assert.match(html, /aria-label="搜索这个项目的会话"/u)
  assert.match(html, /查看已归档会话/u)
  assert.doesNotMatch(html, /group-hover\/conversation-row:opacity-100/u)
  assert.doesNotMatch(html, /aria-label="会话状态"/u)
  assert.doesNotMatch(html, /aria-label="AI 工具"/u)
  assert.doesNotMatch(html, />搜索<\/button>/u)
})

test('six conversations expose one filter row and archived view excludes impossible statuses', () => {
  const conversations = Array.from({ length: 6 }, (_, index) =>
    conversation(index),
  )
  const active = renderProjectCollection({ conversations }).html
  assert.match(active, /aria-label="会话范围"/u)
  assert.match(active, /aria-label="会话状态"/u)
  assert.match(active, /aria-label="AI 工具"/u)
  const archived = renderProjectCollection({
    conversations,
    search: { view: 'archived' },
  }).html
  assert.match(archived, /aria-label="会话状态"/u)
  assert.doesNotMatch(archived, />运行中<\/button>/u)
  assert.doesNotMatch(archived, />等待批准<\/button>/u)
})

test('typing Search updates the current route while retaining input focus and debouncing the Host read', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  const navigations = []
  const searchReads = []
  let setSearch
  const dependencies = new Map([
    [
      '@tanstack/react-query',
      {
        ...query,
        useQuery: () => ({ data: [], isError: false, refetch: async () => {} }),
        useInfiniteQuery: (options) => {
          searchReads.push(options)
          return {
            data: undefined,
            isError: false,
            isFetching: false,
            isFetchingNextPage: false,
            isFetchNextPageError: false,
            isRefetchError: false,
            hasNextPage: false,
          }
        },
        useQueryClient: () => ({ resetQueries: async () => {} }),
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => (route) => {
          navigations.push(route)
          setSearch(route.search)
          return Promise.resolve()
        },
        Link: ({ children, ...props }) => h('a', props, children),
      },
    ],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => ({}),
        useHostConnectionState: () => 'connected',
      },
    ],
  ])
  const { ProjectConversationCollection } = loadWebComponent(
    'components/projects/project-conversation-collection.tsx',
    dependencies,
  )
  function Probe() {
    const [search, updateSearch] = useState({})
    setSearch = updateSearch
    return h(ProjectConversationCollection, {
      projectId: 'proj_collection01',
      machineId,
      projectName: '项目',
      search,
      searchPage: Boolean(search.q),
      searchRoute: false,
    })
  }
  await dom.render(h(Probe))
  const input = dom.container.querySelector('[aria-label="搜索这个项目的会话"]')
  assert.ok(input)
  await dom.perform(() => input.focus())
  await dom.input(input, 'alpha')
  assert.equal(navigations.length, 1)
  assert.equal(navigations[0].to, '/projects/$projectId')
  assert.equal(navigations[0].search.q, 'alpha')
  assert.equal(dom.window.document.activeElement, input)
  await dom.until(() => searchReads.some((entry) => entry.enabled === true))
})

function previousProps(overrides = {}) {
  return {
    stepRef: { current: null },
    scanState: 'ready',
    importing: false,
    presentation: 'embedded',
    candidates: [],
    importedCount: 0,
    hasSupportedProvider: true,
    scanNotice: '',
    runScan: async () => {},
    providerProblems: [],
    grouped: [],
    selectable: [],
    selectionBatchFull: false,
    toggleAllVisible: () => {},
    selectionId: 'previous-test',
    activity: new Map(),
    selected: new Set(),
    toggleCandidate: () => {},
    openConversation: async () => {},
    nextCursor: undefined,
    importSelected: async () => {},
    onFinished: () => {},
    ...overrides,
  }
}

function renderPrevious(props) {
  return renderToStaticMarkup(createElement(PreviousConversationsView, props))
}

test('previous sessions collapse to one accessible line when nothing is waiting to import', () => {
  const candidate = {
    discoveryCandidateId: 'candidate_already_adopted',
    provider: 'codex',
    title: 'Existing',
    alreadyAdopted: true,
    resumeStatus: 'supported',
    conversationId: 'conv_existing',
    createdAt: timestamp,
  }
  const html = renderPrevious(
    previousProps({
      candidates: [candidate],
      grouped: [{ provider: 'codex', candidates: [candidate] }],
      providerProblems: [
        {
          provider: 'claude-code',
          status: 'unsupported',
          failureReason: 'provider_session_format_unsupported',
        },
      ],
    }),
  )
  assert.match(html, /aria-expanded="false"/u)
  assert.match(html, /发现 1 个以前的会话/u)
  assert.match(html, /Claude Code：当前版本不支持查找以前的会话/u)
  assert.match(html, /hidden=""/u)
  assert.doesNotMatch(html, /border-warning/u)
  assert.doesNotMatch(html, /size-10 place-items-center/u)
})

test('the collapsed import line opens its associated details', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  await dom.render(h(PreviousConversationsView, previousProps()))
  const trigger = dom.container.querySelector('[aria-expanded="false"]')
  assert.ok(trigger)
  const details = dom.window.document.getElementById(
    trigger.getAttribute('aria-controls'),
  )
  assert.ok(details)
  assert.equal(details.hidden, true)
  await dom.perform(() => trigger.click())
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(details.hidden, false)
})

test('a session waiting to import stays expanded with a visible selection control', () => {
  const candidate = {
    discoveryCandidateId: 'candidate_ready',
    provider: 'codex',
    title: 'Ready',
    alreadyAdopted: false,
    resumeStatus: 'supported',
    createdAt: timestamp,
  }
  const html = renderPrevious(
    previousProps({
      candidates: [candidate],
      grouped: [{ provider: 'codex', candidates: [candidate] }],
      selectable: [candidate],
    }),
  )
  assert.doesNotMatch(html, /发现 1 个以前的会话/u)
  assert.match(html, /aria-label="选择 Ready"/u)
  assert.match(html, /导入不会启动 AI 工具/u)
})
