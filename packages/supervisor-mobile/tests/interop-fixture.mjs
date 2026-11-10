import {
  createECDH,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

import {
  parseUnverifiedDeviceRequestProof,
  PRODUCT_DEVICE_AUDIENCE,
  sha256Digest,
  verifyDeviceRequestProofSignature,
} from '../../../apps/control-plane/dist/auth/product-device-protocol.js'
import {
  generateRelayPinnedTlsIdentity,
  RelayService,
  RelayStateStore,
} from '../../../apps/relay/dist/index.js'
import {
  canonicalJsonBytes,
  connectSupervisorRelayHost,
  generateSupervisorTlsIdentity,
  SupervisorServer,
  supervisorDescriptorProofType,
  supervisorGrantProofType,
} from '../../supervisor-transport/dist/index.js'

const identities = {
  authorizationId: 'hauth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  deviceId: 'dev_dddddddddddddddddddddddddddddddd',
  hostId: 'host_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
  userId: 'usr_uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu',
  spaceId: 'space_ssssssssssssssssssssssssssssssss',
}
const machineId = 'machine_mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm'
const projectId = 'proj_pppppppppppppppppppppppppppppppp'
const conversationId = 'conv_cccccccccccccccccccccccccccccccc'
const localToken = 'isolated-test-admission'
const usedNonces = new Set()
const observedActions = new Map()

async function fixtureOptions() {
  const [mode, path, ...extra] = process.argv.slice(2)
  if (mode === '--android-device-jwk') {
    if (
      extra.length ||
      !path ||
      !isAbsolute(path) ||
      basename(path) !== 't1a-interop-device.json'
    ) {
      throw new Error('invalid-fixture-arguments')
    }
    const file = await open(path, 'r')
    let devicePublicJwk
    try {
      const bytes = Buffer.alloc(1025)
      const { bytesRead } = await file.read(bytes)
      if (bytesRead === bytes.length) throw new Error('invalid-device-jwk')
      devicePublicJwk = JSON.parse(bytes.subarray(0, bytesRead).toString())
    } finally {
      await file.close()
    }
    if (
      !devicePublicJwk ||
      Object.keys(devicePublicJwk).sort().join(',') !== 'crv,kty,x,y' ||
      devicePublicJwk.kty !== 'EC' ||
      devicePublicJwk.crv !== 'P-256' ||
      ![devicePublicJwk.x, devicePublicJwk.y].every(
        (value) =>
          typeof value === 'string' &&
          /^[A-Za-z0-9_-]{43}$/u.test(value) &&
          Buffer.from(value, 'base64url').toString('base64url') === value,
      )
    ) {
      throw new Error('invalid-device-jwk')
    }
    createPublicKey({ key: devicePublicJwk, format: 'jwk' })
    return { advertisedHost: '10.0.2.2', devicePublicJwk }
  }

  const misrouteInnerHost = mode === '--misroute-inner-host'
  if ((mode !== undefined && !misrouteInnerHost) || path !== undefined)
    throw new Error('invalid-fixture-arguments')
  const testDevice = createECDH('prime256v1')
  // Public fixture only. The Rust test uses the same synthetic scalar.
  testDevice.setPrivateKey(Buffer.alloc(32, 7))
  const point = testDevice.getPublicKey()
  return {
    advertisedHost: '127.0.0.1',
    misrouteInnerHost,
    devicePublicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
  }
}

async function authorize(
  devicePublicJwk,
  { challenge, challengeBody, accessToken, deviceProof },
) {
  try {
    const proof = parseUnverifiedDeviceRequestProof(deviceProof)
    await verifyDeviceRequestProofSignature(deviceProof, devicePublicJwk, proof)
    if (
      accessToken !== localToken ||
      proof.aud !== PRODUCT_DEVICE_AUDIENCE ||
      proof.v !== 1 ||
      proof.protocolVersion !== 1 ||
      proof.authTokenHash !== sha256Digest(localToken) ||
      proof.deviceId !== challenge.deviceId ||
      proof.keyGeneration !== challenge.deviceKeyGeneration ||
      proof.method !== 'POST' ||
      proof.resource !==
        '/v1/hosts/' + challenge.hostId + '/supervisor-admission' ||
      proof.bodySha256 !== sha256Digest(challengeBody) ||
      challenge.tlsExporter.length !== 43 ||
      Math.abs(Math.floor(Date.now() / 1000) - proof.iat) > 30
    ) {
      throw new Error('invalid-proof')
    }
    if (usedNonces.has(proof.nonce)) throw new Error('proof_replayed')
    usedNonces.add(proof.nonce)
  } catch (error) {
    if (error instanceof Error && error.message === 'proof_replayed')
      throw error
    throw new Error('authentication_failed', { cause: error })
  }
  return {
    hostId: challenge.hostId,
    hostIdentityGeneration: challenge.hostIdentityGeneration,
    deviceId: challenge.deviceId,
    deviceKeyGeneration: challenge.deviceKeyGeneration,
    authorizationId: challenge.authorizationId,
    scope: 'supervisor_control',
    authorizationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  }
}

const tagged = (fixtureOperation, result = {}) => ({
  fixtureOperation,
  ...result,
})
const reads = {
  readHostBootstrap: () =>
    tagged('host.bootstrap', { hostId: identities.hostId }),
  listMachines: () => tagged('machine.list', { machines: [{ machineId }] }),
  getMachine: (id) => tagged('machine.get', { machineId: id }),
  listProjects: (id, page) => tagged('project.list', { machineId: id, page }),
  getProject: (machine, project) => tagged('project.get', { machine, project }),
  listConversations: (machine, project, page) =>
    tagged('conversation.list', { machine, project, page }),
  getConversation: (machine, project, conversation) =>
    tagged('conversation.get', { machine, project, conversation }),
  readConversationHistory: (_machine, _project, conversation, page) =>
    tagged('conversation.history', { conversation, page }),
  readConversationLive: (_machine, _project, conversation, query) =>
    tagged('conversation.live.read', {
      conversation,
      cursor: query.cursor,
      events: [],
      active: false,
    }),
  getAction: (actionId) =>
    tagged('action.get', {
      actionId,
      observed: observedActions.get(actionId) ?? null,
    }),
}
function recordAction(request) {
  if (request.actionId === undefined) return {}
  const previous = observedActions.get(request.actionId)
  observedActions.set(request.actionId, {
    operation: request.operation,
    count: (previous?.count ?? 0) + 1,
  })
  return { actionId: request.actionId }
}

const control = {
  startConversationTurn: (request) =>
    tagged(request.operation, recordAction(request)),
  createConversation: (request) =>
    tagged(request.operation, { ...recordAction(request), conversationId }),
}

function operations(request) {
  const action = recordAction(request)
  if (
    request.operation === 'project.remove' &&
    request.actionId.startsWith('act_fixture_reason_')
  ) {
    throw Object.assign(new Error('conflict'), {
      failure: { reason: 'project_has_conversations' },
    })
  }
  if (
    request.operation === 'conversation.archive' &&
    /^act_fixture_busy_archive_(direct|relay)$/u.test(request.actionId)
  ) {
    throw Object.assign(new Error('unsupported'), { httpStatus: 409 })
  }
  return tagged(request.operation, action)
}

function signed(privateKey, type, payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: type }),
  ).toString('base64url')
  const body = Buffer.from(canonicalJsonBytes(payload)).toString('base64url')
  const input = header + '.' + body
  const signature = sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return { payload, proof: input + '.' + signature }
}

async function main() {
  const { advertisedHost, devicePublicJwk, misrouteInnerHost } =
    await fixtureOptions()
  const tempParent = await realpath(tmpdir())
  const root = await mkdtemp(join(tempParent, 'ct-tablet-interop-'))
  const store = new RelayStateStore(join(root, 'state'))
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  const relay = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 2_000,
    logger: { log() {} },
  })
  const supervisor = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    authorize: (request) => authorize(devicePublicJwk, request),
    reads,
    control,
    operations,
  })
  let registration
  try {
    await relay.start()
    const direct = await supervisor.start()
    const hostKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const publicJwk = hostKeys.publicKey.export({ format: 'jwk' })
    const now = Math.floor(Date.now() / 1000)
    const hostFingerprint = sha256Digest(canonicalJsonBytes(publicJwk))
    const grant = signed(hostKeys.privateKey, supervisorGrantProofType, {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      ...identities,
      hostFingerprint,
      hostIdentityGeneration: 1,
      deviceFingerprint: sha256Digest(canonicalJsonBytes(devicePublicJwk)),
      deviceKeyGeneration: 1,
      scope: 'supervisor_control',
      authorizationSerial: '1',
      authorizationGeneration: 1,
      issuedAt: now,
      expiresAt: now + 600,
    })
    // In this fixture mode, the signed route and Relay registration identify
    // one transport key. The existing Supervisor listener presents another key
    // on the inner TLS stream. Outer Relay authentication still succeeds.
    const relayTransportIdentity = misrouteInnerHost
      ? await generateSupervisorTlsIdentity('CodeTether Supervisor Host')
      : supervisor.tlsIdentity
    const relayDescriptor = {
      endpoint: `tls+pinned://${advertisedHost}:${relay.listeningAddress.port}`,
      relayId: relay.relayId,
      relayFingerprint: relay.relayFingerprint,
      rendezvousId: 'srv_ssssssssssssssssssssssssssssssss',
      rendezvousCapability: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      hostTransportFingerprint: relayTransportIdentity.publicKeyFingerprint,
    }
    const descriptor = signed(
      hostKeys.privateKey,
      supervisorDescriptorProofType,
      {
        v: 1,
        aud: 'codetether-host-supervisor',
        purpose: 'host_supervisor_presence',
        hostId: identities.hostId,
        hostFingerprint,
        hostIdentityGeneration: 1,
        spaceId: identities.spaceId,
        transportTlsFingerprint: relayTransportIdentity.publicKeyFingerprint,
        controlPlaneOrigin: 'https://control-plane.example.test',
        directEndpoints: [{ host: advertisedHost, port: direct.port }],
        relay: relayDescriptor,
        iat: now,
        exp: now + 300,
        protocolVersion: 2,
      },
    )
    const wrongRelayPin = signed(
      hostKeys.privateKey,
      supervisorDescriptorProofType,
      {
        ...descriptor.payload,
        relay: {
          ...relayDescriptor,
          relayFingerprint: createHash('sha256')
            .update('synthetic wrong outer Relay certificate')
            .digest('base64url'),
        },
      },
    )
    // Activation must name the real listener's key, even in the misrouting case.
    const actualDescriptor = signed(
      hostKeys.privateKey,
      supervisorDescriptorProofType,
      {
        ...descriptor.payload,
        transportTlsFingerprint: supervisor.tlsIdentity.publicKeyFingerprint,
        relay: {
          ...relayDescriptor,
          hostTransportFingerprint: supervisor.tlsIdentity.publicKeyFingerprint,
        },
      },
    )
    await supervisor.activate({
      hostPublicJwk: publicJwk,
      grant,
      descriptor: actualDescriptor,
    })
    registration = await connectSupervisorRelayHost({
      endpoint: { host: '127.0.0.1', port: relay.listeningAddress.port },
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: relay.relayFingerprint,
      },
      expectedRelayId: relay.relayId,
      expectedRelayFingerprint: relay.relayFingerprint,
      rendezvousId: relayDescriptor.rendezvousId,
      rendezvousCapability: relayDescriptor.rendezvousCapability,
      hostTransportFingerprint: relayTransportIdentity.publicKeyFingerprint,
      clientBuildIdentity: 'tablet-interop',
      identity: relayTransportIdentity,
    })
    void registration.completion.catch(() => undefined)
    registration.setChannelHandler(async (offer) => {
      const stream = await offer.accept()
      void supervisor.acceptRelayStream(stream).catch(() => stream.destroy())
    })
    process.stdout.write(
      JSON.stringify({
        hostId: identities.hostId,
        hostFingerprint,
        publicJwk,
        deviceId: identities.deviceId,
        grant,
        descriptor,
        wrongRelayPin,
        accessToken: localToken,
        machineId,
        projectId,
        conversationId,
      }) + '\n',
    )
    process.stdin.resume()
    await new Promise((resolve) => process.stdin.once('end', resolve))
  } finally {
    registration?.close()
    await supervisor.close()
    await relay.close()
    await removeFixtureDirectory(tempParent, root)
  }
}

async function removeFixtureDirectory(tempParent, root) {
  const resolved = await realpath(root)
  if (
    dirname(resolved) !== tempParent ||
    !basename(resolved).startsWith('ct-tablet-interop-')
  ) {
    throw new Error('invalid-fixture-temp-directory')
  }
  await rm(resolved, { recursive: true, force: true })
}

main().catch(() => {
  process.stderr.write('Tablet Supervisor fixture failed.\n')
  process.exitCode = 1
})
