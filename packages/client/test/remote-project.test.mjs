import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherClient } from '../dist/index.js'

const machineId = 'machine_remoteproject01'
const projectId = 'proj_remoteproject01'
const timestamp = '2026-09-07T12:00:00.000Z'

test('creates a remote-only Project through the exact Machine route', async () => {
  let call
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4317',
    fetch: async (url, init) => {
      call = { url: String(url), init }
      return jsonResponse(
        remoteProjectResponse(machineId, 'act_remoteproject01'),
      )
    },
  })
  const abort = new AbortController()
  const response = await client.createRemoteProject(
    machineId,
    {
      actionId: 'act_remoteproject01',
      name: 'Remote workspace',
      path: '/srv/project-links/workspace',
    },
    { signal: abort.signal },
  )

  assert.equal(response.data.location.machineId, machineId)
  assert.equal(
    call.url,
    `http://127.0.0.1:4317/api/v1/machines/${machineId}/projects`,
  )
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.signal, abort.signal)
  assert.deepEqual(JSON.parse(call.init.body), {
    actionId: 'act_remoteproject01',
    name: 'Remote workspace',
    path: '/srv/project-links/workspace',
  })
})

test('rejects a remote Project response from another Machine', async () => {
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4317',
    fetch: async () =>
      jsonResponse(
        remoteProjectResponse('machine_wrongremote01', 'act_remoteproject02'),
      ),
  })

  await assert.rejects(
    client.createRemoteProject(machineId, {
      actionId: 'act_remoteproject02',
      path: '/srv/projects/workspace',
    }),
    /does not match the requested Machine/u,
  )
})

function remoteProjectResponse(locationMachineId, actionId) {
  const location = {
    projectId,
    machineId: locationMachineId,
    rootPath: '/srv/projects/workspace',
    availability: 'available',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: {
      project: {
        projectId,
        name: 'Remote workspace',
        locations: [location],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      location,
      created: true,
    },
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
