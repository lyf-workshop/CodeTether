import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CreateRemoteProjectRequestSchema,
  CreateRemoteProjectResponseSchema,
} from '../dist/index.js'

const machineId = 'machine_remoteproject01'
const projectId = 'proj_remoteproject01'
const timestamp = '2026-09-07T12:00:00.000Z'

test('validates strict remote-only Project creation contracts', () => {
  const request = {
    actionId: 'act_remoteproject01',
    name: 'Remote workspace',
    path: '/srv/projects/workspace',
  }
  assert.deepEqual(CreateRemoteProjectRequestSchema.parse(request), request)
  assert.equal(
    CreateRemoteProjectRequestSchema.safeParse({
      ...request,
      machineId,
    }).success,
    false,
  )

  const location = {
    projectId,
    machineId,
    rootPath: '/srv/projects/workspace',
    availability: 'available',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const response = {
    protocolVersion: 1,
    actionId: request.actionId,
    status: 'completed',
    data: {
      project: {
        projectId,
        name: request.name,
        locations: [location],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      location,
      created: true,
    },
  }
  assert.deepEqual(CreateRemoteProjectResponseSchema.parse(response), response)
  assert.equal(
    CreateRemoteProjectResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        location: { ...location, projectId: 'proj_anotherproject01' },
      },
    }).success,
    false,
  )
  assert.equal(
    CreateRemoteProjectResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        location: { ...location, machineId: 'machine_otherremote01' },
      },
    }).success,
    false,
  )
})
