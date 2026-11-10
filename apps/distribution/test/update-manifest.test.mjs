import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeUpdateFragments,
  updateFragment,
  updateReleaseEnabled,
  updaterArtifact,
  signedUpdaterTauriConfig,
} from '../src/update-manifest.mjs'

const version = '0.1.0-alpha.3'
const commit = 'a'.repeat(40)
const baseUrl = 'https://codetether.org/updates'
const signature = 'synthetic-signature-for-tests'
const notes = '本次更新的说明。'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-update-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, version))
  return directory
}

async function writeFragment(directory, platform, architecture) {
  const fragment = updateFragment({
    platform,
    architecture,
    version,
    commit,
    baseUrl,
    signature,
    notes,
  })
  const name = `update-${platform}-${architecture}.json`
  const { filename } = updaterArtifact(platform, architecture, version)
  await writeFile(
    join(directory, version, filename),
    'synthetic installer bytes',
  )
  await writeFile(join(directory, version, `${filename}.sig`), signature)
  await writeFile(join(directory, name), JSON.stringify(fragment))
  return name
}

test('four-variable gate never enables a partially configured updater release', () => {
  assert.equal(updateReleaseEnabled({}), false)
  assert.throws(
    () => updateReleaseEnabled({ TAURI_SIGNING_PRIVATE_KEY: 'present' }),
    /requires all four variables/u,
  )
  assert.equal(
    updateReleaseEnabled({
      TAURI_SIGNING_PRIVATE_KEY: 'present',
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'present',
      CODETETHER_UPDATE_BASE_URL: baseUrl,
      CODETETHER_UPDATE_PUBKEY: 'present',
    }),
    true,
  )
})

test('signed Tauri build receives the public key in its config override', () => {
  assert.deepEqual(
    signedUpdaterTauriConfig({ CODETETHER_UPDATE_PUBKEY: 'test-public-key' }),
    {
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey: 'test-public-key' } },
    },
  )
  assert.throws(() => signedUpdaterTauriConfig({}), /public key/u)
})

test('platform fragments use exact Tauri updater targets and release URLs', async (t) => {
  const directory = await fixture(t)
  const windows = await writeFragment(directory, 'windows', 'x64')
  const mac = await writeFragment(directory, 'macos', 'arm64')
  const partial = await mergeUpdateFragments(directory, [windows])
  assert.deepEqual(Object.keys(partial.platforms), ['windows-x86_64-nsis'])
  assert.equal(
    partial.platforms['windows-x86_64-nsis'].url,
    `${baseUrl}/alpha/${version}/CodeTether-desktop-${version}-windows-x64.exe`,
  )
  const merged = await mergeUpdateFragments(directory, [windows, mac])
  assert.deepEqual(Object.keys(merged.platforms), [
    'darwin-aarch64',
    'windows-x86_64-nsis',
  ])
  assert.equal(merged.platforms['darwin-aarch64'].signature, signature)
  assert.equal(merged.version, version)
  assert.equal(merged.notes, notes)
  assert.equal(Object.hasOwn(merged, 'commit'), false)
  await assert.rejects(
    mergeUpdateFragments(directory, [windows], 'b'.repeat(40)),
    /current clean HEAD/u,
  )
})

test('merge rejects same-version fragments built from different commits', async (t) => {
  const directory = await fixture(t)
  const windows = await writeFragment(directory, 'windows', 'x64')
  const mac = await writeFragment(directory, 'macos', 'arm64')
  const macPath = join(directory, mac)
  const macFragment = JSON.parse(await readFile(macPath, 'utf8'))
  macFragment.commit = 'b'.repeat(40)
  await writeFile(macPath, JSON.stringify(macFragment))
  await assert.rejects(
    mergeUpdateFragments(directory, [windows, mac]),
    /same version, commit/u,
  )
  delete macFragment.commit
  await writeFile(macPath, JSON.stringify(macFragment))
  await assert.rejects(
    mergeUpdateFragments(directory, [windows, mac]),
    /one platform/u,
  )
})

test('merge rejects mismatched or missing signed bytes', async (t) => {
  const directory = await fixture(t)
  const windows = await writeFragment(directory, 'windows', 'x64')
  await writeFile(
    join(
      directory,
      version,
      `CodeTether-desktop-${version}-windows-x64.exe.sig`,
    ),
    'wrong signature',
  )
  await assert.rejects(
    mergeUpdateFragments(directory, [windows]),
    /signature file differs/u,
  )
  await writeFile(
    join(
      directory,
      version,
      `CodeTether-desktop-${version}-windows-x64.exe.sig`,
    ),
    signature,
  )
  const fragment = JSON.parse(await readFile(join(directory, windows), 'utf8'))
  fragment.platforms['windows-x86_64-nsis'].url =
    'http://example.com/unsafe.exe'
  await writeFile(join(directory, windows), JSON.stringify(fragment))
  await assert.rejects(mergeUpdateFragments(directory, [windows]), /HTTPS/u)
})

test('fragment refuses HTTP and oversize release notes', () => {
  assert.throws(
    () =>
      updateFragment({
        platform: 'windows',
        architecture: 'x64',
        version,
        commit,
        baseUrl: 'http://localhost',
        signature,
        notes,
      }),
    /HTTPS/u,
  )
  assert.throws(
    () =>
      updateFragment({
        platform: 'macos',
        architecture: 'arm64',
        version,
        commit,
        baseUrl,
        signature,
        notes: 'x'.repeat(2001),
      }),
    /2000/u,
  )
})
