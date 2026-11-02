import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { QueryClient } from '@tanstack/react-query'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { renderProjectCollection } from './fixtures/render-project-collection.mjs'

const {
  conversationListQueryKeys: keys,
  conversationListQueryOptions: options,
} = loadWebComponent('runtime/host/conversation-list-query.ts')
const projectId = 'proj_collection01'

test('bounded list keys normalize absent/all filters and isolate every real server filter', () => {
  const base = ['host', 'project-conversations', projectId, 'active']
  assert.deepEqual(keys.project(projectId), base)
  assert.deepEqual(
    keys.project(projectId, 'active', { provider: 'all', status: 'all' }),
    base,
  )
  assert.deepEqual(
    keys.project(projectId, 'active', {
      provider: undefined,
      status: undefined,
    }),
    base,
  )
  const filtered = keys.project(projectId, 'active', {
    status: 'running',
    provider: 'codex',
  })
  assert.notDeepEqual(filtered, base)
  assert.deepEqual(
    filtered,
    keys.project(projectId, 'active', { provider: 'codex', status: 'running' }),
  )
  for (const other of [
    keys.project(projectId, 'active', {
      provider: 'claude-code',
      status: 'running',
    }),
    keys.project(projectId, 'active', { provider: 'codex', status: 'waiting' }),
    keys.project(projectId, 'archived', {
      provider: 'codex',
      status: 'running',
    }),
    keys.project('proj_other01', 'active', {
      provider: 'codex',
      status: 'running',
    }),
  ])
    assert.notDeepEqual(filtered, other)
})

test('real QueryClient reads pass status and Provider before the Host 100-row bound without local reordering', async () => {
  const calls = []
  const records = [
    { conversationId: 'conv_oldermatch01' },
    { conversationId: 'conv_hostpinned01' },
  ]
  const client = {
    async listProjectConversations(id, options) {
      calls.push({ id, options })
      return { conversations: records }
    },
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const result = await queryClient.fetchQuery(
    options(client, projectId, 'archived', {
      status: 'completed',
      provider: 'claude-code',
    }),
  )
  assert.strictEqual(result, records)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, projectId)
  assert.equal(calls[0].options.provider, 'claude-code')
  assert.equal(calls[0].options.status, 'completed')
  assert.equal(calls[0].options.archived, true)
  assert.equal(calls[0].options.limit, 100)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  assert.equal(options(client, projectId).retry, false)
  queryClient.clear()
})

test('changing a list filter uses an isolated cache rather than filtering the previously loaded hundred', async () => {
  const calls = []
  const client = {
    async listProjectConversations(_id, filters) {
      calls.push(filters)
      return {
        conversations:
          filters.provider === 'claude-code'
            ? [{ conversationId: 'conv_matchingoutside100' }]
            : Array.from({ length: 100 }, (_, i) => ({
                conversationId: 'conv_unrelated' + i,
              })),
      }
    },
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const all = await queryClient.fetchQuery(options(client, projectId))
  const filtered = await queryClient.fetchQuery(
    options(client, projectId, 'active', {
      provider: 'claude-code',
      status: 'failed',
    }),
  )
  assert.equal(all.length, 100)
  assert.deepEqual(filtered, [{ conversationId: 'conv_matchingoutside100' }])
  assert.equal(calls[1].provider, 'claude-code')
  assert.equal(calls[1].status, 'failed')
  assert.equal(queryClient.getQueryData(keys.project(projectId)).length, 100)
  queryClient.clear()
})

test('actual v4 collection wires validated filters to both Host archive indexes', () => {
  const { reads } = renderProjectCollection({
    search: { provider: 'claude-code', status: 'failed' },
  })
  assert.equal(reads.length, 2)
  assert.deepEqual(reads[0].queryKey, [
    'host',
    'project-conversations',
    projectId,
    'active',
    { provider: 'claude-code', status: 'failed' },
  ])
  assert.deepEqual(reads[1].queryKey, [
    'host',
    'project-conversations',
    projectId,
    'archived',
    { provider: 'claude-code', status: 'failed' },
  ])
})

test('actual successful create callback invalidates every project filter before focusing the new canonical route', async () => {
  const filename = resolve(
    import.meta.dirname,
    '../src/components/conversations/new-conversation-dialog.tsx',
  )
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let callback
  function walk(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'createMutation' &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callback = node.initializer.arguments[0].properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === 'onSuccess',
      )?.initializer
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  assert.ok(callback)
  const output = ts.transpileModule(
    'const callback = ' + callback.getText(source) + '; return callback',
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const projectKeys = [
    keys.project(projectId),
    keys.project(projectId, 'active', { status: 'failed' }),
    keys.project(projectId, 'archived', { provider: 'claude-code' }),
    [...keys.projectScope(projectId), 'all'],
  ]
  for (const key of projectKeys) client.setQueryData(key, [])
  const unrelated = keys.project('proj_unrelated01')
  client.setQueryData(unrelated, [])
  const routes = [],
    focus = { current: false }
  let closed = 0
  const accept = new Function(
    'queryClient',
    'navigate',
    'skipCloseFocusRestore',
    'closeAfterSuccess',
    'conversationListQueryKeys',
    output,
  )(
    client,
    async (route) => {
      routes.push(route)
    },
    focus,
    () => {
      closed++
    },
    keys,
  )
  await accept({
    data: { conversation: { projectId, conversationId: 'conv_created01' } },
  })
  for (const key of projectKeys)
    assert.equal(
      client.getQueryState(key).isInvalidated,
      true,
      JSON.stringify(key),
    )
  assert.equal(client.getQueryState(unrelated).isInvalidated, false)
  assert.deepEqual(routes, [
    {
      to: '/c/$conversationId',
      params: { conversationId: 'conv_created01' },
      search: { focus: 'composer' },
    },
  ])
  assert.equal(focus.current, true)
  assert.equal(closed, 1)
  client.clear()
})
