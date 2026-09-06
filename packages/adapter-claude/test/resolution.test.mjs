import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

import {
  ClaudeCodeMisconfiguredError,
  ClaudeCodeNotInstalledError,
  resolveClaudeCodeLauncher,
} from '../dist/index.js'

test('resolves a native Windows executable without a shell', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-native-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })
  const executable = join(root, 'claude.exe')
  await writeFile(executable, '')

  const launcher = await resolveClaudeCodeLauncher({
    platform: 'win32',
    environment: { Path: `"${root}"` },
  })
  assert.equal(launcher.kind, 'native')
  assert.equal(launcher.executable, executable)
  assert.deepEqual(launcher.prefixArguments, [])
})

test('resolves only a verified standard npm shim layout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-npm-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })
  const shim = join(root, 'claude.cmd')
  const node = join(root, 'node.exe')
  const packageRoot = join(root, 'node_modules', '@anthropic-ai', 'claude-code')
  const entry = join(packageRoot, 'cli.js')
  await mkdir(packageRoot, { recursive: true })
  await Promise.all([
    writeFile(shim, '@echo off'),
    writeFile(node, ''),
    writeFile(entry, ''),
    writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@anthropic-ai/claude-code',
        bin: { claude: 'cli.js' },
      }),
    ),
  ])

  const launcher = await resolveClaudeCodeLauncher({
    executablePath: shim,
    platform: 'win32',
    environment: { Path: root },
  })
  assert.equal(launcher.kind, 'npm')
  assert.equal(launcher.executable, node)
  assert.deepEqual(launcher.prefixArguments, [entry])
  assert.equal(launcher.sourcePath, shim)
})

test('rejects an npm manifest entry that escapes the package', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-escape-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })
  const shim = join(root, 'claude.cmd')
  const packageRoot = join(root, 'node_modules', '@anthropic-ai', 'claude-code')
  const escaped = join(dirname(packageRoot), 'outside.js')
  await mkdir(packageRoot, { recursive: true })
  await Promise.all([
    writeFile(shim, '@echo off'),
    writeFile(join(root, 'node.exe'), ''),
    writeFile(escaped, ''),
    writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@anthropic-ai/claude-code',
        bin: { claude: '../outside.js' },
      }),
    ),
  ])

  await assert.rejects(
    resolveClaudeCodeLauncher({
      executablePath: shim,
      platform: 'win32',
      environment: { Path: root },
    }),
    ClaudeCodeMisconfiguredError,
  )
})

test('reports not installed when PATH has no candidate', async () => {
  await assert.rejects(
    resolveClaudeCodeLauncher({
      platform: 'win32',
      environment: { Path: 'C:\\definitely-not-a-real-claude-directory' },
    }),
    ClaudeCodeNotInstalledError,
  )
})

test(
  'POSIX PATH order deterministically selects one canonical installation',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codetether-claude-posix-path-'))
    t.after(async () => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(root, { recursive: true, force: true }),
      )
    })
    const firstDirectory = join(root, 'first')
    const secondDirectory = join(root, 'second')
    await Promise.all([
      mkdir(firstDirectory, { recursive: true }),
      mkdir(secondDirectory, { recursive: true }),
    ])
    const first = join(firstDirectory, 'claude')
    const second = join(secondDirectory, 'claude')
    await Promise.all([
      writeFile(first, '#!/bin/sh\nexit 0\n'),
      writeFile(second, '#!/bin/sh\nexit 0\n'),
    ])
    await Promise.all([chmod(first, 0o755), chmod(second, 0o755)])

    const selectedFirst = await resolveClaudeCodeLauncher({
      platform: 'linux',
      environment: { PATH: `${firstDirectory}${delimiter}${secondDirectory}` },
    })
    const selectedSecond = await resolveClaudeCodeLauncher({
      platform: 'linux',
      environment: { PATH: `${secondDirectory}${delimiter}${firstDirectory}` },
    })
    assert.equal(selectedFirst.executable, await realpath(first))
    assert.equal(selectedSecond.executable, await realpath(second))
  },
)
