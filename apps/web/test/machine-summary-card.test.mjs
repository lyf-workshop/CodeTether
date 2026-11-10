import assert from 'node:assert/strict'
import test from 'node:test'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'

const machine = {
  machineId: 'machine_d2_local',
  displayName: '工作电脑',
  kind: 'local',
  platform: 'windows',
  architecture: 'x64',
  connectionState: 'local',
}

function renderCard(backendFreshness) {
  const record = {
    ...machine,
    providers: [{ provider: 'codex', availability: 'available' }],
    providerLifecycles: [
      {
        provider: 'codex',
        installations: [
          {
            selected: true,
            backend: {
              freshness: backendFreshness,
              readiness: 'authentication_required',
            },
          },
        ],
      },
    ],
  }
  const fixture = metadataUiFixture({ machines: [record], projects: [] })
  const { MachineSummaryCard } = fixture.load(
    'components/machines/machine-summary-card.tsx',
  )
  const render = () =>
    fixture.render(MachineSummaryCard, {
      machine: record,
      projects: [],
      projectError: false,
      hostConnected: true,
    })
  return { fixture, render }
}

test('current login requirement is shown, while an old backend observation cannot override current availability', () => {
  const current = renderCard('current').render()
  assert.match(current, /未登录/u)

  const old = renderCard('last_known').render()
  assert.match(old, /可用/u)
  assert.doesNotMatch(old, /未登录/u)
})

test('failed card detail refresh marks retained Provider data as old', () => {
  const { fixture, render } = renderCard('current')
  fixture.state.machineDetailsFailed = true
  const html = render()
  assert.match(html, /AI 工具状态未能更新，显示上次读取结果/u)
  assert.match(html, /未登录/u)
})

test('card defers detail reads until near the viewport when observation is supported', () => {
  const previousObserver = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {}
  try {
    const { fixture, render } = renderCard('current')
    render()
    const detailRead = fixture.reads.find(
      (read) => read.queryKey[2] === 'detail',
    )
    assert.equal(detailRead?.enabled, false)
  } finally {
    if (previousObserver === undefined) delete globalThis.IntersectionObserver
    else globalThis.IntersectionObserver = previousObserver
  }
})

test('recent conversations initially show ten in instant order with a load-more control', () => {
  const fixture = metadataUiFixture()
  const { MachineConversationsSection } = fixture.load(
    'components/machines/machine-conversations-section.tsx',
  )
  const project = { projectId: 'proj_d2', name: '项目' }
  const conversations = [
    {
      conversationId: 'conv_earlier',
      machineId: machine.machineId,
      projectId: project.projectId,
      provider: 'codex',
      title: '较早时区记录',
      status: 'idle',
      lastActivityAt: '2026-11-09T10:00:00+02:00',
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      conversationId: `conv_later_${index}`,
      machineId: machine.machineId,
      projectId: project.projectId,
      provider: 'codex',
      title: `较新记录${index}`,
      status: 'idle',
      lastActivityAt: `2026-11-09T09:${String(index).padStart(2, '0')}:00Z`,
    })),
  ]
  const html = fixture.render(MachineConversationsSection, {
    machine,
    projects: [project],
    conversations,
  })
  assert.equal((html.match(/<li\b/gu) ?? []).length, 10)
  assert.doesNotMatch(html, /较早时区记录/u)
  assert.ok(html.indexOf('较新记录9') < html.indexOf('较新记录0'))
  assert.match(html, /加载更多会话/u)
  assert.match(html, /已显示 10 个，已读取 11 个/u)
})
