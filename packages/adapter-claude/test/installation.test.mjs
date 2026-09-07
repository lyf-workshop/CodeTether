import assert from 'node:assert/strict'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

import {
  discoverClaudeCodeInstallations,
  fingerprintClaudeCodeInstallation,
} from '../dist/index.js'

async function fixture(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return root
}

async function executable(path, contents = 'claude fixture') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  await chmod(path, 0o755)
  return path
}

test('discovers multiple Claude installations and deduplicates symlink and hardlink aliases', async (t) => {
  const root = await fixture(t, 'codetether-claude-installations-')
  const first = await executable(join(root, 'first', 'claude.exe'), 'first')
  const second = await executable(join(root, 'second', 'claude.exe'), 'second')
  const symlinkAlias = join(root, 'symlink', 'claude.exe')
  const hardlinkAlias = join(root, 'hardlink', 'claude.exe')
  await Promise.all([
    mkdir(dirname(symlinkAlias), { recursive: true }),
    mkdir(dirname(hardlinkAlias), { recursive: true }),
  ])
  await symlink(first, symlinkAlias, 'file')
  await link(first, hardlinkAlias)

  const result = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [symlinkAlias, first, hardlinkAlias, second],
    knownPaths: [],
  })

  assert.equal(result.installations.length, 2)
  assert.equal(result.installations[0].launcherPath, symlinkAlias)
  assert.equal(
    result.installations[0].launcher.executable,
    await realpath(first),
  )
  assert.equal(result.installations[0].launcherKind, 'symlink')
  assert.equal(
    result.installations[1].launcher.executable,
    await realpath(second),
  )
  assert.notEqual(
    result.installations[0].fileIdentity,
    result.installations[1].fileIdentity,
  )

  const hardlinkOnly = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [hardlinkAlias],
  })
  assert.equal(hardlinkOnly.installations[0].launcherKind, 'hardlink')
})

test('preserves configured selection ahead of PATH while bounding candidate inspection', async (t) => {
  const root = await fixture(t, 'codetether-claude-bounds-')
  const selectedDirectory = join(root, 'selected')
  const alternateDirectory = join(root, 'alternate')
  const ignoredDirectory = join(root, 'ignored')
  const selected = await executable(join(selectedDirectory, 'claude.exe'))
  const alternate = await executable(join(alternateDirectory, 'claude.exe'))
  await executable(join(ignoredDirectory, 'claude.exe'))

  const result = await discoverClaudeCodeInstallations({
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

test('propagates lifecycle cancellation before filesystem discovery', async () => {
  const controller = new AbortController()
  const reason = new Error('discovery cancelled')
  controller.abort(reason)

  await assert.rejects(
    discoverClaudeCodeInstallations({
      environment: {},
      knownPaths: [],
      signal: controller.signal,
    }),
    (error) => error === reason,
  )
})

test('classifies wrappers and infers native installer provenance from a resolved target', async (t) => {
  const root = await fixture(t, 'codetether-claude-launchers-')
  const wrapper = await executable(
    join(root, 'manual', 'claude'),
    '#!/bin/sh\nexit 0\n',
  )
  const versionBinary = await executable(
    join(root, '.local', 'share', 'claude', 'versions', '2.1.263'),
  )
  const nativeLauncher = join(root, '.local', 'bin', 'claude')
  await mkdir(dirname(nativeLauncher), { recursive: true })
  await symlink(versionBinary, nativeLauncher, 'file')

  const wrapperResult = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [wrapper],
  })
  const nativeResult = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: { HOME: root },
    configuredPaths: [nativeLauncher],
  })

  assert.equal(wrapperResult.installations[0].launcherKind, 'wrapper')
  assert.equal(wrapperResult.installations[0].installMethod, 'unknown')
  assert.equal(nativeResult.installations.length, 1)
  assert.equal(nativeResult.installations[0].launcherKind, 'symlink')
  assert.equal(nativeResult.installations[0].installMethod, 'native_installer')
})

test('classifies a symlink by its resolved wrapper artifact', async (t) => {
  const root = await fixture(t, 'codetether-claude-symlink-wrapper-')
  const wrapper = await executable(
    join(root, 'target', 'claude'),
    '#!/bin/sh\nexit 0\n',
  )
  const launcher = join(root, 'launcher', 'claude')
  await mkdir(dirname(launcher), { recursive: true })
  await symlink(wrapper, launcher, 'file')

  const result = await discoverClaudeCodeInstallations({
    platform: 'linux',
    environment: {},
    configuredPaths: [launcher],
  })

  assert.equal(result.installations.length, 1)
  assert.equal(result.installations[0].launcherKind, 'wrapper')
  assert.equal(
    result.installations[0].launcher.executable,
    await realpath(wrapper),
  )
})

test('detects in-place content and launcher-target revision changes', async (t) => {
  const root = await fixture(t, 'codetether-claude-revision-')
  const inPlace = await executable(join(root, 'in-place', 'claude.exe'), 'A')
  const firstObservation = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [inPlace],
  })
  const firstCandidate = firstObservation.installations[0]
  const revisionA = await fingerprintClaudeCodeInstallation(firstCandidate)
  await writeFile(inPlace, 'B')
  const secondObservation = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [inPlace],
  })
  const secondCandidate = secondObservation.installations[0]
  const revisionB = await fingerprintClaudeCodeInstallation(secondCandidate)

  assert.equal(secondCandidate.launcherPath, firstCandidate.launcherPath)
  assert.equal(secondCandidate.fileIdentity, firstCandidate.fileIdentity)
  assert.notEqual(revisionB, revisionA)

  const targetA = await executable(join(root, 'targets', 'claude-a.exe'), 'A')
  const targetB = await executable(join(root, 'targets', 'claude-b.exe'), 'A')
  const launcher = join(root, 'launcher', 'claude.exe')
  await mkdir(dirname(launcher), { recursive: true })
  await symlink(targetA, launcher, 'file')
  const targetObservationA = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [launcher],
  })
  await rm(launcher)
  await symlink(targetB, launcher, 'file')
  const targetObservationB = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: {},
    configuredPaths: [launcher],
  })

  assert.equal(
    targetObservationA.installations[0].launcherPath,
    targetObservationB.installations[0].launcherPath,
  )
  assert.notEqual(
    targetObservationA.installations[0].launcher.executable,
    targetObservationB.installations[0].launcher.executable,
  )
  assert.notEqual(
    await fingerprintClaudeCodeInstallation(
      targetObservationA.installations[0],
    ),
    await fingerprintClaudeCodeInstallation(
      targetObservationB.installations[0],
    ),
  )
})

test('reports removal and return without merging installation stores', async (t) => {
  const root = await fixture(t, 'codetether-claude-return-')
  const path = await executable(join(root, 'manual', 'claude.exe'))
  const options = {
    platform: 'win32',
    environment: {},
    configuredPaths: [path],
    knownPaths: [],
  }

  const present = await discoverClaudeCodeInstallations(options)
  await rm(path)
  const removed = await discoverClaudeCodeInstallations(options)
  await executable(path)
  const returned = await discoverClaudeCodeInstallations(options)

  assert.equal(present.installations.length, 1)
  assert.equal(removed.installations.length, 0)
  assert.equal(returned.installations.length, 1)
  assert.equal(returned.installations[0].launcherPath, path)
})

test('bounds the known native-version directory without materializing an unbounded installation set', async (t) => {
  const root = await fixture(t, 'codetether-claude-version-root-bounds-')
  const versions = join(root, '.local', 'share', 'claude', 'versions')
  await mkdir(versions, { recursive: true })
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      executable(join(versions, `2.1.${String(index).padStart(3, '0')}`)),
    ),
  )

  const result = await discoverClaudeCodeInstallations({
    platform: 'win32',
    environment: { HOME: root },
    maximumPathEntries: 2,
    maximumInstallations: 2,
  })

  assert.equal(result.installations.length, 2)
  assert.ok(result.pathsInspected <= 16)
  assert.equal(result.truncated, true)
})
