import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const appDirectory = resolve(scriptDirectory, '..')
const generator = join(scriptDirectory, 'generate-local-config.mjs')
const verifier = join(scriptDirectory, 'verify-build-config.mjs')
const localConfig = join(appDirectory, 'Config', 'Local.xcconfig')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'codetether-ios-config-'))
const environmentFile = join(temporaryDirectory, 'v4-build.env')
const fixtureApp = join(temporaryDirectory, 'CodeTether.app')

const originalConfig = await readOptional(localConfig)
const originalMode = await readOptionalMode(localConfig)

try {
  await writeFile(
    environmentFile,
    [
      'VITE_SUPABASE_URL=https://supabase.example.test',
      'VITE_SUPABASE_PUBLISHABLE_KEY=publishable_test_key',
      'VITE_CODETETHER_CONTROL_PLANE_URL=https://api.example.test',
      'CODETETHER_SUPERVISOR_RELAY_ENDPOINT=https://relay.example.test',
      'CODETETHER_SUPERVISOR_RELAY_ID=relay-test-id',
      'CODETETHER_SUPERVISOR_RELAY_FINGERPRINT=relay-test-fingerprint',
      '',
    ].join('\n'),
  )

  const generated = spawnSync(process.execPath, [generator, environmentFile], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  assert.equal(generated.stdout, 'Local iPad build configuration generated; optional Relay settings: complete\n')

  const config = await readFile(localConfig, 'utf8')
  assert.match(config, /^SUPABASE_URL = https:\/\$\(\)\/supabase\.example\.test$/m)
  assert.match(config, /^CODETETHER_CONTROL_PLANE_URL = https:\/\$\(\)\/api\.example\.test$/m)
  assert.doesNotMatch(config, /SUPABASE_URL = "/u)

  const settings = Object.fromEntries(
    config
      .trim()
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+) = (.*)$/u))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  )
  const expandXcconfigValue = (value) => value.replaceAll(':/$()/','://')

  const buildSettings = spawnSync(
    '/usr/bin/xcodebuild',
    [
      '-project',
      join(appDirectory, 'CodeTether.xcodeproj'),
      '-scheme',
      'CodeTether',
      '-configuration',
      'Debug',
      '-showBuildSettings',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  assert.equal(buildSettings.status, 0, buildSettings.stderr)
  assert.match(buildSettings.stdout, /^\s+CODETETHER_CONTROL_PLANE_URL = https:\/\/api\.example\.test$/mu)
  assert.match(buildSettings.stdout, /^\s+SUPABASE_URL = https:\/\/supabase\.example\.test$/mu)

  await writeFixture(fixtureApp, {
    CodeTetherControlPlaneURL: expandXcconfigValue(settings.CODETETHER_CONTROL_PLANE_URL),
    CodeTetherSupabaseURL: expandXcconfigValue(settings.SUPABASE_URL),
    CodeTetherSupabasePublishableKey: expandXcconfigValue(settings.SUPABASE_PUBLISHABLE_KEY),
    CodeTetherRelayEndpoint: expandXcconfigValue(settings.RELAY_ENDPOINT),
    CodeTetherRelayID: expandXcconfigValue(settings.RELAY_ID),
    CodeTetherRelayFingerprint: expandXcconfigValue(settings.RELAY_FINGERPRINT),
  })
  const verified = spawnSync(process.execPath, [verifier, fixtureApp], { encoding: 'utf8' })
  assert.equal(verified.status, 0, verified.stderr)
  assert.match(verified.stdout, /CodeTetherControlPlaneURL host: api\.example\.test/u)
  assert.match(verified.stdout, /CodeTetherSupabaseURL host: supabase\.example\.test/u)
  assert.doesNotMatch(verified.stdout, /publishable_test_key|relay-test/u)

  await writeFixture(fixtureApp, {
    CodeTetherControlPlaneURL: 'https:',
    CodeTetherSupabaseURL: 'https://supabase.example.test',
    CodeTetherSupabasePublishableKey: 'publishable_test_key',
    CodeTetherRelayEndpoint: '',
    CodeTetherRelayID: '',
    CodeTetherRelayFingerprint: '',
  })
  const rejected = spawnSync(process.execPath, [verifier, fixtureApp], { encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /CodeTetherControlPlaneURL/u)

  console.log('iPad configuration generation and final Info.plist verification passed')
} finally {
  if (originalConfig === null) {
    await rm(localConfig, { force: true })
  } else {
    await writeFile(localConfig, originalConfig)
    if (originalMode !== null) await chmod(localConfig, originalMode)
  }
  await rm(temporaryDirectory, { recursive: true, force: true })
}

async function writeFixture(app, values) {
  await mkdir(app, { recursive: true })
  const entries = Object.entries(values)
    .map(([key, value]) => `<key>${key}</key><string>${escapeXml(value)}</string>`)
    .join('')
  await writeFile(
    join(app, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries}</dict></plist>\n`,
  )
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function readOptionalMode(path) {
  try {
    return (await stat(path)).mode & 0o777
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
