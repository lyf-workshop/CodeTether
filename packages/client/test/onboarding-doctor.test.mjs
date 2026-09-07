import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherClient } from '../dist/index.js'

const timestamp = '2026-09-07T12:00:00.000Z'
const onboarding = {
  flowVersion: 1,
  step: 'project_setup',
  revision: 4,
  startedAt: timestamp,
  updatedAt: timestamp,
}

test('client exposes strict onboarding reads and PATCH mutations', async () => {
  const calls = []
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4317',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      if (init?.method === 'PATCH') {
        return jsonResponse({
          protocolVersion: 1,
          actionId: 'act_client_onboarding01',
          status: 'completed',
          data: {
            onboarding: {
              ...onboarding,
              step: 'previous_conversations',
              revision: 5,
              projectId: 'proj_client_onboarding01',
              machineId: 'machine_client_onboarding01',
            },
            changed: true,
          },
        })
      }
      return jsonResponse({ protocolVersion: 1, onboarding })
    },
  })

  assert.equal((await client.getOnboarding()).onboarding.step, 'project_setup')
  const updated = await client.updateOnboarding({
    actionId: 'act_client_onboarding01',
    expectedRevision: 4,
    transition: {
      kind: 'project_selected',
      projectId: 'proj_client_onboarding01',
      machineId: 'machine_client_onboarding01',
    },
  })
  assert.equal(updated.data.onboarding.step, 'previous_conversations')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[1].init.method, 'PATCH')
  assert.equal(calls[1].url, 'http://127.0.0.1:4317/api/v1/onboarding')
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    actionId: 'act_client_onboarding01',
    expectedRevision: 4,
    transition: {
      kind: 'project_selected',
      projectId: 'proj_client_onboarding01',
      machineId: 'machine_client_onboarding01',
    },
  })
})

test('client requests Doctor with only an opaque Project identity and explicit check flag', async () => {
  const requestedUrls = []
  const client = new CodeTetherClient({
    baseUrl: 'http://127.0.0.1:4317',
    fetch: async (url) => {
      requestedUrls.push(String(url))
      return jsonResponse(doctorResponse())
    },
  })
  const response = await client.getDoctor({
    projectId: 'proj_client_onboarding01',
  })
  assert.equal(response.doctor.overall, 'needs_attention')
  assert.equal(
    requestedUrls[0],
    'http://127.0.0.1:4317/api/v1/doctor?projectId=proj_client_onboarding01',
  )
  await client.getDoctor({
    projectId: 'proj_client_onboarding01',
    check: true,
  })
  assert.equal(
    requestedUrls[1],
    'http://127.0.0.1:4317/api/v1/doctor?projectId=proj_client_onboarding01&check=true',
  )
  assert.equal(JSON.stringify(response).includes('C:\\'), false)
})

function doctorResponse() {
  const provider = (providerId) => ({
    provider: providerId,
    state: 'unavailable',
    installed: false,
    selected: false,
    alternateInstallations: 0,
    freshness: 'not_observed',
    sessionDiscovery: 'unknown',
  })
  return {
    protocolVersion: 1,
    doctor: {
      generatedAt: timestamp,
      overall: 'needs_attention',
      thisComputer: {
        machineId: 'machine_client_onboarding01',
        displayName: 'This computer',
        platform: 'Windows',
        architecture: 'x64',
        state: 'ready',
      },
      providers: [provider('codex'), provider('claude-code')],
      project: {
        projectId: 'proj_client_onboarding01',
        name: 'Test project',
        state: 'ready',
        locations: [
          {
            machineId: 'machine_client_onboarding01',
            machineName: 'This computer',
            machineKind: 'local',
            state: 'ready',
          },
        ],
      },
      remoteComputers: [],
    },
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
