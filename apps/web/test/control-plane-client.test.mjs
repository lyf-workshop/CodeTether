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
            safeLabel: 'Owner Windows Host',
            coarsePlatform: 'windows',
            fingerprint: `sha256:${'a'.repeat(43)}`,
            identityGeneration: 1,
            authorization: {
              state: 'authorized',
              authorizationId: `hauth_${'5'.repeat(32)}`,
              scope: 'supervisor_read',
              expiresAt: '2026-10-23T00:00:00.000Z',
            },
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
