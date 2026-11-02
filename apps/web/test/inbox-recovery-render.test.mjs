import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const at = '2026-10-19T00:00:00.000Z'
const item = (type) => ({
  attentionId: 'attn_recovery01',
  conversationId: 'conv_recovery01',
  projectId: 'proj_recovery01',
  turnId: 'turn_recovery01',
  type,
  status: 'open',
  createdAt: at,
  updatedAt: at,
  payload:
    type === 'approval'
      ? {
          approvalId: 'approval_recovery01',
          kind: 'command',
          actionTitle: '测试',
          actionSubtitle: 'synthetic command',
        }
      : {
          conversationTitle: 'synthetic title',
          ...(type === 'failed'
            ? {
                error: {
                  code: 'provider_error',
                  message: 'synthetic private error',
                },
              }
            : {}),
        },
})

test('completed review has independent review and acknowledge actions', () => {
  const f = metadataUiFixture()
  const { InboxItem } = f.load('components/inbox/inbox-item.tsx')
  const html = f.render(InboxItem, {
    item: item('completed_review'),
    approvalEnabled: false,
    controlsEnabled: true,
    onApproval() {},
    onAcknowledge() {},
    onReview() {},
  })
  assert.match(html, />查看结果<\/button>/u)
  assert.match(html, />知道了<\/button>/u)
})

test('unsupported approval explains its boundary and only offers opening, never generic acknowledgement', () => {
  const f = metadataUiFixture()
  const { InboxItem } = f.load('components/inbox/inbox-item.tsx')
  const html = f.render(InboxItem, {
    item: item('approval'),
    approvalEnabled: false,
    controlsEnabled: true,
    onApproval() {},
    onAcknowledge() {},
    onReview() {},
  })
  assert.match(html, /不能在这里批准/u)
  assert.match(html, /打开会话/u)
  assert.doesNotMatch(html, />知道了<|>允许一次<|>拒绝</u)
})

test('connected query error states the list failure rather than claiming the service is unavailable', () => {
  const { InboxErrorState } = loadWebComponent(
    'components/inbox/inbox-page-states.tsx',
  )
  const html = renderToStaticMarkup(
    h(InboxErrorState, { readFailure: true, onRetry() {} }),
  )
  assert.match(html, /待处理列表暂时读不到/u)
  assert.doesNotMatch(html, /本地服务暂时不可用|CodeTether 暂时无法连接/u)
  assert.match(html, /重试/u)
})

test('a failed review acknowledgement still navigates once with a bounded visible recovery hint', async () => {
  const { reviewCompletedAttention } = loadWebComponent(
    'components/inbox/inbox-actions.ts',
  )
  const calls = []
  await reviewCompletedAttention(
    {
      resolveAttention: async (id) => {
        calls.push(['resolve', id])
        throw new Error('synthetic private failure')
      },
    },
    item('completed_review'),
    (...args) => {
      calls.push(['navigate', ...args])
    },
  )
  assert.deepEqual(calls, [
    ['resolve', 'attn_recovery01'],
    ['navigate', 'conv_recovery01', 'turn_recovery01', true],
  ])
  const f = metadataUiFixture()
  const { AttentionReviewNotice } = f.load(
    'components/conversation/attention-review-notice.tsx',
  )
  const html = f.render(AttentionReviewNotice)
  assert.match(html, /role="alert"/u)
  assert.match(html, /未能更新待处理状态/u)
  assert.match(html, /返回待处理/u)
  assert.doesNotMatch(html, /synthetic private failure/u)
})

test('generic acknowledge resolves only completed or failed Attention, never approval', async () => {
  const { acknowledgeInboxAttention } = loadWebComponent(
    'components/inbox/inbox-actions.ts',
  )
  const calls = []
  const client = { resolveAttention: async (id) => calls.push(id) }
  await acknowledgeInboxAttention(client, item('completed_review'))
  await acknowledgeInboxAttention(client, item('failed'))
  await assert.rejects(acknowledgeInboxAttention(client, item('approval')))
  assert.deepEqual(calls, ['attn_recovery01', 'attn_recovery01'])
})

test('notification body includes bounded device and project only, never title, command or path sentinels', () => {
  const { createNotificationIntent } = loadWebComponent(
    'runtime/notifications/desktop-notification-model.ts',
  )
  const attention = item('approval')
  attention.payload.actionSubtitle = 'SYNTHETIC_COMMAND_SENTINEL'
  const intent = createNotificationIntent(attention, {
    projectName: '测试项目',
    machineName: '测试电脑',
    conversationTitle: 'SYNTHETIC_TITLE_SENTINEL',
    rootPath: '/SYNTHETIC_PATH_SENTINEL',
  })
  assert.match(intent.body, /^测试电脑 · 测试项目\n/u)
  assert.doesNotMatch(intent.title + intent.body, /SYNTHETIC_/u)
})

test('notification metadata uses only the bounded cold all-index and exact machine, with no detail hydration', async () => {
  const { resolveAttentionNotificationMetadata } = loadWebComponent(
    'runtime/notifications/attention-notification-metadata.ts',
  )
  const calls = []
  const runtime = {
    getProject: async (id) => {
      calls.push(['project', id])
      return { project: { projectId: id, name: '测试项目' } }
    },
    listProjectConversations: async (id, options) => {
      calls.push(['index', id, options.archived, options.limit])
      return {
        conversations: [
          {
            projectId: id,
            conversationId: 'conv_recovery01',
            machineId: 'machine_recovery01',
            title: 'SYNTHETIC_TITLE_SENTINEL',
          },
        ],
      }
    },
    listMachines: async () => {
      calls.push(['machines'])
      return {
        machines: [
          { machineId: 'machine_wrong01', displayName: '不能借用' },
          { machineId: 'machine_recovery01', displayName: '真实测试电脑' },
        ],
      }
    },
    getConversation: async () =>
      assert.fail('notification must not load conversation detail'),
  }
  const client = {
    fetchQuery: (options) => options.queryFn({ signal: undefined }),
    getQueryData: () => undefined,
  }
  const metadata = await resolveAttentionNotificationMetadata(
    client,
    runtime,
    item('completed_review'),
  )
  assert.deepEqual(metadata, {
    projectName: '测试项目',
    machineName: '真实测试电脑',
  })
  assert.ok(
    calls.some(
      (call) => call[0] === 'index' && call[2] === 'all' && call[3] === 100,
    ),
  )
  runtime.listProjectConversations = async () => ({ conversations: [] })
  const absent = await resolveAttentionNotificationMetadata(
    client,
    runtime,
    item('completed_review'),
  )
  assert.deepEqual(absent, { projectName: '测试项目' })
})

test('notification context uses cached Machine metadata and never guesses when cold lookup fails', async () => {
  const { resolveAttentionNotificationMetadata } = loadWebComponent(
    'runtime/notifications/attention-notification-metadata.ts',
  )
  const runtime = {
    getProject: async () => ({ project: { name: '测试项目' } }),
    listProjectConversations: async () => ({
      conversations: [
        {
          projectId: 'proj_recovery01',
          conversationId: 'conv_recovery01',
          machineId: 'machine_recovery01',
        },
      ],
    }),
    listMachines: async () =>
      assert.fail('cached machine list should be reused'),
  }
  const client = {
    fetchQuery: (options) => options.queryFn({ signal: undefined }),
    getQueryData: (queryKey) =>
      queryKey[1] === 'machines'
        ? [{ machineId: 'machine_recovery01', displayName: '缓存设备' }]
        : undefined,
  }
  assert.deepEqual(
    await resolveAttentionNotificationMetadata(client, runtime, item('failed')),
    { projectName: '测试项目', machineName: '缓存设备' },
  )
  runtime.listProjectConversations = async () => {
    throw new Error('SYNTHETIC_PRIVATE_LOOKUP_ERROR')
  }
  assert.deepEqual(
    await resolveAttentionNotificationMetadata(client, runtime, item('failed')),
    { projectName: '测试项目' },
  )
})

test('notification context labels cannot inject additional lines', () => {
  const { createNotificationIntent } = loadWebComponent(
    'runtime/notifications/desktop-notification-model.ts',
  )
  const intent = createNotificationIntent(item('completed_review'), {
    projectName: '项目\n名称',
    machineName: '设备\r\n名称',
  })
  assert.equal(intent.body.split('\n').length, 2)
  assert.match(intent.body, /^设备 名称 · 项目 名称\n/u)
})
