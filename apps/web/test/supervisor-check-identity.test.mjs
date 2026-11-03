import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publicJwkFingerprint,
  resolveExistingProductDevice,
} from '../.tmp/test-dist/runtime/account/control-plane-client.js'

const publicKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'A7T0dcUH_ogrvFrOhMAz3pvG1apa6P8o5MZ4inptuF0',
  y: 'zq8h4AqTMLfkoSG7HFW_x_q8ZfN0bV8jv73k0s8oS5A',
}
const macKey = {
  keyHandle: `CodeTether.ProductDevice.${'b'.repeat(32)}`,
  publicKey,
  keyAlgorithm: 'ES256',
  keyGeneration: 1,
  privateKeyExportable: false,
  protection: 'macOS_secure_enclave_wrapped_key_file_keychain',
}

test('diagnostic existing-only identity discovery neither registers missing keys nor binds a matching Mac key', async () => {
  const fingerprint = await publicJwkFingerprint(publicKey)
  const registered = {
    deviceId: `dev_${'1'.repeat(32)}`,
    ownerUserId: `usr_${'2'.repeat(32)}`,
    deviceType: 'desktop_client',
    keyAlgorithm: 'ES256',
    fingerprint,
    keyGeneration: 1,
    label: 'Owner Desktop',
    platform: 'macOS-arm64',
  }
  const previousFetch = globalThis.fetch
  try {
    for (const [keys, devices, matched] of [
      [[], [], false],
      [[macKey], [], false],
      [[macKey], [registered], true],
    ]) {
      const requests = []
      globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? 'GET' })
        assert.equal(init?.method ?? 'GET', 'GET')
        return new Response(JSON.stringify({ devices }), { status: 200 })
      }
      const noWrite = async () =>
        assert.fail(
          'diagnostics must never register, bind or remove identity material',
        )
      const resolving = resolveExistingProductDevice({
        accessToken: 'test-session',
        baseUrl: 'https://control-plane.example.test',
        existingOnly: true,
        identity: {
          available: true,
          listKeys: async () => keys,
          createKey: noWrite,
          bindDevice: noWrite,
          destroyKey: noWrite,
          readPublic: noWrite,
          sign: noWrite,
        },
      })
      if (matched)
        assert.equal((await resolving).device.deviceId, registered.deviceId)
      else
        await assert.rejects(
          resolving,
          (error) => error.code === 'product_device_not_available',
        )
      assert.deepEqual(requests, [
        { url: 'https://control-plane.example.test/v1/devices', method: 'GET' },
      ])
    }
  } finally {
    globalThis.fetch = previousFetch
  }
})
