import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import {
  CompactSign,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose'
import {
  AuthenticatedAccountService,
  PRODUCT_DEVICE_AUDIENCE,
  PRODUCT_DEVICE_PROOF_TYPE,
  PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
  ProductDeviceAuthFailure,
  ProductDeviceAuthenticationService,
  admitProductDevicePublicJwk,
  canonicalizeDeviceRequestResource,
  encodeDeviceRequestProofPayload,
  encodeRegistrationChallengePayload,
  runMigrations,
  sha256Digest,
  startControlPlaneServer,
} from '../dist/index.js'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const token = 'phase9a4-test-access-token'
const tokenHash = sha256Digest(token)
const fixedStart = new Date('2026-09-21T12:00:00.000Z')
let clock = fixedStart
let database
let accountService
let deviceService
let human
let keyPair
let publicJwk
let registeredDevice

const verifiedHuman = (subject = 'phase9a4-user') => ({
  issuer: 'https://auth.phase9a4.test/auth/v1',
  subject,
  externalSessionIdHash: sha256Digest('phase9a4-external-session-reference'),
  expiresAt: new Date('2026-09-21T18:00:00.000Z'),
  verifiedNormalizedEmail: `${subject}@example.test`,
})

async function signRegistration(challenge, privateKey = keyPair.privateKey) {
  return new CompactSign(encodeRegistrationChallengePayload(challenge))
    .setProtectedHeader({
      alg: 'ES256',
      typ: PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
    })
    .sign(privateKey)
}

async function createSignedRequest({
  device = registeredDevice,
  privateKey = keyPair.privateKey,
  method = 'GET',
  rawResource = '/v1/device/me',
  body = Buffer.alloc(0),
  authTokenHash = tokenHash,
  nonce = 'AAAAAAAAAAAAAAAAAAAAAA',
  iat = Math.floor(clock.getTime() / 1_000),
  overrides = {},
} = {}) {
  const payload = {
    v: 1,
    aud: PRODUCT_DEVICE_AUDIENCE,
    authTokenHash,
    deviceId: device.deviceId,
    keyGeneration: device.keyGeneration,
    method,
    resource: canonicalizeDeviceRequestResource(rawResource),
    bodySha256: sha256Digest(body),
    nonce,
    iat,
    protocolVersion: 1,
    ...overrides,
  }
  const proof = await new CompactSign(encodeDeviceRequestProofPayload(payload))
    .setProtectedHeader({ alg: 'ES256', typ: PRODUCT_DEVICE_PROOF_TYPE })
    .sign(privateKey)
  return { payload, proof, body, method, rawResource }
}

async function expectDeviceFailure(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ProductDeviceAuthFailure, true)
    assert.equal(error.code, code)
    return true
  })
}

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  accountService = new AuthenticatedAccountService(database, () => clock)
  deviceService = new ProductDeviceAuthenticationService(database, () => clock)
  const account = await accountService.resolveVerifiedHuman(verifiedHuman())
  human = {
    ...account,
    authTokenHash: tokenHash,
  }
  keyPair = await generateKeyPair('ES256', { extractable: true })
  publicJwk = await exportJWK(keyPair.publicKey)
})

after(async () => {
  await database.close()
})

test('ES256 admission rejects private JWKs and derives the RFC 7638 fingerprint', async () => {
  const admitted = await admitProductDevicePublicJwk(publicJwk)
  assert.equal(
    admitted.fingerprint,
    `sha256:${await calculateJwkThumbprint(publicJwk)}`,
  )
  assert.deepEqual(JSON.parse(admitted.canonicalPublicJwk), {
    crv: 'P-256',
    kty: 'EC',
    x: publicJwk.x,
    y: publicJwk.y,
  })
  await assert.rejects(
    admitProductDevicePublicJwk({
      ...publicJwk,
      d: 'private-material-rejected',
    }),
  )

  const vector = {
    kty: 'EC',
    crv: 'P-256',
    x: 'A7T0dcUH_ogrvFrOhMAz3pvG1apa6P8o5MZ4inptuF0',
    y: 'Xcn51LcKveeskJbKUieNjF_A-XFGWeLH3_LsAMxG6yc',
  }
  assert.equal(
    (await admitProductDevicePublicJwk(vector)).fingerprint,
    'sha256:7uvScnMyM8pNeApfnzg40HqUK2TwvKtf09xV94wLfSw',
  )

  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const finalIndex = alphabet.indexOf(vector.x.at(-1))
  const noncanonicalX = `${vector.x.slice(0, -1)}${alphabet[finalIndex + 1]}`
  assert.deepEqual(
    Buffer.from(noncanonicalX, 'base64url'),
    Buffer.from(vector.x, 'base64url'),
  )
  await assert.rejects(
    admitProductDevicePublicJwk({ ...vector, x: noncanonicalX }),
  )
})

test('registration rejects every algorithm outside the ES256 allowlist', async () => {
  await expectDeviceFailure(
    deviceService.createRegistrationChallenge(human, {
      publicKey: publicJwk,
      keyAlgorithm: 'RS256',
      deviceType: 'desktop_client',
      label: 'Unsupported algorithm',
      platform: 'windows',
      appVersion: '0.1.0-test',
      protocolVersion: 1,
    }),
    'device_algorithm_unsupported',
  )
})

test('canonical request vectors bind path, sorted unique query, and exact body bytes', () => {
  assert.equal(
    canonicalizeDeviceRequestResource('/v1/device/me?z=%7E&a=hello%20world'),
    '/v1/device/me?a=hello%20world&z=~',
  )
  assert.equal(
    sha256Digest(Buffer.alloc(0)),
    'sha256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
  )
  assert.throws(() => canonicalizeDeviceRequestResource('/a?x=1&x=2'))
  assert.throws(() => canonicalizeDeviceRequestResource('/a?%78=1&x=2'))
  assert.throws(() => canonicalizeDeviceRequestResource('/a/../b'))
  assert.throws(() => canonicalizeDeviceRequestResource('/a/%2e%2e/b'))
  assert.throws(() => canonicalizeDeviceRequestResource('/a/%2f/b'))
  assert.throws(() => canonicalizeDeviceRequestResource('/a?q=a+b'))
  assert.throws(() => canonicalizeDeviceRequestResource('//authority/path'))
  assert.equal(
    canonicalizeDeviceRequestResource('/a?b=1&a=2&A=3'),
    '/a?A=3&a=2&b=1',
  )
})

test('request proof payload has one deterministic constrained RFC 8785 vector', () => {
  const encoded = encodeDeviceRequestProofPayload({
    v: 1,
    aud: PRODUCT_DEVICE_AUDIENCE,
    authTokenHash: tokenHash,
    deviceId: 'dev_1234567890abcdef',
    keyGeneration: 1,
    method: 'POST',
    resource: '/v1/device/me?a=1&z=2',
    bodySha256: sha256Digest(Buffer.from('{"a":1}')),
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    iat: 1_795_000_000,
    protocolVersion: 1,
  })
  assert.equal(
    Buffer.from(encoded).toString('utf8'),
    '{"aud":"codetether-control-plane","authTokenHash":"sha256:roV8bDoHT2U5tb7WQbC71KNei_cqgw28sYbodqX41_s","bodySha256":"sha256:AVq9f1zFei3ZS3WQ8ErYCEJzkF7jPsXOvq5iJ2qX-GI","deviceId":"dev_1234567890abcdef","iat":1795000000,"keyGeneration":1,"method":"POST","nonce":"AAAAAAAAAAAAAAAAAAAAAA","protocolVersion":1,"resource":"/v1/device/me?a=1&z=2","v":1}',
  )
})

test('registration requires human identity plus exact candidate-key possession', async () => {
  const issued = await deviceService.createRegistrationChallenge(human, {
    publicKey: publicJwk,
    keyAlgorithm: 'ES256',
    deviceType: 'desktop_client',
    label: 'Owner Windows device',
    platform: 'windows',
    appVersion: '0.1.0-alpha.0',
    protocolVersion: 1,
  })
  assert.equal(issued.challenge.userId, human.userId)
  assert.equal(issued.challenge.aud, PRODUCT_DEVICE_AUDIENCE)

  const wrongKey = await generateKeyPair('ES256')
  await expectDeviceFailure(
    deviceService.registerProductDevice(human, {
      challenge: issued.challenge,
      proof: await signRegistration(issued.challenge, wrongKey.privateKey),
    }),
    'device_signature_invalid',
  )

  registeredDevice = await deviceService.registerProductDevice(human, {
    challenge: issued.challenge,
    proof: await signRegistration(issued.challenge),
  })
  assert.match(registeredDevice.deviceId, /^dev_/)
  assert.equal(registeredDevice.ownerUserId, human.userId)
  assert.equal(registeredDevice.keyAlgorithm, 'ES256')
  assert.equal(registeredDevice.keyGeneration, 1)

  await expectDeviceFailure(
    deviceService.registerProductDevice(human, {
      challenge: issued.challenge,
      proof: await signRegistration(issued.challenge),
    }),
    'device_registration_challenge_consumed',
  )
})

test('expired registration challenge fails without creating a ProductDevice', async () => {
  const another = await generateKeyPair('ES256', { extractable: true })
  const anotherPublic = await exportJWK(another.publicKey)
  const issued = await deviceService.createRegistrationChallenge(human, {
    publicKey: anotherPublic,
    keyAlgorithm: 'ES256',
    deviceType: 'mobile',
    label: 'Expired candidate',
    platform: 'ios',
    appVersion: '0.1.0-test',
    protocolVersion: 1,
  })
  clock = new Date((issued.challenge.exp + 1) * 1_000)
  await expectDeviceFailure(
    deviceService.registerProductDevice(human, {
      challenge: issued.challenge,
      proof: await signRegistration(issued.challenge, another.privateKey),
    }),
    'device_registration_challenge_expired',
  )
  assert.equal(
    await deviceService.readProductDevice(issued.challenge.candidateDeviceId),
    null,
  )
  clock = fixedStart
})

test('registration challenge issuance is transactionally rate-limit-ready', async () => {
  const rateAccount = await accountService.resolveVerifiedHuman(
    verifiedHuman('phase9a4-rate-limit-user'),
  )
  const rateHuman = {
    ...rateAccount,
    authTokenHash: tokenHash,
  }
  const candidates = []
  for (let index = 0; index < 6; index += 1) {
    const pair = await generateKeyPair('ES256', { extractable: true })
    candidates.push({
      publicKey: await exportJWK(pair.publicKey),
      keyAlgorithm: 'ES256',
      deviceType: 'desktop_client',
      label: `Bounded candidate ${index}`,
      platform: 'windows',
      appVersion: '0.1.0-test',
      protocolVersion: 1,
    })
  }

  const concurrent = await Promise.allSettled([
    deviceService.createRegistrationChallenge(rateHuman, candidates[0]),
    new ProductDeviceAuthenticationService(
      database,
      () => clock,
    ).createRegistrationChallenge(rateHuman, candidates[0]),
  ])
  assert.equal(
    concurrent.filter(({ status }) => status === 'fulfilled').length,
    1,
  )
  assert.equal(
    concurrent.find(({ status }) => status === 'rejected').reason.code,
    'device_registration_challenge_invalid',
  )
  for (const candidate of candidates.slice(1, 5)) {
    await deviceService.createRegistrationChallenge(rateHuman, candidate)
  }
  await expectDeviceFailure(
    deviceService.createRegistrationChallenge(rateHuman, candidates[5]),
    'device_registration_challenge_invalid',
  )
})

test('valid device request binds human token, owner, method, resource, body, and generation', async () => {
  const signed = await createSignedRequest({
    rawResource: '/v1/device/me?z=2&a=1',
    nonce: 'BBBBBBBBBBBBBBBBBBBBBB',
  })
  const context = await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: signed.proof,
    method: signed.method,
    rawResource: signed.rawResource,
    body: signed.body,
  })
  assert.deepEqual(context, {
    userId: human.userId,
    deviceId: registeredDevice.deviceId,
    deviceType: 'desktop_client',
    keyGeneration: 1,
  })

  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: undefined,
      method: 'GET',
      rawResource: '/v1/device/me',
      body: Buffer.alloc(0),
    }),
    'device_auth_required',
  )
})

test('device proof rejects every detached request dimension', async () => {
  const cases = [
    ['device_proof_method_mismatch', { method: 'POST' }, { method: 'GET' }],
    ['device_proof_method_mismatch', {}, { method: 'get' }],
    [
      'device_proof_resource_mismatch',
      { rawResource: '/v1/device/me?x=1' },
      { rawResource: '/v1/device/me?x=2' },
    ],
    [
      'device_proof_body_mismatch',
      { body: Buffer.from('one') },
      { body: Buffer.from('two') },
    ],
    [
      'device_proof_token_binding_mismatch',
      { authTokenHash: sha256Digest('different-token') },
      {},
    ],
  ]
  let counter = 0
  for (const [code, proofInput, requestInput] of cases) {
    counter += 1
    const signed = await createSignedRequest({
      nonce: Buffer.alloc(16, counter).toString('base64url'),
      ...proofInput,
    })
    await expectDeviceFailure(
      deviceService.authenticateProductDeviceRequest(human, {
        compactProof: signed.proof,
        method: requestInput.method ?? signed.method,
        rawResource: requestInput.rawResource ?? signed.rawResource,
        body: requestInput.body ?? signed.body,
      }),
      code,
    )
  }
})

test('device proof rejects invalid signature, stale/future time, and stale generation', async () => {
  const wrongKey = await generateKeyPair('ES256')
  const badSignature = await createSignedRequest({
    privateKey: wrongKey.privateKey,
    nonce: 'CCCCCCCCCCCCCCCCCCCCCC',
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: badSignature.proof,
      method: badSignature.method,
      rawResource: badSignature.rawResource,
      body: badSignature.body,
    }),
    'device_signature_invalid',
  )

  for (const [code, iat, nonce] of [
    [
      'device_proof_expired',
      Math.floor(clock.getTime() / 1_000) - 121,
      'DDDDDDDDDDDDDDDDDDDDDD',
    ],
    [
      'device_proof_future',
      Math.floor(clock.getTime() / 1_000) + 121,
      'EEEEEEEEEEEEEEEEEEEEEE',
    ],
  ]) {
    const signed = await createSignedRequest({ iat, nonce })
    await expectDeviceFailure(
      deviceService.authenticateProductDeviceRequest(human, {
        compactProof: signed.proof,
        method: signed.method,
        rawResource: signed.rawResource,
        body: signed.body,
      }),
      code,
    )
  }

  const stale = await createSignedRequest({
    nonce: 'FFFFFFFFFFFFFFFFFFFFFF',
    overrides: { keyGeneration: 2 },
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: stale.proof,
      method: stale.method,
      rawResource: stale.rawResource,
      body: stale.body,
    }),
    'device_key_generation_stale',
  )
})

test('device proof rejects wrong audience and unsupported proof/protocol versions', async () => {
  for (const [code, overrides, nonce] of [
    [
      'device_proof_audience_mismatch',
      { aud: 'another-audience' },
      'MMMMMMMMMMMMMMMMMMMMMM',
    ],
    ['device_proof_version_unsupported', { v: 2 }, 'NNNNNNNNNNNNNNNNNNNNNN'],
    [
      'device_proof_version_unsupported',
      { protocolVersion: 2 },
      'OOOOOOOOOOOOOOOOOOOOOO',
    ],
  ]) {
    const ordinary = await createSignedRequest({ nonce })
    const payload = { ...ordinary.payload, ...overrides }
    const canonical = Object.fromEntries(Object.entries(payload).sort())
    const proof = await new CompactSign(Buffer.from(JSON.stringify(canonical)))
      .setProtectedHeader({ alg: 'ES256', typ: PRODUCT_DEVICE_PROOF_TYPE })
      .sign(keyPair.privateKey)
    await expectDeviceFailure(
      deviceService.authenticateProductDeviceRequest(human, {
        compactProof: proof,
        method: ordinary.method,
        rawResource: ordinary.rawResource,
        body: ordinary.body,
      }),
      code,
    )
  }
})

test('cross-user device substitution is rejected before token detachment can authenticate', async () => {
  const otherAccount = await accountService.resolveVerifiedHuman(
    verifiedHuman('phase9a4-other-user'),
  )
  const otherHuman = {
    ...otherAccount,
    authTokenHash: tokenHash,
  }
  const signed = await createSignedRequest({
    nonce: 'GGGGGGGGGGGGGGGGGGGGGG',
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(otherHuman, {
      compactProof: signed.proof,
      method: signed.method,
      rawResource: signed.rawResource,
      body: signed.body,
    }),
    'device_owner_mismatch',
  )
})

test('PostgreSQL replay reservation is atomic across concurrent service instances', async () => {
  const signed = await createSignedRequest({
    nonce: 'HHHHHHHHHHHHHHHHHHHHHH',
  })
  const secondInstance = new ProductDeviceAuthenticationService(
    database,
    () => clock,
  )
  const results = await Promise.allSettled([
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: signed.proof,
      method: signed.method,
      rawResource: signed.rawResource,
      body: signed.body,
    }),
    secondInstance.authenticateProductDeviceRequest(human, {
      compactProof: signed.proof,
      method: signed.method,
      rawResource: signed.rawResource,
      body: signed.body,
    }),
  ])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  const rejected = results.find(({ status }) => status === 'rejected')
  assert.equal(rejected.reason.code, 'device_proof_replayed')

  await expectDeviceFailure(
    secondInstance.authenticateProductDeviceRequest(human, {
      compactProof: signed.proof,
      method: signed.method,
      rawResource: signed.rawResource,
      body: signed.body,
    }),
    'device_proof_replayed',
  )
})

test('nonce uniqueness cannot be partitioned by human-token replacement', async () => {
  const nonce = 'QQQQQQQQQQQQQQQQQQQQQQ'
  const first = await createSignedRequest({ nonce })
  await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: first.proof,
    method: first.method,
    rawResource: first.rawResource,
    body: first.body,
  })

  const replacementTokenHash = sha256Digest('replacement-human-token')
  const replacementHuman = {
    ...human,
    authTokenHash: replacementTokenHash,
  }
  const replacement = await createSignedRequest({
    nonce,
    authTokenHash: replacementTokenHash,
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(replacementHuman, {
      compactProof: replacement.proof,
      method: replacement.method,
      rawResource: replacement.rawResource,
      body: replacement.body,
    }),
    'device_proof_replayed',
  )
})

test('key generation can advance while old replay records remain authoritative', async () => {
  const rotatingKey = await generateKeyPair('ES256', { extractable: true })
  const issued = await deviceService.createRegistrationChallenge(human, {
    publicKey: await exportJWK(rotatingKey.publicKey),
    keyAlgorithm: 'ES256',
    deviceType: 'desktop_client',
    label: 'Rotation boundary fixture',
    platform: 'windows',
    appVersion: '0.1.0-test',
    protocolVersion: 1,
  })
  const rotationDevice = await deviceService.registerProductDevice(human, {
    challenge: issued.challenge,
    proof: await signRegistration(issued.challenge, rotatingKey.privateKey),
  })
  const oldGeneration = await createSignedRequest({
    device: rotationDevice,
    privateKey: rotatingKey.privateKey,
    nonce: 'RRRRRRRRRRRRRRRRRRRRRR',
  })
  await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: oldGeneration.proof,
    method: oldGeneration.method,
    rawResource: oldGeneration.rawResource,
    body: oldGeneration.body,
  })

  await database.query(
    `UPDATE control_plane.product_devices
        SET key_generation = 2
      WHERE device_id = $1`,
    [rotationDevice.deviceId],
  )
  const stale = await createSignedRequest({
    device: rotationDevice,
    privateKey: rotatingKey.privateKey,
    nonce: 'SSSSSSSSSSSSSSSSSSSSSS',
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: stale.proof,
      method: stale.method,
      rawResource: stale.rawResource,
      body: stale.body,
    }),
    'device_key_generation_stale',
  )

  const current = await createSignedRequest({
    device: { ...rotationDevice, keyGeneration: 2 },
    privateKey: rotatingKey.privateKey,
    nonce: 'TTTTTTTTTTTTTTTTTTTTTT',
  })
  const context = await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: current.proof,
    method: current.method,
    rawResource: current.rawResource,
    body: current.body,
  })
  assert.equal(context.keyGeneration, 2)
})

test('replay-store failure fails closed and nonce cleanup preserves unexpired records', async () => {
  const signed = await createSignedRequest({
    nonce: 'IIIIIIIIIIIIIIIIIIIIII',
  })
  const failingDatabase = {
    query: (...args) => database.query(...args),
    exec: (...args) => database.exec(...args),
    close: async () => {},
    transaction: (operation) =>
      database.transaction((transaction) =>
        operation({
          ...transaction,
          query(sql, parameters) {
            if (sql.includes('device_request_nonces')) {
              throw new Error('simulated replay authority outage')
            }
            return transaction.query(sql, parameters)
          },
          exec: (sql) => transaction.exec(sql),
        }),
      ),
  }
  const failingService = new ProductDeviceAuthenticationService(
    failingDatabase,
    () => clock,
  )
  await expectDeviceFailure(
    failingService.authenticateProductDeviceRequest(human, {
      compactProof: signed.proof,
      method: signed.method,
      rawResource: signed.rawResource,
      body: signed.body,
    }),
    'device_auth_unavailable',
  )

  const unexpired = await createSignedRequest({
    nonce: 'PPPPPPPPPPPPPPPPPPPPPP',
  })
  await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: unexpired.proof,
    method: unexpired.method,
    rawResource: unexpired.rawResource,
    body: unexpired.body,
  })
  assert.equal(await deviceService.cleanupExpiredReplayState(100), 0)
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: unexpired.proof,
      method: unexpired.method,
      rawResource: unexpired.rawResource,
      body: unexpired.body,
    }),
    'device_proof_replayed',
  )
  clock = new Date(clock.getTime() + 3 * 60 * 1_000)
  assert.equal((await deviceService.cleanupExpiredReplayState(100)) > 0, true)
  clock = fixedStart
})

test('minimal HTTP boundary keeps account human-only and device route dual-bound', async () => {
  const verifier = {
    async verifyAccessToken(value) {
      assert.equal(value, token)
      return verifiedHuman()
    },
  }
  const running = await startControlPlaneServer({
    database,
    humanAuthVerifier: verifier,
    authenticatedAccountService: accountService,
    productDeviceAuthenticationService: deviceService,
    host: '127.0.0.1',
    port: 0,
  })
  try {
    const origin = `http://127.0.0.1:${running.address.port}`
    const accountResponse = await fetch(`${origin}/v1/account/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(accountResponse.status, 200)
    assert.equal(
      (await accountResponse.json()).deviceAuthentication,
      'not_asserted_on_human_account_route',
    )

    const humanOnly = await fetch(`${origin}/v1/device/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(humanOnly.status, 401)
    assert.equal((await humanOnly.json()).code, 'device_auth_required')

    const signed = await createSignedRequest({
      nonce: 'JJJJJJJJJJJJJJJJJJJJJJ',
    })
    const deviceOnly = await fetch(`${origin}/v1/device/me`, {
      headers: { 'x-codetether-device-proof': signed.proof },
    })
    assert.equal(deviceOnly.status, 401)
    assert.equal((await deviceOnly.json()).code, 'missing_authentication')
    const deviceResponse = await fetch(`${origin}/v1/device/me`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-codetether-device-proof': signed.proof,
      },
    })
    assert.equal(deviceResponse.status, 200)
    const body = await deviceResponse.json()
    assert.equal(body.deviceAuthentication, 'device_bound')
    assert.equal(body.device.deviceId, registeredDevice.deviceId)
  } finally {
    await running.close()
  }
})

test('HTTP bootstrap routes create a device only after candidate-key proof', async () => {
  const routeKey = await generateKeyPair('ES256', { extractable: true })
  const routePublicJwk = await exportJWK(routeKey.publicKey)
  const verifier = {
    async verifyAccessToken(value) {
      assert.equal(value, token)
      return verifiedHuman()
    },
  }
  const running = await startControlPlaneServer({
    database,
    humanAuthVerifier: verifier,
    authenticatedAccountService: accountService,
    productDeviceAuthenticationService: deviceService,
    host: '127.0.0.1',
    port: 0,
  })
  try {
    const origin = `http://127.0.0.1:${running.address.port}`
    const challengeResponse = await fetch(
      `${origin}/v1/devices/registration-challenge`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          publicKey: routePublicJwk,
          keyAlgorithm: 'ES256',
          deviceType: 'desktop_client',
          label: 'Route registration fixture',
          platform: 'windows',
          appVersion: '0.1.0-test',
          protocolVersion: 1,
        }),
      },
    )
    assert.equal(challengeResponse.status, 201)
    const challenge = (await challengeResponse.json()).challenge
    const proof = await new CompactSign(
      encodeRegistrationChallengePayload(challenge),
    )
      .setProtectedHeader({
        alg: 'ES256',
        typ: PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
      })
      .sign(routeKey.privateKey)
    const registerResponse = await fetch(`${origin}/v1/devices/register`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ challenge, proof }),
    })
    assert.equal(registerResponse.status, 201)
    const body = await registerResponse.json()
    assert.equal(body.device.ownerUserId, human.userId)
    assert.equal(body.device.deviceId, challenge.candidateDeviceId)
  } finally {
    await running.close()
  }
})

test('revoked ProductDevice cannot authenticate and does not mutate account ownership', async () => {
  const revokeProof = await createSignedRequest({
    method: 'POST',
    rawResource: `/v1/devices/${registeredDevice.deviceId}/revoke`,
    nonce: 'KKKKKKKKKKKKKKKKKKKKKK',
  })
  const actor = await deviceService.authenticateProductDeviceRequest(human, {
    compactProof: revokeProof.proof,
    method: revokeProof.method,
    rawResource: revokeProof.rawResource,
    body: revokeProof.body,
  })
  await deviceService.revokeProductDevice(actor, registeredDevice.deviceId)

  const after = await createSignedRequest({
    nonce: 'LLLLLLLLLLLLLLLLLLLLLL',
  })
  await expectDeviceFailure(
    deviceService.authenticateProductDeviceRequest(human, {
      compactProof: after.proof,
      method: after.method,
      rawResource: after.rawResource,
      body: after.body,
    }),
    'device_revoked',
  )
  const account = await accountService.resolveVerifiedHuman(verifiedHuman())
  assert.equal(account.userId, human.userId)
  assert.equal(account.personalSpaceId, human.personalSpaceId)
})

test('database and security events contain no private key, raw token, proof, or nonce', async () => {
  const columns = await database.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'control_plane'`,
  )
  const names = columns.rows.map(
    ({ table_name, column_name }) => `${table_name}.${column_name}`,
  )
  for (const forbidden of [
    'private_key',
    'access_token',
    'refresh_token',
    'raw_jwt',
    'raw_nonce',
    'signature',
  ]) {
    assert.equal(
      names.some((name) => name.includes(forbidden)),
      false,
    )
  }
  const events = await database.query(
    `SELECT event_type, actor_id, target_id, reason_code
       FROM control_plane.security_events
      WHERE event_type IN ('device_registered', 'device_revoked', 'replay_rejected')`,
  )
  const serialized = JSON.stringify(events.rows)
  assert.equal(serialized.includes(token), false)
  assert.equal(serialized.includes('KKKKKKKKKKKKKKKKKKKKKK'), false)

  const deviceKeys = await database.query(
    `SELECT public_key FROM control_plane.product_devices WHERE key_algorithm = 'ES256'`,
  )
  for (const { public_key } of deviceKeys.rows) {
    assert.equal('d' in JSON.parse(public_key), false)
  }
  const replayMetadata = await database.query(
    `SELECT auth_token_hash, nonce_hash FROM control_plane.device_request_nonces`,
  )
  const replaySerialized = JSON.stringify(replayMetadata.rows)
  assert.equal(replaySerialized.includes(token), false)
  assert.equal(replaySerialized.includes('QQQQQQQQQQQQQQQQQQQQQQ'), false)
})
