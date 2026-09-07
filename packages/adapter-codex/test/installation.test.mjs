import assert from 'node:assert/strict'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

import {
  discoverCodexInstallations,
  fingerprintCodexInstallation,
  observeCodexInstallation,
} from '../dist/index.js'

async function fixture(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return root
}

async function executable(path, contents = 'codex fixture') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  await chmod(path, 0o755)
  return path
}

test('discovers multiple Codex installations and deduplicates symlink and hardlink aliases', async (t) => {
  const root = await fixture(t, 'codetether-codex-installations-')
  const first = await executable(join(root, 'first', 'codex.exe'), 'first')
  const second = await executable(join(root, 'second', 'codex.exe'), 'second')
  const symlinkAlias = join(root, 'symlink', 'codex.exe')
  const hardlinkAlias = join(root, 'hardlink', 'codex.exe')
  await Promise.all([
    mkdir(dirname(symlinkAlias), { recursive: true }),
    mkdir(dirname(hardlinkAlias), { recursive: true }),
  ])
  await symlink(first, symlinkAlias, 'file')
  await link(first, hardlinkAlias)

  const result = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [symlinkAlias, first, hardlinkAlias, second],
    knownPaths: [],
  })

  assert.equal(result.installations.length, 2)
  assert.equal(result.installations[0].launcherPath, symlinkAlias)
  assert.equal(result.installations[0].executable, await realpath(first))
  assert.equal(result.installations[0].launcherKind, 'symlink')
  assert.equal(result.installations[1].executable, await realpath(second))
  assert.notEqual(
    result.installations[0].fileIdentity,
    result.installations[1].fileIdentity,
  )

  const hardlinkOnly = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [hardlinkAlias],
  })
  assert.equal(hardlinkOnly.installations[0].launcherKind, 'hardlink')
})

test('preserves configured selection ahead of PATH while bounding candidate inspection', async (t) => {
  const root = await fixture(t, 'codetether-codex-bounds-')
  const selectedDirectory = join(root, 'selected')
  const alternateDirectory = join(root, 'alternate')
  const ignoredDirectory = join(root, 'ignored')
  const selected = await executable(join(selectedDirectory, 'codex.exe'))
  const alternate = await executable(join(alternateDirectory, 'codex.exe'))
  await executable(join(ignoredDirectory, 'codex.exe'))

  const result = await discoverCodexInstallations({
    platform: 'win32',
    environment: {
      PATH: [alternateDirectory, selectedDirectory, ignoredDirectory].join(
        delimiter,
      ),
    },
    configuredPaths: [selected],
    maximumPathEntries: 2,
    maximumInstallations: 2,
  })

  assert.deepEqual(
    result.installations.map(({ launcherPath }) => launcherPath),
    [selected, alternate],
  )
  assert.equal(result.pathsInspected, 2)
  assert.equal(result.truncated, true)
})

test('inspects a late Windows PATH entry that remains within the declared entry bound', async (t) => {
  const root = await fixture(t, 'codetether-codex-late-path-')
  const pathDirectories = Array.from({ length: 20 }, (_, index) =>
    join(root, `path-${String(index).padStart(2, '0')}`),
  )
  const late = await executable(join(pathDirectories[18], 'codex.exe'))

  const result = await discoverCodexInstallations({
    platform: 'win32',
    environment: { PATH: pathDirectories.join(delimiter) },
    knownPaths: [],
    maximumPathEntries: pathDirectories.length,
    maximumInstallations: 2,
  })

  assert.equal(result.installations.length, 1)
  assert.equal(result.installations[0].launcherPath, late)
  assert.equal(result.pathsInspected, pathDirectories.length * 2)
  assert.equal(result.truncated, false)
})

test('propagates lifecycle cancellation before filesystem discovery', async () => {
  const controller = new AbortController()
  const reason = new Error('discovery cancelled')
  controller.abort(reason)

  await assert.rejects(
    discoverCodexInstallations({
      environment: {},
      knownPaths: [],
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

test('classifies wrapper and unknown provenance without guessing an install method', async (t) => {
  const root = await fixture(t, 'codetether-codex-wrapper-')
  const wrapper = await executable(
    join(root, 'manual', 'codex'),
    '#!/bin/sh\nexit 0\n',
  )

  const result = await discoverCodexInstallations({
    platform: 'linux',
    environment: {},
    configuredPaths: [wrapper],
  })

  assert.equal(result.installations.length, 1)
  assert.equal(result.installations[0].launcherKind, 'wrapper')
  assert.equal(result.installations[0].installMethod, 'unknown')
  assert.equal(result.installations[0].shellFreeLaunch, true)
  const revisionA = await fingerprintCodexInstallation(result.installations[0])
  await writeFile(wrapper, '#!/bin/sh\nexit 1\n')
  const changed = await discoverCodexInstallations({
    platform: 'linux',
    environment: {},
    configuredPaths: [wrapper],
  })
  assert.notEqual(
    await fingerprintCodexInstallation(changed.installations[0]),
    revisionA,
  )
})

test('detects in-place content and launcher-target revision changes', async (t) => {
  const root = await fixture(t, 'codetether-codex-revision-')
  const inPlace = await executable(join(root, 'in-place', 'codex.exe'), 'A')
  const firstObservation = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [inPlace],
  })
  const firstCandidate = firstObservation.installations[0]
  const revisionA = await fingerprintCodexInstallation(firstCandidate)
  await writeFile(inPlace, 'B')
  const secondObservation = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [inPlace],
  })
  const secondCandidate = secondObservation.installations[0]
  const revisionB = await fingerprintCodexInstallation(secondCandidate)

  assert.equal(secondCandidate.launcherPath, firstCandidate.launcherPath)
  assert.equal(secondCandidate.fileIdentity, firstCandidate.fileIdentity)
  assert.notEqual(revisionB, revisionA)

  const targetA = await executable(join(root, 'targets', 'codex-a.exe'), 'A')
  const targetB = await executable(join(root, 'targets', 'codex-b.exe'), 'A')
  const launcher = join(root, 'launcher', 'codex.exe')
  await mkdir(dirname(launcher), { recursive: true })
  await symlink(targetA, launcher, 'file')
  const targetObservationA = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [launcher],
  })
  const targetRevisionA = await fingerprintCodexInstallation(
    targetObservationA.installations[0],
  )
  await rm(launcher)
  await symlink(targetB, launcher, 'file')
  const targetObservationB = await discoverCodexInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [launcher],
  })

  assert.equal(
    targetObservationA.installations[0].launcherPath,
    targetObservationB.installations[0].launcherPath,
  )
  assert.notEqual(
    targetObservationA.installations[0].executable,
    targetObservationB.installations[0].executable,
  )
  assert.notEqual(
    targetRevisionA,
    await fingerprintCodexInstallation(targetObservationB.installations[0]),
  )
  await assert.rejects(
    fingerprintCodexInstallation(targetObservationA.installations[0]),
    /launcher target changed/u,
  )
})

test('reports removal and return without scanning outside bounded sources', async (t) => {
  const root = await fixture(t, 'codetether-codex-return-')
  const path = await executable(join(root, 'manual', 'codex.exe'))
  const options = {
    platform: 'win32',
    environment: {},
    configuredPaths: [path],
    knownPaths: [],
  }

  const present = await discoverCodexInstallations(options)
  await rm(path)
  const removed = await discoverCodexInstallations(options)
  await executable(path)
  const returned = await discoverCodexInstallations(options)

  assert.equal(present.installations.length, 1)
  assert.equal(removed.installations.length, 0)
  assert.equal(returned.installations.length, 1)
  assert.equal(returned.installations[0].launcherPath, path)
  assert.equal(await readFile(path, 'utf8'), 'codex fixture')
})

test('resolves a bounded official npm cmd shim to its exact native binary without a shell', async (t) => {
  const root = await fixture(t, 'codetether-codex-npm-shim-')
  const packageRoot = join(root, 'node_modules', '@openai', 'codex')
  const platformRoot = join(root, 'node_modules', '@openai', 'codex-win32-x64')
  await mkdir(packageRoot, { recursive: true })
  await mkdir(platformRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } }),
  )
  await writeFile(
    join(platformRoot, 'package.json'),
    JSON.stringify({ name: '@openai/codex-win32-x64' }),
  )
  const native = await executable(
    join(
      platformRoot,
      'vendor',
      'x86_64-pc-windows-msvc',
      'codex',
      'codex.exe',
    ),
    'native-a',
  )
  const shim = await executable(
    join(root, 'codex.cmd'),
    '@IF EXIST "%~dp0\\node.exe" (\n  "%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n) ELSE (\n  node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n)\n',
  )

  const first = await discoverCodexInstallations({
    platform: 'win32',
    architecture: 'x64',
    environment: { PATH: root },
    knownPaths: [],
  })

  assert.equal(first.installations.length, 1)
  assert.equal(first.installations[0].launcherPath, shim)
  assert.equal(first.installations[0].executable, await realpath(native))
  assert.equal(first.installations[0].launcherKind, 'npm_shim')
  assert.equal(first.installations[0].installMethod, 'npm')
  assert.equal(first.installations[0].shellFreeLaunch, true)
  const revisionA = await fingerprintCodexInstallation(first.installations[0])
  await writeFile(native, 'native-b')
  const second = await discoverCodexInstallations({
    platform: 'win32',
    architecture: 'x64',
    environment: { PATH: root },
    knownPaths: [],
  })
  assert.notEqual(
    await fingerprintCodexInstallation(second.installations[0]),
    revisionA,
  )
})

test('keeps opaque wrappers visible but never claims shell-free execution', async (t) => {
  const root = await fixture(t, 'codetether-codex-opaque-wrapper-')
  const wrapper = await executable(
    join(root, 'codex.cmd'),
    '@echo opaque custom wrapper\n',
  )
  const discovery = await discoverCodexInstallations({
    platform: 'win32',
    architecture: 'x64',
    environment: { PATH: root },
    knownPaths: [],
  })

  assert.equal(discovery.installations.length, 1)
  assert.equal(discovery.installations[0].launcherPath, wrapper)
  assert.equal(discovery.installations[0].shellFreeLaunch, false)
  let executed = false
  const observation = await observeCodexInstallation({
    installation: discovery.installations[0],
    probeVersion: async () => {
      executed = true
      return 'codex-cli 0.149.1'
    },
  })
  assert.equal(executed, false)
  assert.equal(observation.compatibility.state, 'incompatible')
  assert.equal(
    observation.compatibility.capabilities.execution.effective,
    false,
  )
})

test('resolves the official POSIX npm symlink to its versioned native payload', async (t) => {
  const root = await fixture(t, 'codetether-codex-npm-posix-')
  const packageRoot = join(root, 'lib', 'node_modules', '@openai', 'codex')
  const platformRoot = join(
    root,
    'lib',
    'node_modules',
    '@openai',
    'codex-linux-x64',
  )
  await mkdir(join(packageRoot, 'bin'), { recursive: true })
  await mkdir(platformRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@openai/codex', bin: 'bin/codex.js' }),
  )
  const script = await executable(
    join(packageRoot, 'bin', 'codex.js'),
    '#!/usr/bin/env node\n',
  )
  await writeFile(
    join(platformRoot, 'package.json'),
    JSON.stringify({ name: '@openai/codex-linux-x64' }),
  )
  const native = await executable(
    join(platformRoot, 'vendor', 'x86_64-unknown-linux-musl', 'codex', 'codex'),
    'native-linux',
  )
  const bin = join(root, 'bin')
  const launcher = join(bin, 'codex')
  await mkdir(bin, { recursive: true })
  await symlink(script, launcher, 'file')

  const discovery = await discoverCodexInstallations({
    platform: 'linux',
    architecture: 'x64',
    environment: { PATH: bin },
    knownPaths: [],
  })

  assert.equal(discovery.installations.length, 1)
  assert.equal(discovery.installations[0].launcherPath, launcher)
  assert.equal(discovery.installations[0].executable, await realpath(native))
  assert.equal(discovery.installations[0].launcherKind, 'npm_shim')
  assert.equal(discovery.installations[0].installMethod, 'npm')
  assert.equal(discovery.installations[0].shellFreeLaunch, true)
})
