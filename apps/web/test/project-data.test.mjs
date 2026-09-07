import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'

import { HostRuntime } from '../.tmp/test-dist/runtime/host/host-runtime.js'
import { createBrowserActionId } from '../.tmp/test-dist/runtime/host/action-id.js'
import {
  ProjectActions,
  ProjectInputError,
  ProjectMutationBusyError,
  projectCreateSuccessMessage,
  projectErrorMessage,
} from '../.tmp/test-dist/runtime/host/project-actions.js'
import {
  invalidateProjectQueries,
  projectDetailQueryOptions,
  projectListQueryOptions,
  projectQueryKeys,
  removeProjectCache,
  upsertProjectCache,
} from '../.tmp/test-dist/runtime/host/project-query.js'
import {
  projectDetailViewState,
  projectListViewState,
} from '../.tmp/test-dist/runtime/host/project-view-state.js'

const timestamp = '2026-08-26T12:00:00.000Z'
const projectA = project('proj_alpha01', 'Alpha', 'C:\\workspaces\\alpha')
const projectB = project(
  'proj_bravo01',
  'Bravo',
  'C:\\workspaces\\bravo',
  'unavailable',
)

test('HostRuntime exposes thin Project reads and owns mutation action IDs', async () => {
  const client = new FakeProjectClient()
  const runtime = new HostRuntime({ queryClient: createQueryClient(), client })

  assert.deepEqual(await runtime.listProjects(), {
    protocolVersion: 1,
    projects: [projectA, projectB],
  })
  assert.equal(
    (await runtime.getProject(projectA.projectId)).project.projectId,
    projectA.projectId,
  )
  await runtime.createProject('C:\\workspaces\\alpha', 'Alpha')
  await runtime.registerProjectLocation(projectA.projectId, {
    machineId: 'machine_remote01',
    rootPath: '/srv/alpha',
  })
  await runtime.removeProjectLocation(projectA.projectId, 'machine_remote01')
  await runtime.deleteProject(projectA.projectId)

  assert.match(client.createCalls[0].actionId, /^act_[A-Za-z0-9_-]{6,95}$/u)
  assert.match(
    client.locationCalls[0].request.actionId,
    /^act_[A-Za-z0-9_-]{6,95}$/u,
  )
  assert.match(
    client.deleteCalls[0].request.actionId,
    /^act_[A-Za-z0-9_-]{6,95}$/u,
  )
  assert.match(
    client.removeLocationCalls[0].request.actionId,
    /^act_[A-Za-z0-9_-]{6,95}$/u,
  )
  assert.notEqual(
    client.createCalls[0].actionId,
    client.deleteCalls[0].request.actionId,
  )
})

test('Project queries expose loading then return validated Host records', async () => {
  const deferred = createDeferred()
  const client = new FakeProjectClient({ list: () => deferred.promise })
  const queryClient = createQueryClient()
  const request = queryClient.fetchQuery(projectListQueryOptions(client))

  assert.equal(
    queryClient.getQueryState(projectQueryKeys.list)?.status,
    'pending',
  )
  assert.ok(client.listCalls[0]?.signal instanceof AbortSignal)

  deferred.resolve({ protocolVersion: 1, projects: [projectA, projectB] })
  assert.deepEqual(await request, [projectA, projectB])
  assert.equal(
    queryClient.getQueryState(projectQueryKeys.list)?.status,
    'success',
  )
})

test('Project detail queries isolate identities and forward cancellation signals', async () => {
  const client = new FakeProjectClient()
  const queryClient = createQueryClient()

  assert.deepEqual(
    await queryClient.fetchQuery(
      projectDetailQueryOptions(client, projectA.projectId),
    ),
    projectA,
  )
  assert.deepEqual(
    await queryClient.fetchQuery(
      projectDetailQueryOptions(client, projectB.projectId),
    ),
    projectB,
  )

  assert.deepEqual(
    client.getCalls.map(({ projectId }) => projectId),
    [projectA.projectId, projectB.projectId],
  )
  assert.notDeepEqual(
    projectQueryKeys.detail(projectA.projectId),
    projectQueryKeys.detail(projectB.projectId),
  )
  assert.ok(
    client.getCalls.every(({ signal }) => signal instanceof AbortSignal),
  )
})

test('Project cache upsert replaces duplicates and installs detail data', () => {
  const queryClient = createQueryClient()
  queryClient.setQueryData(projectQueryKeys.list, [projectA, projectB])
  const updated = { ...projectA, name: 'Alpha Updated', updatedAt: timestamp }

  upsertProjectCache(queryClient, updated)
  upsertProjectCache(queryClient, updated)

  const list = queryClient.getQueryData(projectQueryKeys.list)
  assert.equal(list.length, 2)
  assert.deepEqual(
    list.map((entry) => entry.projectId),
    [projectA.projectId, projectB.projectId],
  )
  assert.equal(list[0].name, 'Alpha Updated')
  assert.deepEqual(
    queryClient.getQueryData(projectQueryKeys.detail(projectA.projectId)),
    updated,
  )
})

test('Project cache prepends creates, removes only the confirmed identity, and invalidates', async () => {
  const queryClient = createQueryClient()
  queryClient.setQueryData(projectQueryKeys.list, [projectA])
  const observer = queryClient.getQueryCache().find({
    queryKey: projectQueryKeys.list,
    exact: true,
  })

  upsertProjectCache(queryClient, projectB)
  assert.deepEqual(
    queryClient
      .getQueryData(projectQueryKeys.list)
      .map((entry) => entry.projectId),
    [projectB.projectId, projectA.projectId],
  )

  await invalidateProjectQueries(queryClient)
  assert.equal(observer.state.isInvalidated, true)

  removeProjectCache(queryClient, projectB.projectId)
  assert.deepEqual(queryClient.getQueryData(projectQueryKeys.list), [projectA])
  assert.equal(
    queryClient.getQueryData(projectQueryKeys.detail(projectB.projectId)),
    undefined,
  )
})

test('fresh Project mutations use unique action IDs and normalize optional input', async () => {
  const ids = ['act_project_001', 'act_project_002', 'act_project_003']
  const client = new FakeProjectClient()
  const actions = new ProjectActions(client, () => ids.shift())

  await actions.createProject('  C:\\workspaces\\alpha  ', '  Alpha  ')
  await actions.createProject('C:\\workspaces\\bravo', '   ')
  await actions.deleteProject(projectA.projectId)

  assert.deepEqual(client.createCalls, [
    {
      actionId: 'act_project_001',
      path: 'C:\\workspaces\\alpha',
      name: 'Alpha',
    },
    {
      actionId: 'act_project_002',
      path: 'C:\\workspaces\\bravo',
    },
  ])
  assert.deepEqual(client.deleteCalls[0], {
    projectId: projectA.projectId,
    request: { actionId: 'act_project_003' },
  })
})

test('duplicate in-flight Project mutations share one request while conflicts stay explicit', async () => {
  const createDeferredResult = createDeferred()
  const deleteDeferredResult = createDeferred()
  const client = new FakeProjectClient({
    create: () => createDeferredResult.promise,
    delete: () => deleteDeferredResult.promise,
  })
  const actions = new ProjectActions(client, idFactory())

  const firstCreate = actions.createProject('C:\\workspaces\\alpha', 'Alpha')
  const duplicateCreate = actions.createProject(
    'C:\\workspaces\\alpha',
    'Alpha',
  )
  assert.strictEqual(duplicateCreate, firstCreate)
  await assert.rejects(
    actions.createProject('C:\\workspaces\\bravo'),
    ProjectMutationBusyError,
  )
  assert.equal(client.createCalls.length, 1)

  const firstDelete = actions.deleteProject(projectA.projectId)
  const duplicateDelete = actions.deleteProject(projectA.projectId)
  assert.strictEqual(duplicateDelete, firstDelete)
  assert.equal(client.deleteCalls.length, 1)

  createDeferredResult.resolve(
    createResponse(client.createCalls[0].actionId, projectA, false),
  )
  deleteDeferredResult.resolve(
    deleteResponse(client.deleteCalls[0].request.actionId, projectA.projectId),
  )
  const [created] = await Promise.all([firstCreate, firstDelete])
  assert.equal(created.data.created, false)
  assert.equal(
    projectCreateSuccessMessage(created.data.created),
    '项目已存在，已打开现有项目。',
  )
})

test('blank Project paths fail before generating an action or calling the Host', async () => {
  const client = new FakeProjectClient()
  const actions = new ProjectActions(client, () => {
    assert.fail('Action identity must not be generated for invalid input')
  })

  await assert.rejects(actions.createProject('   '), ProjectInputError)
  assert.equal(client.createCalls.length, 0)
})

test('ProjectLocation registration is exact, deduplicated, and refreshes Project and Machine truth', async () => {
  const deferred = createDeferred()
  const client = new FakeProjectClient({
    location: () => deferred.promise,
  })
  const queryClient = createQueryClient()
  queryClient.setQueryData(projectQueryKeys.list, [projectA])
  queryClient.setQueryData(
    projectQueryKeys.detail(projectA.projectId),
    projectA,
  )
  queryClient.setQueryData(['host', 'machines', 'detail', 'machine_remote01'], {
    stale: true,
  })
  const actions = new ProjectActions(client, idFactory(), queryClient)
  const input = {
    machineId: 'machine_remote01',
    rootPath: '  /srv/项目 alpha  ',
  }

  const first = actions.registerProjectLocation(projectA.projectId, input)
  const duplicate = actions.registerProjectLocation(projectA.projectId, input)
  assert.strictEqual(first, duplicate)
  assert.equal(client.locationCalls.length, 1)
  assert.deepEqual(client.locationCalls[0], {
    projectId: projectA.projectId,
    request: {
      actionId: 'act_project_001',
      machineId: 'machine_remote01',
      path: '/srv/项目 alpha',
    },
  })

  const location = {
    projectId: projectA.projectId,
    machineId: 'machine_remote01',
    rootPath: '/srv/项目 alpha',
    availability: 'available',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const updated = { ...projectA, locations: [...projectA.locations, location] }
  deferred.resolve(
    registerLocationResponse('act_project_001', updated, location),
  )
  await first

  assert.deepEqual(
    queryClient.getQueryData(projectQueryKeys.detail(projectA.projectId)),
    updated,
  )
  assert.equal(
    queryClient.getQueryState(projectQueryKeys.list).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState([
      'host',
      'machines',
      'detail',
      'machine_remote01',
    ]).isInvalidated,
    true,
  )
})

test('remote-first Project creation is exact, deduplicated, and updates bounded caches', async () => {
  const deferred = createDeferred()
  const client = new FakeProjectClient({
    remoteCreate: () => deferred.promise,
  })
  const queryClient = createQueryClient()
  queryClient.setQueryData(projectQueryKeys.list, [])
  queryClient.setQueryData(['host', 'machines', 'detail', 'machine_remote01'], {
    stale: true,
  })
  const actions = new ProjectActions(client, idFactory(), queryClient)
  const input = { rootPath: '  /srv/remote-only  ' }

  const first = actions.createRemoteProject('machine_remote01', input)
  const duplicate = actions.createRemoteProject('machine_remote01', input)
  assert.strictEqual(first, duplicate)
  assert.deepEqual(client.remoteCreateCalls, [
    {
      machineId: 'machine_remote01',
      request: {
        actionId: 'act_project_001',
        path: '/srv/remote-only',
      },
    },
  ])

  const location = {
    projectId: projectA.projectId,
    machineId: 'machine_remote01',
    rootPath: '/srv/remote-only',
    availability: 'available',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const remoteProject = { ...projectA, locations: [location] }
  deferred.resolve({
    protocolVersion: 1,
    actionId: 'act_project_001',
    status: 'completed',
    data: { project: remoteProject, location, created: true },
  })
  await first

  assert.equal(
    queryClient.getQueryState(projectQueryKeys.list).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState([
      'host',
      'machines',
      'detail',
      'machine_remote01',
    ]).isInvalidated,
    true,
  )
})

test('ProjectLocation removal is exact, deduplicated, and refreshes Project and Machine truth', async () => {
  const remoteLocation = {
    projectId: projectA.projectId,
    machineId: 'machine_remote01',
    rootPath: '/srv/项目 alpha',
    availability: 'unavailable',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const projectWithRemote = {
    ...projectA,
    locations: [...projectA.locations, remoteLocation],
  }
  const deferred = createDeferred()
  const client = new FakeProjectClient({
    removeLocation: () => deferred.promise,
  })
  const queryClient = createQueryClient()
  queryClient.setQueryData(projectQueryKeys.list, [projectWithRemote])
  queryClient.setQueryData(
    projectQueryKeys.detail(projectA.projectId),
    projectWithRemote,
  )
  queryClient.setQueryData(['host', 'machines', 'list'], [{ stale: true }])
  queryClient.setQueryData(['host', 'machines', 'detail', 'machine_remote01'], {
    stale: true,
  })
  const actions = new ProjectActions(client, idFactory(), queryClient)

  const first = actions.removeProjectLocation(
    projectA.projectId,
    remoteLocation.machineId,
  )
  const duplicate = actions.removeProjectLocation(
    projectA.projectId,
    remoteLocation.machineId,
  )
  assert.strictEqual(first, duplicate)
  assert.deepEqual(client.removeLocationCalls, [
    {
      projectId: projectA.projectId,
      machineId: remoteLocation.machineId,
      request: { actionId: 'act_project_001' },
    },
  ])

  deferred.resolve(
    removeLocationResponse(
      'act_project_001',
      projectA,
      remoteLocation.machineId,
    ),
  )
  await first

  assert.deepEqual(
    queryClient.getQueryData(projectQueryKeys.detail(projectA.projectId)),
    projectA,
  )
  assert.equal(
    queryClient.getQueryState(projectQueryKeys.list).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState(['host', 'machines', 'list']).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState([
      'host',
      'machines',
      'detail',
      remoteLocation.machineId,
    ]).isInvalidated,
    true,
  )
})

test('browser Project action IDs are valid and unique', () => {
  const ids = Array.from({ length: 64 }, () => createBrowserActionId())
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => /^act_[A-Za-z0-9_-]{6,95}$/u.test(id)))
})

test('Project errors use stable safe copy and never expose Host diagnostics', () => {
  const invalid = responseError(
    422,
    'invalid_request',
    'C:\\secret\\workspace stack trace',
  )
  const conflict = responseError(
    409,
    'project_has_conversations',
    'foreign key and database diagnostics',
  )
  const locationConflict = responseError(
    409,
    'project_location_has_conversations',
    'conversation table and private location details',
  )

  assert.equal(
    projectErrorMessage(invalid, 'create'),
    '项目路径无效或当前无法访问，请确认它是允许访问的绝对目录。',
  )
  assert.equal(
    projectErrorMessage(conflict, 'remove'),
    '此项目仍有关联会话，当前不能移除。',
  )
  assert.equal(
    projectErrorMessage(locationConflict, 'remove-location'),
    '此工作区位置仍有关联会话，当前不能移除。',
  )
  assert.equal(
    projectErrorMessage(new TypeError('fetch internals'), 'load'),
    'CodeTether 暂时无法连接，请重试。',
  )
  for (const message of [
    projectErrorMessage(invalid, 'create'),
    projectErrorMessage(conflict, 'remove'),
    projectErrorMessage(locationConflict, 'remove-location'),
  ]) {
    assert.equal(message.includes('secret'), false)
    assert.equal(message.includes('database'), false)
  }
})

test('Project list states distinguish loading, unavailable, empty, and ready', () => {
  assert.deepEqual(projectListViewState({ status: 'pending' }), {
    kind: 'loading',
  })
  assert.deepEqual(projectListViewState({ status: 'success', data: [] }), {
    kind: 'empty',
  })
  assert.equal(
    projectListViewState({
      status: 'error',
      data: [],
      error: new TypeError('offline'),
    }).kind,
    'unavailable',
  )
  assert.deepEqual(
    projectListViewState({ status: 'success', data: [projectA, projectB] }),
    { kind: 'ready', projects: [projectA, projectB] },
  )
})

test('Project detail states distinguish Host failure, not found, and filesystem availability', () => {
  assert.equal(projectDetailViewState({ status: 'pending' }).kind, 'loading')
  assert.equal(
    projectDetailViewState({
      status: 'error',
      error: responseError(404, 'not_found', 'internal lookup'),
    }).kind,
    'not-found',
  )
  assert.equal(
    projectDetailViewState({
      status: 'error',
      error: new TypeError('offline'),
    }).kind,
    'host-unavailable',
  )
  assert.deepEqual(
    projectDetailViewState({ status: 'success', data: projectA }),
    { kind: 'available', project: projectA },
  )
  const unavailable = projectDetailViewState({
    status: 'success',
    data: projectB,
  })
  assert.equal(unavailable.kind, 'unavailable')
  assert.deepEqual(unavailable.project, projectB)
})

class FakeProjectClient {
  constructor(implementations = {}) {
    this.implementations = implementations
    this.listCalls = []
    this.getCalls = []
    this.createCalls = []
    this.remoteCreateCalls = []
    this.deleteCalls = []
    this.locationCalls = []
    this.removeLocationCalls = []
  }

  async listProjects(options = {}) {
    this.listCalls.push(options)
    return (
      this.implementations.list?.(options) ?? {
        protocolVersion: 1,
        projects: [projectA, projectB],
      }
    )
  }

  async getProject(projectId, options = {}) {
    this.getCalls.push({ projectId, ...options })
    return (
      this.implementations.get?.(projectId, options) ?? {
        protocolVersion: 1,
        project: projectId === projectA.projectId ? projectA : projectB,
      }
    )
  }

  createProject(request) {
    this.createCalls.push(request)
    return (
      this.implementations.create?.(request) ??
      Promise.resolve(createResponse(request.actionId, projectA, true))
    )
  }

  createRemoteProject(machineId, request) {
    const call = { machineId, request }
    this.remoteCreateCalls.push(call)
    return (
      this.implementations.remoteCreate?.(call) ??
      Promise.reject(new Error('Unexpected remote Project creation'))
    )
  }

  deleteProject(projectId, request) {
    const call = { projectId, request }
    this.deleteCalls.push(call)
    return (
      this.implementations.delete?.(call) ??
      Promise.resolve(deleteResponse(request.actionId, projectId))
    )
  }

  registerProjectLocation(projectId, request) {
    const call = { projectId, request }
    this.locationCalls.push(call)
    const location = {
      projectId,
      machineId: request.machineId,
      rootPath: request.path,
      availability: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return (
      this.implementations.location?.(call) ??
      Promise.resolve(
        registerLocationResponse(
          request.actionId,
          { ...projectA, locations: [...projectA.locations, location] },
          location,
        ),
      )
    )
  }

  removeProjectLocation(projectId, machineId, request) {
    const call = { projectId, machineId, request }
    this.removeLocationCalls.push(call)
    return (
      this.implementations.removeLocation?.(call) ??
      Promise.resolve(
        removeLocationResponse(request.actionId, projectA, machineId),
      )
    )
  }
}

function project(projectId, name, rootPath, availability = 'available') {
  return {
    projectId,
    name,
    locations: [
      {
        projectId,
        machineId: 'machine_local01',
        rootPath,
        availability,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createResponse(actionId, value, created) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { project: value, created },
  }
}

function deleteResponse(actionId, projectId) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { projectId },
  }
}

function registerLocationResponse(actionId, project, location) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { project, location, created: true },
  }
}

function removeLocationResponse(actionId, project, machineId) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { project, machineId },
  }
}

function responseError(status, code, message) {
  return new CodeTetherResponseError(status, {
    protocolVersion: 1,
    actionId: 'act_project_error',
    code,
    message,
  })
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function idFactory() {
  let index = 0
  return () => `act_project_${String(++index).padStart(3, '0')}`
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
