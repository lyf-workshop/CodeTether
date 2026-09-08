import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  artifactFilename,
  generateManifest,
  verifyManifest,
  sha256,
  scanReleaseContents,
} from '../src/release.mjs'
import { assertNativeTarget, reserveArtifact } from '../src/build.mjs'

const identity = { version: '0.1.0-alpha.0', commit: 'a'.repeat(40) }
const descriptor = {
  component: 'node',
  platform: 'linux',
  architecture: 'x64',
  artifactType: 'tar.gz',
  signingState: 'unsigned',
}

test('repeated release attempts cannot overwrite historical artifact bytes', async (t) => {
  const { artifact } = await fixture(t)
  const before = await sha256(artifact)
  await assert.rejects(reserveArtifact(artifact), /EEXIST/u)
  assert.equal(await sha256(artifact), before)
})

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-release-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = artifactFilename(descriptor, identity.version)
  const artifact = join(directory, filename)
  await writeFile(artifact, 'synthetic archive bytes')
  await writeFile(
    `${artifact}.receipt.json`,
    JSON.stringify({
      ...descriptor,
      ...identity,
      sha256: await sha256(artifact),
      launchSmoke: 'PASS',
      privacy: 'PASS',
      classification: 'BUILD ONLY',
    }),
  )
  return { directory, artifact }
}

test('manifest binds exact artifacts and native receipt without promoting BUILD ONLY', async (t) => {
  const { directory } = await fixture(t)
  const manifest = await generateManifest(directory, [descriptor], identity)
  assert.equal(await verifyManifest(directory, manifest), true)
  assert.equal(manifest.channel, 'alpha')
  assert.equal(
    manifest.artifacts[0].filename,
    'CodeTether-node-0.1.0-alpha.0-linux-x64.tar.gz',
  )
})
test('reject corrupt, missing, duplicate, mismatched, and stale evidence', async (t) => {
  const { directory, artifact } = await fixture(t)
  const manifest = await generateManifest(directory, [descriptor], identity)
  await assert.rejects(
    generateManifest(directory, [descriptor, descriptor], identity),
    /Duplicate/u,
  )
  await assert.rejects(
    generateManifest(directory, [descriptor], {
      ...identity,
      commit: 'b'.repeat(40),
    }),
    /receipt/u,
  )
  manifest.artifacts[0].sha256 = '0'.repeat(64)
  await assert.rejects(verifyManifest(directory, manifest), /checksum/u)
  await writeFile(artifact, 'corrupt')
  await assert.rejects(
    generateManifest(directory, [descriptor], identity),
    /receipt/u,
  )
  await rm(artifact)
  await assert.rejects(
    generateManifest(directory, [descriptor], identity),
    /ENOENT/u,
  )
  assert.throws(() =>
    artifactFilename({ ...descriptor, artifactType: 'dmg' }, identity.version),
  )
})
test('native target cannot masquerade as another platform or architecture', () => {
  assertNativeTarget('macos', 'arm64', 'darwin', 'arm64')
  assert.throws(
    () => assertNativeTarget('macos', 'arm64', 'win32', 'x64'),
    /native/u,
  )
  assert.throws(
    () => assertNativeTarget('linux', 'arm64', 'linux', 'x64'),
    /native/u,
  )
})
test('privacy scanner requires real inputs and catches synthetic secrets including UTF16', async (t) => {
  const { directory, artifact } = await fixture(t)
  const sentinel = 'CODETETHER_RELEASE_SYNTHETIC_SECRET'
  assert.equal(
    (await scanReleaseContents(directory, [sentinel])).status,
    'PASS',
  )
  await writeFile(artifact, Buffer.from(sentinel, 'utf16le'))
  await assert.rejects(scanReleaseContents(directory, [sentinel]), /privacy/u)
  await assert.rejects(scanReleaseContents(directory, []), /required/u)
  await writeFile(join(directory, '.env'), 'not a real secret')
  await assert.rejects(scanReleaseContents(directory, [sentinel]))
})
