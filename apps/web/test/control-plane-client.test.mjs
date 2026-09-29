import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  createDeviceRequestProof,
  listAuthorizedHosts,
  publicJwkFingerprint,
  resolveExistingProductDevice,
} from '../.tmp/test-dist/runtime/account/control-plane-client.js'

const publicKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'A7T0dcUH_ogrvFrOhMAz3pvG1apa6P8o5MZ4inptuF0',
  y: 'zq8h4AqTMLfkoSG7HFW_x_q8ZfN0bV8jv73k0s8oS5A',
}
const key = {
  keyHandle: `CodeTether.ProductDevice.${'a'.repeat(32)}`,
  publicKey,
  keyAlgorithm: 'ES256',
  keyGeneration: 1,
  privateKeyExportable: false,
  protection: 'windows_cng_software_ksp_non_exportable',
}

test('existing ProductDevice discovery matches the server-derived public thumbprint only', async () => {
  const fingerprint = await publicJwkFingerprint(publicKey)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        devices: [
          {
            deviceId: `dev_${'1'.repeat(32)}`,
            ownerUserId: `usr_${'2'.repeat(32)}`,
            deviceType: 'desktop_client',
            keyAlgorithm: 'ES256',
            fingerprint,
            keyGeneration: 1,
            label: 'Owner Desktop',
            platform: 'windows',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  try {
    const resolved = await resolveExistingProductDevice({
      accessToken: 'test-access-token',
      baseUrl: 'https://control-plane.test',
      identity: {
        available: true,
        listKeys: async () => [key],
        bindDevice: async () => undefined,
        readPublic: async () => key,
        sign: async () => assert.fail('device discovery must not sign'),
      },
    })
    assert.equal(resolved.device.deviceId, `dev_${'1'.repeat(32)}`)
    assert.equal(resolved.key.keyHandle, key.keyHandle)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('first Mac ProductDevice enrollment uses the existing challenge and register protocol', async () => {
  const previousFetch = globalThis.fetch
  const createdKey = {
    ...key,
    keyHandle: `CodeTether.ProductDevice.${'b'.repeat(32)}`,
    protection: 'macOS_secure_enclave_wrapped_key_file_keychain',
  }
  const fingerprint = await publicJwkFingerprint(createdKey.publicKey)
  const challenge = {
    v: 1,
    aud: 'codetether-control-plane',
    purpose: 'device_registration',
    challengeId: `enroll_${'1'.repeat(32)}`,
    userId: `usr_${'2'.repeat(32)}`,
    candidateDeviceId: `dev_${'3'.repeat(32)}`,
    publicKeyFingerprint: fingerprint,
    keyAlgorithm: 'ES256',
    deviceType: 'desktop_client',
    label: 'CodeTether Desktop',
    platform: 'macOS-arm64',
    appVersion: '0.1.0-alpha.0',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    iat: 1_795_000_000,
    exp: 1_795_000_300,
    protocolVersion: 1,
  }
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    if (String(input).endsWith('/v1/devices')) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 })
    }
    if (String(input).endsWith('/v1/devices/registration-challenge')) {
      return new Response(
        JSON.stringify({ challenge, publicKeyFingerprint: fingerprint }),
        { status: 201 },
      )
    }
    return new Response(
      JSON.stringify({
        device: {
          deviceId: challenge.candidateDeviceId,
          ownerUserId: challenge.userId,
          deviceType: 'desktop_client',
          keyAlgorithm: 'ES256',
          fingerprint,
          keyGeneration: 1,
          label: challenge.label,
          platform: challenge.platform,
        },
      }),
      { status: 201 },
    )
  }
  let destroyed = false
  try {
    const resolved = await resolveExistingProductDevice({
      accessToken: 'enrollment-token',
      baseUrl: 'https://control-plane.test',
      identity: {
        available: true,
        listKeys: async () => [],
        createKey: async () => createdKey,
        readPublic: async () => createdKey,
        sign: async (keyHandle, payloadBase64Url) => {
          assert.equal(keyHandle, createdKey.keyHandle)
          assert.ok(payloadBase64Url.length > 0)
          return {
            keyAlgorithm: 'ES256',
            signatureBase64Url: Buffer.alloc(64, 8).toString('base64url'),
          }
        },
        bindDevice: async () => undefined,
        destroyKey: async () => {
          destroyed = true
        },
      },
    })
    assert.equal(resolved.device.deviceId, challenge.candidateDeviceId)
    assert.equal(resolved.key.keyHandle, createdKey.keyHandle)
    assert.equal(destroyed, false)
    assert.equal(calls.length, 3)
    assert.equal(calls[1].init.method, 'POST')
    assert.equal(calls[2].init.method, 'POST')
    const completionBody = JSON.parse(
      new TextDecoder().decode(calls[2].init.body),
    )
    assert.match(completionBody.proof, /^[^.]+\.[^.]+\.[^.]+$/u)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('failed first enrollment destroys only the newly-created local key', async () => {
  const previousFetch = globalThis.fetch
  const createdKey = {
    ...key,
    keyHandle: `CodeTether.ProductDevice.${'c'.repeat(32)}`,
  }
  let destroyedHandle
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/v1/devices')) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 })
    }
    return new Response(
      JSON.stringify({ code: 'device_registration_challenge_invalid' }),
      { status: 400 },
    )
  }
  try {
    await assert.rejects(
      resolveExistingProductDevice({
        accessToken: 'enrollment-token',
        baseUrl: 'https://control-plane.test',
        identity: {
          available: true,
          listKeys: async () => [],
          createKey: async () => createdKey,
          readPublic: async () => createdKey,
          sign: async () =>
            assert.fail('sign must not run when challenge fails'),
          destroyKey: async (handle) => {
            destroyedHandle = handle
          },
        },
      }),
      (error) => error.code === 'device_registration_challenge_invalid',
    )
    assert.equal(destroyedHandle, createdKey.keyHandle)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('unmatched orphaned Mac key is reused for first enrollment', async () => {
  const previousFetch = globalThis.fetch
  const orphanedKey = {
    ...key,
    keyHandle: `CodeTether.ProductDevice.${'d'.repeat(32)}`,
    protection: 'macOS_secure_enclave_wrapped_key_file_keychain',
  }
  const fingerprint = await publicJwkFingerprint(orphanedKey.publicKey)
  const challenge = {
    v: 1,
    aud: 'codetether-control-plane',
    purpose: 'device_registration',
    challengeId: `enroll_${'4'.repeat(32)}`,
    userId: `usr_${'5'.repeat(32)}`,
    candidateDeviceId: `dev_${'6'.repeat(32)}`,
    publicKeyFingerprint: fingerprint,
    keyAlgorithm: 'ES256',
    deviceType: 'desktop_client',
    label: 'CodeTether Desktop',
    platform: 'macOS-arm64',
    appVersion: '0.1.0-alpha.0',
    nonce: 'BBBBBBBBBBBBBBBBBBBBBB',
    iat: 1_795_000_000,
    exp: 1_795_000_300,
    protocolVersion: 1,
  }
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/v1/devices')) {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 })
    }
    if (String(input).endsWith('/v1/devices/registration-challenge')) {
      return new Response(
        JSON.stringify({ challenge, publicKeyFingerprint: fingerprint }),
        { status: 201 },
      )
    }
    return new Response(
      JSON.stringify({
        device: {
          deviceId: challenge.candidateDeviceId,
          ownerUserId: challenge.userId,
          deviceType: 'desktop_client',
          keyAlgorithm: 'ES256',
          fingerprint,
          keyGeneration: 1,
          label: challenge.label,
          platform: challenge.platform,
        },
      }),
      { status: 201 },
    )
  }
  let createCalled = false
  let destroyed = false
  try {
    const resolved = await resolveExistingProductDevice({
      accessToken: 'enrollment-token',
      baseUrl: 'https://control-plane.test',
      identity: {
        available: true,
        listKeys: async () => [orphanedKey],
        createKey: async () => {
          createCalled = true
          return orphanedKey
        },
        readPublic: async () => orphanedKey,
        sign: async () => ({
          keyAlgorithm: 'ES256',
          signatureBase64Url: Buffer.alloc(64, 9).toString('base64url'),
        }),
        bindDevice: async () => undefined,
        destroyKey: async () => {
          destroyed = true
        },
      },
    })
    assert.equal(resolved.device.deviceId, challenge.candidateDeviceId)
    assert.equal(resolved.key.keyHandle, orphanedKey.keyHandle)
    assert.equal(createCalled, false)
    assert.equal(destroyed, false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('device proof binds the exact human token, method, resource, body, and existing key', async () => {
  let signedPayload
  const accessToken = 'private-test-token-never-in-payload'
  const proof = await createDeviceRequestProof({
    accessToken,
    deviceId: `dev_${'3'.repeat(32)}`,
    keyGeneration: 1,
    keyHandle: key.keyHandle,
    identity: {
      available: true,
      listKeys: async () => [key],
      bindDevice: async () => undefined,
      readPublic: async () => key,
      async sign(keyHandle, payloadBase64Url) {
        assert.equal(keyHandle, key.keyHandle)
        signedPayload = Buffer.from(payloadBase64Url, 'base64url').toString(
          'utf8',
        )
        return {
          keyAlgorithm: 'ES256',
          signatureBase64Url: Buffer.alloc(64, 7).toString('base64url'),
        }
      },
    },
    method: 'GET',
    resource: '/v1/hosts/directory',
  })
  const [protectedHeader, encodedPayload, signature] = proof.split('.')
  assert.equal(signedPayload, `${protectedHeader}.${encodedPayload}`)
  assert.deepEqual(JSON.parse(Buffer.from(protectedHeader, 'base64url')), {
    alg: 'ES256',
    typ: 'codetether-device-proof+jws',
  })
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url'))
  assert.equal(payload.method, 'GET')
  assert.equal(payload.resource, '/v1/hosts/directory')
  assert.equal(
    payload.authTokenHash,
    `sha256:${createHash('sha256').update(accessToken).digest('base64url')}`,
  )
  assert.equal(
    payload.bodySha256,
    'sha256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
  )
  assert.equal(JSON.stringify(payload).includes(accessToken), false)
  assert.equal(Buffer.from(signature, 'base64url').length, 64)
})

test('authorized Host directory sends the exact device proof and admits only bounded metadata', async () => {
  const previousFetch = globalThis.fetch
  let request
  globalThis.fetch = async (input, init) => {
    request = { input, init }
    return new Response(
      JSON.stringify({
        hosts: [
          {
            hostId: `host_${'4'.repeat(32)}`,
            spaceId: `space_${'6'.repeat(32)}`,
            safeLabel: 'Owner Windows Host',
            coarsePlatform: 'windows',
            fingerprint: `sha256:${'a'.repeat(43)}`,
            identityGeneration: 1,
            publicKey,
            authorization: {
              state: 'authorized',
              authorizationId: `hauth_${'5'.repeat(32)}`,
              scope: 'supervisor_read',
              expiresAt: '2026-10-23T00:00:00.000Z',
              issuedAt: '2026-09-23T00:00:00.000Z',
              serial: '1',
              generation: 1,
            },
            supervisor: null,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const hosts = await listAuthorizedHosts({
      accessToken: 'directory-access-token',
      baseUrl: 'https://control-plane.test',
      identity: {
        available: true,
        listKeys: async () => [key],
        bindDevice: async () => undefined,
        readPublic: async () => key,
        sign: async () => ({
          keyAlgorithm: 'ES256',
          signatureBase64Url: Buffer.alloc(64, 9).toString('base64url'),
        }),
      },
      productDevice: {
        key,
        device: {
          deviceId: `dev_${'3'.repeat(32)}`,
          ownerUserId: `usr_${'2'.repeat(32)}`,
          deviceType: 'desktop_client',
          keyAlgorithm: 'ES256',
          fingerprint: await publicJwkFingerprint(publicKey),
          keyGeneration: 1,
          label: 'Owner Desktop',
          platform: 'windows',
        },
      },
    })
    assert.equal(hosts.length, 1)
    assert.equal(hosts[0].hostId, `host_${'4'.repeat(32)}`)
    assert.equal(request.input, 'https://control-plane.test/v1/hosts/directory')
    assert.equal(
      request.init.headers.authorization,
      'Bearer directory-access-token',
    )
    assert.match(
      request.init.headers['x-codetether-device-proof'],
      /^[^.]+\.[^.]+\.[^.]+$/u,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})
