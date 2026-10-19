import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  filterProjectLocationConversations,
  filterProjectLocationSearchResults,
  parseProjectWorkspaceSearch,
  projectRemovalPreflight,
  resolveProjectWorkspaceContext,
} from '../.tmp/test-dist/components/projects/project-workspace-model.js'

const firstId = 'machine_aaaaaaaaaaaa'
const secondId = 'machine_bbbbbbbbbbbb'
const project = {
  locations: [
    { machineId: firstId, rootPath: '/work/one' },
    { machineId: secondId, rootPath: '/work/two' },
  ],
}

test('legacy multi-location projects require explicit device choice and never fall back across devices', () => {
  assert.equal(resolveProjectWorkspaceContext(project).kind, 'choose-device')
  assert.equal(
    resolveProjectWorkspaceContext(project, secondId).location.rootPath,
    '/work/two',
  )
  assert.equal(
    resolveProjectWorkspaceContext(project, 'machine_cccccccccccc').kind,
    'invalid-device',
  )
  assert.equal(
    resolveProjectWorkspaceContext({ locations: project.locations.slice(0, 1) })
      .location.machineId,
    firstId,
  )
  assert.equal(
    resolveProjectWorkspaceContext({ locations: [] }).kind,
    'missing-location',
  )
  assert.equal(
    resolveProjectWorkspaceContext(
      { locations: project.locations.slice(0, 1) },
      undefined,
      true,
    ).kind,
    'invalid-device',
  )
})

test('machine filtering preserves Host ordering and search match data', () => {
  const one = {
    conversationId: 'conv_one',
    machineId: firstId,
    status: 'idle',
    provider: 'codex',
  }
  const two = {
    conversationId: 'conv_two',
    machineId: secondId,
    status: 'failed',
    provider: 'claude-code',
  }
  const three = {
    conversationId: 'conv_three',
    machineId: firstId,
    status: 'waiting',
    provider: 'codex',
  }
  assert.deepEqual(
    filterProjectLocationConversations(
      [three, two, one],
      firstId,
      'all',
      'all',
    ),
    [three, one],
  )
  assert.deepEqual(
    filterProjectLocationConversations(
      [three, two, one],
      firstId,
      'waiting',
      'codex',
    ),
    [three],
  )
  const result = {
    conversation: three,
    matchedField: 'user_input',
    preview: '先检查重试逻辑',
    turnId: 'turn_one',
  }
  assert.deepEqual(
    filterProjectLocationSearchResults(
      [{ conversation: two }, result],
      firstId,
    ),
    [result],
  )
})

test('removal blocks every conversation including archived and treats unknown data as unknown', () => {
  assert.deepEqual(projectRemovalPreflight(undefined), { kind: 'unknown' })
  assert.deepEqual(projectRemovalPreflight([]), { kind: 'clear' })
  assert.deepEqual(
    projectRemovalPreflight([{ archivedAt: '2026-10-18T08:00:00.000Z' }]),
    { kind: 'blocked', count: 1, archivedCount: 1, capped: false },
  )
  assert.equal(
    projectRemovalPreflight(Array.from({ length: 100 }, () => ({}))).capped,
    true,
  )
})

test('workspace route parsing preserves valid device, archive and server search filters', () => {
  const parsed = parseProjectWorkspaceSearch({
    machineId: firstId,
    q: '重试',
    view: 'archived',
    provider: 'claude-code',
    status: 'failed',
  })
  assert.deepEqual(parsed, {
    machineId: firstId,
    q: '重试',
    view: 'archived',
    provider: 'claude-code',
    status: 'failed',
  })
  assert.equal(
    parseProjectWorkspaceSearch({ machineId: 'bad-target' }).invalidMachineId,
    true,
  )
  assert.deepEqual(
    parseProjectWorkspaceSearch({ provider: 'other', status: 'other', q: '' }),
    {},
  )
})

test('project workspace reuses bounded Host history, cursor search and native adoption without new authorities', async () => {
  const source = async (path) =>
    (
      await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n')
  const [page, collection, removal, router, previous] = await Promise.all([
    source('components/projects/project-detail-page.tsx'),
    source('components/projects/project-conversation-collection.tsx'),
    source('components/projects/remove-project-dialog.tsx'),
    source('router.tsx'),
    source('components/projects/previous-conversations-step.tsx'),
  ])
  assert.match(page, /resolveProjectWorkspaceContext/u)
  assert.match(page, /presentation="embedded"/u)
  assert.doesNotMatch(
    page,
    /AddProjectLocationDialog|RemoveProjectLocationDialog/u,
  )
  assert.match(collection, /conversationListQueryOptions/u)
  assert.match(collection, /conversationSearchInfiniteQueryOptions/u)
  assert.match(collection, /fetchNextPage/u)
  assert.match(collection, /filterProjectLocationSearchResults/u)
  assert.doesNotMatch(
    collection,
    /getSnapshot|snapshot_json|Agent response|localStorage/u,
  )
  assert.match(removal, /allProjectConversationsQueryOptions/u)
  assert.match(removal, /projectRemovalPreflight/u)
  assert.match(removal, /知道了/u)
  assert.match(
    removal,
    /projectErrorMessage\(removeMutation.error, 'remove'\)/u,
  )
  assert.match(router, /path: '\/projects\/\$projectId\/search'/u)
  assert.match(router, /path: '\/projects\/\$projectId\/conversations'/u)
  assert.match(previous, /presentation !== 'embedded'/u)
})
