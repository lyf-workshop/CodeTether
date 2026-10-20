import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { resolveAttentionNotificationMetadata } = loadWebComponent(
  'runtime/notifications/attention-notification-metadata.ts',
)
const attention = {
  projectId: 'proj_r2notify01',
  conversationId: 'conv_r2notify01',
}
const conversation = { ...attention, machineId: 'machine_r2notify01' }
const machines = [
  { machineId: 'machine_r2other01', displayName: '不能借用的设备' },
  { machineId: conversation.machineId, displayName: '会话所在设备' },
]
const indexKey = ['host', 'project-conversations', attention.projectId, 'all']
const machinesKey = ['host', 'machines', 'list']

function fixture() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const calls = []
  const runtime = {
    getProject: async (projectId) => ({
      project: { projectId, name: '通知项目' },
    }),
    listProjectConversations: async (projectId, options) => {
      calls.push(['index', projectId, options.archived, options.limit])
      return { conversations: [conversation] }
    },
    listMachines: async () => {
      calls.push(['machines'])
      return { machines }
    },
    getConversation: async () =>
      assert.fail('notifications must not hydrate details'),
    refreshMachineProviders: async () =>
      assert.fail('notifications must not probe Providers'),
    startTurn: async () => assert.fail('notifications must not run inference'),
  }
  return { queryClient, calls, runtime }
}

test('notification metadata reuses an existing stale exact all-index and machine cache', async () => {
  const { queryClient, calls, runtime } = fixture()
  try {
    queryClient.setQueryData(
      indexKey,
      [
        {
          ...conversation,
          projectId: 'proj_r2other01',
          machineId: machines[0].machineId,
        },
        conversation,
      ],
      { updatedAt: 1 },
    )
    queryClient.setQueryData(machinesKey, machines, { updatedAt: 1 })
    for (let count = 0; count < 2; count += 1) {
      assert.deepEqual(
        await resolveAttentionNotificationMetadata(
          queryClient,
          runtime,
          attention,
        ),
        { projectName: '通知项目', machineName: '会话所在设备' },
      )
    }
    assert.deepEqual(calls, [])
  } finally {
    queryClient.clear()
  }
})

test('a cold notification reads one bounded all-index then later notifications reuse it', async () => {
  const { queryClient, calls, runtime } = fixture()
  try {
    for (let count = 0; count < 2; count += 1) {
      assert.deepEqual(
        await resolveAttentionNotificationMetadata(
          queryClient,
          runtime,
          attention,
        ),
        { projectName: '通知项目', machineName: '会话所在设备' },
      )
    }
    assert.deepEqual(calls, [
      ['index', attention.projectId, 'all', 100],
      ['machines'],
    ])
  } finally {
    queryClient.clear()
  }
})

test('known empty or nonmatching notification indexes do not refetch or guess a device', async () => {
  for (const cached of [
    [],
    [{ ...conversation, conversationId: 'conv_r2other01' }],
  ]) {
    const { queryClient, calls, runtime } = fixture()
    try {
      queryClient.setQueryData(indexKey, cached)
      queryClient.setQueryData(machinesKey, machines)
      assert.deepEqual(
        await resolveAttentionNotificationMetadata(
          queryClient,
          runtime,
          attention,
        ),
        { projectName: '通知项目' },
      )
      assert.deepEqual(calls, [])
    } finally {
      queryClient.clear()
    }
  }
})

test('foreign or filtered indexes cannot substitute for the notification all-index', async () => {
  const { queryClient, calls, runtime } = fixture()
  try {
    queryClient.setQueryData(
      ['host', 'project-conversations', attention.projectId, 'active'],
      [],
    )
    queryClient.setQueryData(
      ['host', 'project-conversations', 'proj_r2other01', 'all'],
      [],
    )
    queryClient.setQueryData(machinesKey, machines)
    assert.deepEqual(
      await resolveAttentionNotificationMetadata(
        queryClient,
        runtime,
        attention,
      ),
      { projectName: '通知项目', machineName: '会话所在设备' },
    )
    assert.deepEqual(calls, [['index', attention.projectId, 'all', 100]])
  } finally {
    queryClient.clear()
  }
})

test('a failed cold notification index is not retried or replaced with another device', async () => {
  const { queryClient, calls, runtime } = fixture()
  runtime.listProjectConversations = async () => {
    calls.push(['index'])
    throw new Error('synthetic private metadata error')
  }
  try {
    queryClient.setQueryData(machinesKey, machines)
    assert.deepEqual(
      await resolveAttentionNotificationMetadata(
        queryClient,
        runtime,
        attention,
      ),
      { projectName: '通知项目' },
    )
    assert.deepEqual(calls, [['index']])
  } finally {
    queryClient.clear()
  }
})
