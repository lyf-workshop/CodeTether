import assert from 'node:assert/strict'
import test from 'node:test'

import { MachineTransportError } from '@codetether/machine-transport'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'

import {
  SupervisorClientError,
  SupervisorServer,
  canonicalJsonBytes,
  connectSupervisorDirect,
  supervisorDescriptorProofType,
  supervisorClientAuthenticateSchema,
  supervisorGrantDigest,
  supervisorGrantProofType,
  supervisorB1OperationSchema,
  supervisorFailureFromError,
  supervisorProjectCreateDataSchema,
  supervisorRequestSchema,
  supervisorResponseSchema,
} from '../dist/index.js'

const ids = {
  authorizationId: `hauth_${'a'.repeat(32)}`,
  deviceId: `dev_${'d'.repeat(32)}`,
  hostId: `host_${'h'.repeat(32)}`,
  userId: `usr_${'u'.repeat(32)}`,
  spaceId: `space_${'s'.repeat(32)}`,
}

test('direct Supervisor transport verifies exact identities and exposes only reads', async () => {
  const fixture = await createFixture()
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    assert.equal(pending.challenge.hostId, ids.hostId)
    const connected = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'test-device-proof',
    })
    assert.deepEqual(await connected.readHostBootstrap(), {
      hostId: ids.hostId,
    })
    assert.deepEqual(await connected.listMachines(), {
      machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
    })
    assert.deepEqual(await connected.getMachine(`machine_${'m'.repeat(32)}`), {
      providers: ['codex', 'claude-code'],
    })
    assert.deepEqual(
      await connected.listProjects(`machine_${'m'.repeat(32)}`, { limit: 25 }),
      { projects: [{ projectId: `proj_${'p'.repeat(32)}` }], hasMore: false },
    )
    assert.deepEqual(
      await connected.getProject(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
      ),
      { projectId: `proj_${'p'.repeat(32)}` },
    )
    assert.deepEqual(
      await connected.listConversations(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        { limit: 25 },
      ),
      {
        conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
        hasMore: false,
      },
    )
    assert.deepEqual(
      await connected.getConversation(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
      ),
      { conversationId: `conv_${'c'.repeat(32)}` },
    )
    assert.deepEqual(
      await connected.readConversationHistory(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
        { limit: 20 },
      ),
      { entries: 20, historyComplete: false },
    )
    assert.deepEqual(
      await connected.readConversationLive(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
        {
          cursor: '123e4567-e89b-42d3-a456-426614174000:0',
          limit: 64,
          waitMs: 0,
        },
      ),
      terminalLivePage(),
    )
    assert.deepEqual(await connected.getAction(`act_${'a'.repeat(32)}`), {
      protocolVersion: 1,
      actionId: `act_${'a'.repeat(32)}`,
      status: 'not_found',
    })
    connected.close()
    assert.equal(
      supervisorRequestSchema.safeParse({
        type: 'supervisor.request',
        protocolVersion: 1,
        requestId: `sreq_${'r'.repeat(32)}`,
        operation: 'conversation.start',
      }).success,
      false,
    )
    for (const operation of [
      'conversation.send',
      'conversation.resume',
      'conversation.create',
      'turn.cancel',
      'provider.start',
      'tool.approve',
      'shell.execute',
      'filesystem.write',
    ]) {
      assert.equal(
        supervisorRequestSchema.safeParse({
          type: 'supervisor.request',
          protocolVersion: 1,
          requestId: `sreq_${'r'.repeat(32)}`,
          operation,
        }).success,
        false,
      )
    }
    assert.equal(
      supervisorClientAuthenticateSchema.safeParse({
        type: 'supervisor.authenticate',
        protocolVersion: 1,
        accessToken: 'human-token',
        deviceProof: 'product-device-proof',
        controllerCredential: 'controller-identity-is-not-admitted',
      }).success,
      false,
    )
  } finally {
    await fixture.server.close()
  }
})

test('Supervisor read failures log only safe operation and error metadata', async () => {
  const diagnostics = []
  const overflows = []
  const machineId = `machine_${'m'.repeat(32)}`
  const privatePath = 'D:/private/project'
  const privateTitle = 'Private conversation title'
  const fixture = await createFixture({
    reads: {
      getMachine: () => ({ recentConversations: privateTitle.repeat(800) }),
      listProjects: () => {
        throw new MachineTransportError('connection_failed', privatePath)
      },
      getProject: () => {
        throw Object.assign(new Error(privateTitle), {
          code: privatePath,
          name: privateTitle,
        })
      },
    },
    onDiagnostic: (event, fields) => {
      if (event === 'supervisor.read.failed') diagnostics.push(fields)
      if (event === 'supervisor.read.frame_too_large') overflows.push(fields)
    },
  })
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'test-device-proof',
    })
    const failure = { name: 'SupervisorClientError', code: 'internal' }
    await assert.rejects(session.getMachine(machineId), failure)
    await assert.rejects(
      session.listProjects(machineId, { limit: 25 }),
      failure,
    )
    await assert.rejects(
      session.getProject(machineId, `proj_${'p'.repeat(32)}`),
      failure,
    )
    session.close()

    assert.equal(overflows.length, 1)
    const { responseBytes, ...overflow } = overflows[0]
    assert.ok(responseBytes > 16 * 1024)
    assert.deepEqual(overflow, {
      operation: 'machine.get',
      transport: 'direct',
    })

    const metadata = diagnostics.map(({ latencyMs, ...fields }) => {
      assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0)
      return fields
    })
    assert.deepEqual(metadata, [
      {
        operation: 'machine.get',
        transport: 'direct',
        code: 'internal',
        errorClass: 'RangeError',
      },
      {
        operation: 'project.list',
        transport: 'direct',
        code: 'internal',
        errorClass: 'MachineTransportError',
        causeCode: 'connection_failed',
      },
      {
        operation: 'project.get',
        transport: 'direct',
        code: 'internal',
        errorClass: 'Error',
      },
    ])
  } finally {
    await fixture.server.close()
  }
})

test('B4a operation schemas keep old directory defaults and bound new input', () => {
  const scope = {
    machineId: `machine_${'m'.repeat(32)}`,
    projectId: `proj_${'p'.repeat(32)}`,
    conversationId: `conv_${'c'.repeat(32)}`,
  }
  const actionId = `act_${'a'.repeat(32)}`
  const request = (operation) => ({
    type: 'supervisor.request',
    protocolVersion: 1,
    requestId: `sreq_${'r'.repeat(32)}`,
    ...operation,
  })
  assert.equal(
    supervisorRequestSchema.parse(
      request({
        operation: 'conversation.list',
        machineId: scope.machineId,
        projectId: scope.projectId,
        limit: 25,
      }),
    ).archived,
    'all',
  )
  assert.equal(
    supervisorB1OperationSchema.parse({
      operation: 'conversation.search',
      projectId: scope.projectId,
      query: '  RECONNECT  ',
    }).limit,
    25,
  )
  assert.equal(
    supervisorB1OperationSchema.parse({
      operation: 'conversation.search',
      projectId: scope.projectId,
      query: '  RECONNECT  ',
    }).archive,
    'active',
  )
  for (const operation of [
    {
      operation: 'project.create',
      machineId: scope.machineId,
      actionId,
      path: '/tmp/project',
    },
    { operation: 'project.remove', projectId: scope.projectId, actionId },
    { operation: 'conversation.pin', ...scope, actionId, pinned: true },
    {
      operation: 'conversation.rename',
      ...scope,
      actionId,
      title: 'Cafe\u0301',
    },
    { operation: 'conversation.restore', ...scope, actionId },
    {
      operation: 'conversation.search',
      projectId: scope.projectId,
      query: 'hello',
    },
  ]) {
    assert.equal(
      supervisorRequestSchema.safeParse(request(operation)).success,
      true,
    )
  }
  assert.equal(
    supervisorB1OperationSchema.parse({
      operation: 'conversation.rename',
      ...scope,
      actionId,
      title: 'Cafe\u0301',
    }).title,
    'Café',
  )
  assert.equal(
    supervisorRequestSchema.safeParse(
      request({
        operation: 'project.create',
        machineId: scope.machineId,
        actionId,
        path: '你'.repeat(1_366),
      }),
    ).success,
    false,
  )
  assert.equal(
    supervisorRequestSchema.safeParse(
      request({
        operation: 'conversation.search',
        projectId: scope.projectId,
        query: 'x'.repeat(257),
      }),
    ).success,
    false,
  )
  assert.equal(
    supervisorRequestSchema.safeParse(
      request({
        operation: 'conversation.pin',
        ...scope,
        actionId,
        pinned: true,
        unexpected: 'not allowed',
      }),
    ).success,
    false,
  )
  assert.equal(
    supervisorResponseSchema.safeParse({
      type: 'supervisor.response',
      protocolVersion: 1,
      requestId: `sreq_${'r'.repeat(32)}`,
      ok: false,
      code: 'conflict',
      data: { reason: 'project_has_conversations' },
    }).success,
    true,
  )
  assert.equal(
    supervisorResponseSchema.safeParse({
      type: 'supervisor.response',
      protocolVersion: 1,
      requestId: `sreq_${'r'.repeat(32)}`,
      ok: false,
      code: 'conflict',
      data: { reason: '/private/path' },
    }).success,
    false,
  )
})

test('B4a error mapping preserves safe Host reasons and canonical fallbacks', () => {
  const failure = (code, reason, httpStatus) =>
    Object.assign(new Error('private path and title'), {
      code,
      ...(reason === undefined ? {} : { failure: { reason } }),
      httpStatus,
    })
  assert.deepEqual(
    supervisorFailureFromError(failure('project_has_conversations')),
    { code: 'conflict', reason: 'project_has_conversations' },
  )
  assert.deepEqual(
    supervisorFailureFromError(
      failure('invalid_request', 'project_location_invalid'),
    ),
    { code: 'invalid_request', reason: 'project_location_invalid' },
  )
  assert.deepEqual(supervisorFailureFromError(failure('machine_unreachable')), {
    code: 'unavailable',
    reason: 'machine_unreachable',
  })
  assert.deepEqual(
    supervisorFailureFromError(failure('unsupported', undefined, 422)),
    { code: 'unsupported', reason: 'unsupported', httpStatus: 422 },
  )
  assert.deepEqual(supervisorFailureFromError(failure('/private/path')), {
    code: 'internal',
  })
})

test('B4a project create data makes a reduced Location list explicit', () => {
  const projectId = `proj_${'p'.repeat(32)}`
  const location = {
    projectId,
    machineId: `machine_${'m'.repeat(32)}`,
    rootPath: '/tmp/project',
    availability: 'available',
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
  }
  const project = {
    projectId,
    name: 'Project',
    locations: [location],
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  }
  assert.equal(
    supervisorProjectCreateDataSchema.safeParse({
      project,
      location,
      created: true,
    }).success,
    true,
  )
  const projected = {
    project: {
      ...project,
      _projection: {
        type: 'target_location_only',
        reason: 'frame_size_exceeded',
        completeSizeEstimate: 20_000,
        omittedLocationCount: 2,
      },
    },
    location,
    created: false,
  }
  assert.equal(
    supervisorProjectCreateDataSchema.safeParse(projected).success,
    true,
  )
  assert.equal(
    supervisorProjectCreateDataSchema.safeParse({
      ...projected,
      project: {
        ...projected.project,
        locations: [
          location,
          { ...location, machineId: `machine_${'n'.repeat(32)}` },
        ],
      },
    }).success,
    false,
  )
})

test('B4a read permission allows search but denies all new writes', async () => {
  const invoked = []
  const fixture = await createFixture({
    operations: (request) => {
      invoked.push(request.operation)
      return { operation: request.operation }
    },
  })
  const scope = {
    machineId: `machine_${'m'.repeat(32)}`,
    projectId: `proj_${'p'.repeat(32)}`,
    conversationId: `conv_${'c'.repeat(32)}`,
  }
  const actionId = `act_${'a'.repeat(32)}`
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'b4a-read-proof',
    })
    assert.deepEqual(
      await session.executeOperation({
        operation: 'conversation.search',
        projectId: scope.projectId,
        query: 'hello',
        archive: 'active',
        limit: 25,
      }),
      { operation: 'conversation.search' },
    )
    for (const operation of [
      {
        operation: 'project.create',
        machineId: scope.machineId,
        actionId,
        path: '/tmp/project',
      },
      { operation: 'project.remove', projectId: scope.projectId, actionId },
      { operation: 'conversation.pin', ...scope, actionId, pinned: true },
      {
        operation: 'conversation.rename',
        ...scope,
        actionId,
        title: 'New title',
      },
      { operation: 'conversation.restore', ...scope, actionId },
    ]) {
      await assert.rejects(session.executeOperation(operation), {
        code: 'operation_not_allowed',
      })
    }
    assert.deepEqual(invoked, ['conversation.search'])
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('B4a control writes return reasons and check the real 16 KiB frame bound', async () => {
  const diagnostics = []
  const fixture = await createFixture({
    controlEnabled: true,
    operations: (request) => {
      if (request.operation === 'project.remove') {
        throw Object.assign(new Error('private project path'), {
          code: 'project_has_conversations',
        })
      }
      if (request.operation === 'conversation.rename') {
        return { title: 'secret'.repeat(4_000) }
      }
      return { operation: request.operation }
    },
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })
  const scope = {
    machineId: `machine_${'m'.repeat(32)}`,
    projectId: `proj_${'p'.repeat(32)}`,
    conversationId: `conv_${'c'.repeat(32)}`,
  }
  const actionId = `act_${'a'.repeat(32)}`
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'b4a-control-proof',
    })
    assert.deepEqual(
      await session.executeOperation({
        operation: 'project.create',
        machineId: scope.machineId,
        path: '/tmp/project',
        actionId,
      }),
      { operation: 'project.create' },
    )
    await assert.rejects(
      session.executeOperation({
        operation: 'project.remove',
        projectId: scope.projectId,
        actionId,
      }),
      (error) => {
        assert.equal(error.code, 'conflict')
        assert.equal(error.reason, 'project_has_conversations')
        assert.equal(error.message.includes('private'), false)
        return true
      },
    )
    await assert.rejects(
      session.executeOperation({
        operation: 'conversation.rename',
        ...scope,
        actionId,
        title: 'Safe title',
      }),
      { code: 'internal' },
    )
    assert.deepEqual(
      await session.executeOperation({
        operation: 'conversation.pin',
        ...scope,
        actionId,
        pinned: true,
      }),
      { operation: 'conversation.pin' },
    )
    assert.deepEqual(
      await session.executeOperation({
        operation: 'conversation.restore',
        ...scope,
        actionId,
      }),
      { operation: 'conversation.restore' },
    )
    const overflow = diagnostics.find(
      ({ event }) => event === 'supervisor.write.frame_too_large',
    )
    assert.equal(overflow.fields.operation, 'conversation.rename')
    assert.ok(overflow.fields.responseBytes > 16 * 1024)
    assert.equal(JSON.stringify(diagnostics).includes('secret'), false)
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('invalid B4a operation fields return invalid_request without closing the session', async () => {
  const fixture = await createFixture({ controlEnabled: true })
  const scope = {
    machineId: `machine_${'m'.repeat(32)}`,
    projectId: `proj_${'p'.repeat(32)}`,
    conversationId: `conv_${'c'.repeat(32)}`,
  }
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'b4a-invalid-fields-proof',
    })
    await assert.rejects(
      session.executeOperation({
        operation: 'conversation.rename',
        ...scope,
        actionId: `act_${'a'.repeat(32)}`,
        title: 'x'.repeat(241),
      }),
      (error) => {
        assert.equal(error.code, 'invalid_request')
        assert.equal(error.reason, 'invalid_request')
        return true
      },
    )
    assert.deepEqual(
      await session.executeOperation({
        operation: 'conversation.pin',
        ...scope,
        actionId: `act_${'b'.repeat(32)}`,
        pinned: true,
      }),
      { operation: 'conversation.pin' },
    )
    await assert.rejects(
      session.executeOperation({
        type: 'invalid.request',
        operation: 'conversation.search',
        projectId: scope.projectId,
        query: 'hello',
        archive: 'active',
        limit: 25,
      }),
    )
    await assert.rejects(session.readHostBootstrap())
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('Host identity mismatch and replayed ProductDevice proof fail closed', async () => {
  const usedProofs = new Set()
  const fixture = await createFixture({ usedProofs })
  try {
    await assert.rejects(
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedHost: {
          ...fixture.clientOptions.expectedHost,
          fingerprint: `sha256:${'Z'.repeat(43)}`,
        },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'host_identity_mismatch',
    )
    const first = await connectSupervisorDirect(fixture.clientOptions)
    const session = await first.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'one-use-proof',
    })
    session.close()
    const replay = await connectSupervisorDirect(fixture.clientOptions)
    await assert.rejects(
      replay.authenticate({
        accessToken: 'test-access-token',
        deviceProof: 'one-use-proof',
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'authentication_failed',
    )
  } finally {
    await fixture.server.close()
  }
})

test('read-only Supervisor sessions cannot control Conversations', async () => {
  const fixture = await createFixture()
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'control-denied-proof',
    })
    await assert.rejects(
      session.startConversationTurn({
        actionId: `act_${'a'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    await assert.rejects(
      session.createConversation({
        actionId: `act_${'c'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        provider: 'codex',
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    const actionId = `act_${'j'.repeat(32)}`
    const conversation = {
      machineId: `machine_${'m'.repeat(32)}`,
      projectId: `proj_${'p'.repeat(32)}`,
      conversationId: `conv_${'c'.repeat(32)}`,
    }
    for (const request of [
      { operation: 'conversation.archive', ...conversation, actionId },
      {
        operation: 'attention.resolve',
        attentionId: `attn_${'a'.repeat(32)}`,
        actionId,
      },
      {
        operation: 'approval.resolve',
        approvalId: `approval_${'a'.repeat(32)}`,
        decision: 'accept',
        actionId,
      },
      {
        operation: 'turn.interrupt',
        ...conversation,
        turnId: `turn_${'a'.repeat(32)}`,
        actionId,
      },
    ]) {
      await assert.rejects(session.executeB1Operation(request), {
        code: 'operation_not_allowed',
      })
    }
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('matching signed grant and admission scope permit the fixed control union', async () => {
  const fixture = await createFixture({ controlEnabled: true })
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'control-allowed-proof',
    })
    assert.deepEqual(
      await session.startConversationTurn({
        actionId: `act_${'b'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      { accepted: true, operation: 'conversation.turn.start' },
    )
    assert.deepEqual(
      await session.createConversation({
        actionId: `act_${'d'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        provider: 'codex',
        input: { type: 'text', text: 'safe' },
      }),
      { accepted: true, operation: 'conversation.create' },
    )
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('a disagreement between signed scope and Control Plane scope fails closed', async () => {
  for (const controlEnabled of [false, true]) {
    const fixture = await createFixture({
      controlEnabled,
      admittedScope: controlEnabled ? 'supervisor_read' : 'supervisor_control',
    })
    try {
      const pending = await connectSupervisorDirect(fixture.clientOptions)
      await assert.rejects(
        pending.authenticate({ accessToken: 'token', deviceProof: 'proof' }),
        { code: 'authentication_failed' },
      )
    } finally {
      await fixture.server.close()
    }
  }
})

test('one Host presence serves two independently scoped ProductDevices', async () => {
  const fixture = await createFixture({
    controlAuthorizationId: ids.authorizationId,
  })
  const macAuthorizationId = `hauth_${'b'.repeat(32)}`
  const macDeviceId = `dev_${'e'.repeat(32)}`
  const hostPresencePayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_presence',
    hostId: ids.hostId,
    hostFingerprint: fixture.clientOptions.expectedHost.fingerprint,
    hostIdentityGeneration: 1,
    spaceId: ids.spaceId,
    transportTlsFingerprint: fixture.server.tlsIdentity.publicKeyFingerprint,
    controlPlaneOrigin: 'https://control-plane.example.test',
    directEndpoints: [fixture.clientOptions.endpoint],
    relay: null,
    iat: Math.floor(fixture.now.getTime() / 1_000),
    exp: Math.floor((fixture.now.getTime() + 10 * 60_000) / 1_000),
    protocolVersion: 2,
  }
  const presence = {
    payload: hostPresencePayload,
    proof: await sign(
      fixture.privateKey,
      supervisorDescriptorProofType,
      hostPresencePayload,
    ),
  }
  const macGrantPayload = {
    ...fixture.clientOptions.grant.payload,
    authorizationId: macAuthorizationId,
    deviceId: macDeviceId,
    deviceFingerprint: `sha256:${'E'.repeat(43)}`,
    authorizationSerial: '2',
    scope: 'supervisor_read',
  }
  const macGrant = {
    payload: macGrantPayload,
    proof: await sign(
      fixture.privateKey,
      supervisorGrantProofType,
      macGrantPayload,
    ),
  }
  try {
    await fixture.server.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: fixture.clientOptions.grant,
      descriptor: presence,
    })
    await fixture.server.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: macGrant,
      descriptor: presence,
    })
    assert.equal(fixture.server.activationCount, 2)
    const [windowsPending, macPending] = await Promise.all([
      connectSupervisorDirect({
        ...fixture.clientOptions,
        descriptor: presence,
      }),
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedDevice: { deviceId: macDeviceId, keyGeneration: 1 },
        grant: macGrant,
        descriptor: presence,
      }),
    ])
    const [windows, mac] = await Promise.all([
      windowsPending.authenticate({
        accessToken: 'windows-token',
        deviceProof: 'windows-proof',
      }),
      macPending.authenticate({
        accessToken: 'mac-token',
        deviceProof: 'mac-proof',
      }),
    ])
    assert.equal(windows.control, 'control')
    assert.equal(mac.control, 'read')
    assert.deepEqual(await windows.readHostBootstrap(), { hostId: ids.hostId })
    assert.deepEqual(await mac.readHostBootstrap(), { hostId: ids.hostId })
    await assert.rejects(
      mac.startConversationTurn({
        actionId: `act_${'q'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    fixture.server.deactivate(macAuthorizationId)
    assert.equal(fixture.server.activationCount, 1)
    assert.deepEqual(await windows.readHostBootstrap(), { hostId: ids.hostId })
    windows.close()
    mac.close()
    await assert.rejects(
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedDevice: { deviceId: macDeviceId, keyGeneration: 1 },
        grant: macGrant,
        descriptor: presence,
      }),
    )
  } finally {
    await fixture.server.close()
  }
})

test('a restarted Supervisor restores both exact grants under one renewed Host presence', async () => {
  const fixture = await createFixture()
  const secondGrantPayload = {
    ...fixture.clientOptions.grant.payload,
    authorizationId: `hauth_${'b'.repeat(32)}`,
    deviceId: `dev_${'e'.repeat(32)}`,
    deviceFingerprint: `sha256:${'E'.repeat(43)}`,
    authorizationSerial: '2',
  }
  const secondGrant = {
    payload: secondGrantPayload,
    proof: await sign(
      fixture.privateKey,
      supervisorGrantProofType,
      secondGrantPayload,
    ),
  }
  await fixture.server.close()
  const restarted = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    now: () => fixture.now,
    authorize: async ({ challenge }) => ({
      hostId: challenge.hostId,
      hostIdentityGeneration: challenge.hostIdentityGeneration,
      deviceId: challenge.deviceId,
      deviceKeyGeneration: challenge.deviceKeyGeneration,
      authorizationId: challenge.authorizationId,
      scope: 'supervisor_read',
      authorizationExpiresAt: new Date(
        fixture.now.getTime() + 60 * 60_000,
      ).toISOString(),
    }),
    reads: { readHostBootstrap: () => ({ hostId: ids.hostId }) },
  })
  try {
    const address = await restarted.start()
    const payload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_presence',
      hostId: ids.hostId,
      hostFingerprint: fixture.clientOptions.expectedHost.fingerprint,
      hostIdentityGeneration: 1,
      spaceId: ids.spaceId,
      transportTlsFingerprint: restarted.tlsIdentity.publicKeyFingerprint,
      controlPlaneOrigin: 'https://control-plane.example.test',
      directEndpoints: [{ host: '127.0.0.1', port: address.port }],
      relay: null,
      iat: Math.floor(fixture.now.getTime() / 1_000),
      exp: Math.floor((fixture.now.getTime() + 10 * 60_000) / 1_000),
      protocolVersion: 2,
    }
    const presence = {
      payload,
      proof: await sign(
        fixture.privateKey,
        supervisorDescriptorProofType,
        payload,
      ),
    }
    for (const grant of [fixture.clientOptions.grant, secondGrant]) {
      await restarted.activate({
        hostPublicJwk: fixture.publicJwk,
        grant,
        descriptor: presence,
      })
    }
    assert.equal(restarted.activationCount, 2)
    for (const [grant, deviceId] of [
      [fixture.clientOptions.grant, ids.deviceId],
      [secondGrant, secondGrantPayload.deviceId],
    ]) {
      const pending = await connectSupervisorDirect({
        ...fixture.clientOptions,
        endpoint: payload.directEndpoints[0],
        expectedDevice: { deviceId, keyGeneration: 1 },
        grant,
        descriptor: presence,
      })
      const session = await pending.authenticate({
        accessToken: 'token',
        deviceProof: `proof-${deviceId}`,
      })
      assert.deepEqual(await session.readHostBootstrap(), {
        hostId: ids.hostId,
      })
      session.close()
    }
  } finally {
    await restarted.close()
  }
})

async function createFixture(options = {}) {
  const now = new Date('2026-09-24T12:00:00.000Z')
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const server = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    now: () => now,
    authorize: async ({ deviceProof, challenge }) => {
      if (options.usedProofs?.has(deviceProof)) throw new Error('replay')
      options.usedProofs?.add(deviceProof)
      return {
        hostId: challenge.hostId,
        hostIdentityGeneration: challenge.hostIdentityGeneration,
        deviceId: challenge.deviceId,
        deviceKeyGeneration: challenge.deviceKeyGeneration,
        authorizationId: challenge.authorizationId,
        scope: options.admittedScope ?? scope(challenge.authorizationId),
        authorizationExpiresAt: new Date(
          now.getTime() + 60 * 60_000,
        ).toISOString(),
      }
    },
    reads: {
      readHostBootstrap: () => ({ hostId: ids.hostId }),
      listMachines: () => ({
        machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
      }),
      getMachine: () => ({ providers: ['codex', 'claude-code'] }),
      listProjects: () => ({
        projects: [{ projectId: `proj_${'p'.repeat(32)}` }],
        hasMore: false,
      }),
      getProject: () => ({ projectId: `proj_${'p'.repeat(32)}` }),
      listConversations: () => ({
        conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
        hasMore: false,
      }),
      getConversation: () => ({ conversationId: `conv_${'c'.repeat(32)}` }),
      readConversationHistory: () => ({
        entries: 20,
        historyComplete: false,
      }),
      readConversationLive: () => terminalLivePage(),
      getAction: (actionId) => ({
        protocolVersion: 1,
        actionId,
        status: 'not_found',
      }),
      ...options.reads,
    },
    onDiagnostic: options.onDiagnostic,
    control: {
      startConversationTurn: () => ({
        accepted: true,
        operation: 'conversation.turn.start',
      }),
      createConversation: () => ({
        accepted: true,
        operation: 'conversation.create',
      }),
    },
    operations:
      options.operations ?? ((request) => ({ operation: request.operation })),
  })
  const address = await server.start()
  const grantPayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_grant',
    authorizationId: ids.authorizationId,
    hostId: ids.hostId,
    hostFingerprint: `sha256:${'H'.repeat(43)}`,
    hostIdentityGeneration: 1,
    deviceId: ids.deviceId,
    deviceFingerprint: `sha256:${'D'.repeat(43)}`,
    deviceKeyGeneration: 1,
    userId: ids.userId,
    spaceId: ids.spaceId,
    scope: scope(ids.authorizationId),
    authorizationSerial: '1',
    authorizationGeneration: 1,
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor((now.getTime() + 60 * 60_000) / 1_000),
  }
  const grant = {
    payload: grantPayload,
    proof: await sign(privateKey, supervisorGrantProofType, grantPayload),
  }
  const descriptorPayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_transport',
    authorizationId: ids.authorizationId,
    grantDigest: supervisorGrantDigest(grant),
    hostId: ids.hostId,
    hostFingerprint: grantPayload.hostFingerprint,
    hostIdentityGeneration: 1,
    deviceId: ids.deviceId,
    deviceKeyGeneration: 1,
    transportTlsFingerprint: server.tlsIdentity.publicKeyFingerprint,
    controlPlaneOrigin: 'https://control-plane.example.test',
    directEndpoints: [{ host: '127.0.0.1', port: address.port }],
    relay: null,
    iat: Math.floor(now.getTime() / 1_000),
    exp: Math.floor((now.getTime() + 10 * 60_000) / 1_000),
    protocolVersion: 1,
  }
  const descriptor = {
    payload: descriptorPayload,
    proof: await sign(
      privateKey,
      supervisorDescriptorProofType,
      descriptorPayload,
    ),
  }
  await server.activate({ hostPublicJwk: publicJwk, grant, descriptor })
  return {
    server,
    privateKey,
    publicJwk,
    now,
    clientOptions: {
      endpoint: descriptorPayload.directEndpoints[0],
      expectedHost: {
        hostId: ids.hostId,
        fingerprint: grantPayload.hostFingerprint,
        identityGeneration: 1,
        publicJwk,
      },
      expectedDevice: { deviceId: ids.deviceId, keyGeneration: 1 },
      grant,
      descriptor,
      now: () => now,
    },
  }

  function scope(authorizationId) {
    return options.controlEnabled === true ||
      options.controlAuthorizationId === authorizationId
      ? 'supervisor_control'
      : 'supervisor_read'
  }
}

function terminalLivePage() {
  const epoch = '123e4567-e89b-42d3-a456-426614174000'
  const conversationId = `conv_${'c'.repeat(32)}`
  const turnId = `turn_${'t'.repeat(32)}`
  return {
    protocolVersion: 1,
    conversationId,
    cursor: `${epoch}:2`,
    events: [
      {
        protocolVersion: 1,
        epoch,
        seq: 1,
        eventId: `${epoch}:1`,
        conversationId,
        turnId,
        itemId: `item_${'i'.repeat(32)}`,
        timestamp: '2026-09-24T12:00:00.000Z',
        type: 'message.completed',
        payload: { message: 'complete' },
      },
      {
        protocolVersion: 1,
        epoch,
        seq: 2,
        eventId: `${epoch}:2`,
        conversationId,
        turnId,
        timestamp: '2026-09-24T12:00:00.000Z',
        type: 'turn.completed',
        payload: { finalMessage: 'complete' },
      },
    ],
    resetRequired: false,
    active: false,
    timedOut: false,
  }
}

async function sign(privateKey, type, payload) {
  return await new CompactSign(canonicalJsonBytes(payload))
    .setProtectedHeader({ alg: 'ES256', typ: type })
    .sign(privateKey)
}
