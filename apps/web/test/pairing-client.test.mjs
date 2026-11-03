import assert from 'node:assert/strict'
import test from 'node:test'

import {
  finishPairingSession,
  listPairedDevices,
  removePairedDevice,
} from '../.tmp/test-dist/runtime/account/pairing-client.js'
import { runOwnerPairing } from '../.tmp/test-dist/runtime/account/pairing-flow.js'

const signature = {
  keyAlgorithm: 'ES256',
  signatureBase64Url: 'test_signature',
}
const fingerprint = `sha256:${'f'.repeat(43)}`
const device = {
  deviceId: 'dev_phone',
  label: 'vivo X60',
  platform: 'Android',
  authorizationId: 'hauth_current',
  pairingRootAuthorizationId: 'hauth_initial',
  lastUsedAt: null,
  expiresAt: '2026-12-01T00:00:00Z',
  status: 'active',
  renewalEligible: false,
}

function owner(sign = async () => signature) {
  return {
    session: { access_token: 'fixture-token' },
    controlPlaneBaseUrl: 'https://control-plane.test',
    productDevice: {
      device: {
        deviceId: 'dev_owner',
        ownerUserId: 'usr_owner',
        keyGeneration: 1,
      },
      key: { keyHandle: 'device-key' },
    },
    deviceIdentity: { sign: async () => signature },
    host: {
      hostId: 'host_pc',
      spaceId: 'space_personal',
      fingerprint,
      identityGeneration: 1,
    },
    localIdentity: { keyHandle: 'host-key' },
    hostIdentity: { sign },
  }
}

function claimed(sessionId) {
  const iat = Math.floor(Date.now() / 1_000)
  return {
    status: 'claimed',
    sessionId,
    hostId: 'host_pc',
    expiresAt: new Date((iat + 300) * 1_000).toISOString(),
    device: {
      deviceId: device.deviceId,
      label: device.label,
      platform: device.platform,
    },
    payload: {
      v: 1,
      aud: 'codetether-control-plane-host',
      purpose: 'host_device_authorization',
      authorizationId: device.authorizationId,
      challengeId: sessionId,
      hostId: 'host_pc',
      hostFingerprint: fingerprint,
      hostIdentityGeneration: 1,
      spaceId: 'space_personal',
      userId: 'usr_owner',
      deviceId: device.deviceId,
      deviceFingerprint: fingerprint,
      deviceKeyGeneration: 1,
      scope: 'supervisor_control',
      nonce: 'A'.repeat(43),
      iat,
      exp: iat + 300,
      authorizationExpiresAt: iat + 2_592_000,
    },
  }
}

function body(init) {
  return JSON.parse(
    typeof init.body === 'string'
      ? init.body
      : new TextDecoder().decode(init.body),
  )
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

test('Host authorization signs only the exact current device, Host and pairing session', async () => {
  const previous = globalThis.fetch
  const session = claimed('enroll_claimed')
  let signed = 0
  const context = owner(async (key, input) => {
    signed++
    assert.equal(key, 'host-key')
    const [header, payload] = Buffer.from(input, 'base64url')
      .toString('utf8')
      .split('.')
    assert.deepEqual(decode(header), {
      alg: 'ES256',
      typ: 'codetether-host-device-authorization+jws',
    })
    assert.deepEqual(decode(payload), session.payload)
    return signature
  })
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      'https://control-plane.test/v1/hosts/host_pc/pairing-sessions/enroll_claimed/finish',
    )
    assert.deepEqual(body(init).payload, session.payload)
    return Response.json({
      status: 'paired',
      sessionId: session.sessionId,
      hostId: session.hostId,
      expiresAt: session.expiresAt,
      authorization: {
        authorizationId: device.authorizationId,
        hostId: session.hostId,
        hostIdentityGeneration: 1,
        deviceId: device.deviceId,
        deviceFingerprint: fingerprint,
        deviceKeyGeneration: 1,
        userId: 'usr_owner',
        spaceId: 'space_personal',
        scope: 'supervisor_control',
        serial: '1',
        generation: 1,
        issuedAt: new Date().toISOString(),
        expiresAt: device.expiresAt,
        grant: null,
      },
    })
  }
  try {
    for (const payload of [
      { ...session.payload, scope: 'supervisor_read' },
      { ...session.payload, challengeId: 'enroll_other' },
      { ...session.payload, hostId: 'host_other' },
      { ...session.payload, deviceId: 'dev_other' },
    ]) {
      await assert.rejects(
        finishPairingSession(context, { ...session, payload }),
        { code: 'pairing_response_invalid' },
      )
    }
    assert.equal(signed, 0)
    assert.equal(
      (await finishPairingSession(context, session)).status,
      'paired',
    )
    assert.equal(signed, 1)
  } finally {
    globalThis.fetch = previous
  }
})

test('closing during a late pairing status cancels that code without authorizing it', async () => {
  const previous = globalThis.fetch
  const controller = new AbortController()
  const calls = []
  let session
  const context = owner(async (_key, input) => {
    const [, payload] = Buffer.from(input, 'base64url')
      .toString('utf8')
      .split('.')
    calls.push(decode(payload).purpose)
    return signature
  })
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/pairing-sessions')) {
      session = claimed(body(init).payload.subjectId)
      return Response.json({ ...session, status: 'pending', code: '012345' })
    }
    if (path.endsWith('/status')) {
      controller.abort()
      return Response.json(session)
    }
    assert.ok(path.endsWith(`/${session.sessionId}/cancel`))
    assert.equal(body(init).payload.subjectId, session.sessionId)
    return Response.json({ ...session, status: 'cancelled' })
  }
  try {
    const progress = []
    await assert.rejects(
      runOwnerPairing(context, controller.signal, (next) =>
        progress.push(next.status),
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(progress, ['pending'])
    assert.deepEqual(calls, [
      'host_pairing_create',
      'host_pairing_status',
      'host_pairing_cancel',
    ])
  } finally {
    globalThis.fetch = previous
  }
})

test('removal uses the same Host-signed lineage proof locally before calling Control Plane', async () => {
  const previous = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    requests.push({ path, data: body(init) })
    return Response.json(
      path.endsWith('/disable')
        ? { status: 'disabled' }
        : { status: 'revoked', deviceId: device.deviceId },
    )
  }
  try {
    await removePairedDevice(owner(), device)
    assert.deepEqual(
      requests.map(({ path }) => path),
      [
        '/api/v1/supervisor/devices/disable',
        '/v1/hosts/host_pc/paired-devices/dev_phone/revoke',
      ],
    )
    assert.deepEqual(requests[0].data, requests[1].data)
    assert.equal(requests[0].data.payload.subjectId, device.authorizationId)
    assert.equal(requests[0].data.payload.targetDeviceId, device.deviceId)
    assert.equal(
      requests[0].data.payload.pairingRootAuthorizationId,
      device.pairingRootAuthorizationId,
    )
    globalThis.fetch = async (url) => {
      assert.ok(String(url).endsWith('/disable'))
      return new Response(null, { status: 500 })
    }
    await assert.rejects(removePairedDevice(owner(), device), {
      code: 'pairing_disconnect_failed',
    })
  } finally {
    globalThis.fetch = previous
  }
})

test('paired list retains expired rows and exposes only safe metadata plus revocation coordinates', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({
      devices: [
        {
          ...device,
          scope: 'supervisor_control',
          status: 'expired',
          privateValue: 'must not project',
        },
      ],
    })
  try {
    assert.deepEqual(await listPairedDevices(owner()), [
      { ...device, status: 'expired' },
    ])
  } finally {
    globalThis.fetch = previous
  }
})
