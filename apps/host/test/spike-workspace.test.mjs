import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { prepareIsolatedWorkspace } from '../dist/spike-workspace.js'

test('semantics workspace preparation removes stale state', async (context) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'codetether-host-'))
  context.after(async () =>
    rm(repositoryRoot, { recursive: true, force: true }),
  )

  const workspace = await prepareIsolatedWorkspace(
    repositoryRoot,
    'codetether-codex-semantics-multiturn',
  )
  const staleFile = resolve(workspace.root, 'stale.txt')
  await writeFile(staleFile, 'stale', 'utf8')
  await writeFile(workspace.exampleFile, 'changed', 'utf8')

  const reset = await prepareIsolatedWorkspace(
    repositoryRoot,
    'codetether-codex-semantics-multiturn',
  )

  await assert.rejects(readFile(staleFile, 'utf8'), { code: 'ENOENT' })
  assert.match(await readFile(reset.exampleFile, 'utf8'), /function greet/)
})

test('isolated workspace only accepts the semantics namespace', async (context) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'codetether-host-'))
  context.after(async () =>
    rm(repositoryRoot, { recursive: true, force: true }),
  )

  await assert.rejects(
    prepareIsolatedWorkspace(repositoryRoot, 'codetether-codex-spike'),
    /Invalid isolated workspace name/,
  )
  await assert.rejects(
    prepareIsolatedWorkspace(repositoryRoot, 'codetether-codex-semantics-'),
    /Invalid isolated workspace name/,
  )
})

test('semantics workspace reset refuses a symlink or junction target', async (context) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'codetether-host-'))
  context.after(async () =>
    rm(repositoryRoot, { recursive: true, force: true }),
  )
  const temporaryRoot = resolve(repositoryRoot, '.tmp')
  const externalTarget = resolve(repositoryRoot, 'preserved-target')
  const linkedWorkspace = resolve(
    temporaryRoot,
    'codetether-codex-semantics-linked',
  )
  await mkdir(temporaryRoot, { recursive: true })
  await mkdir(externalTarget, { recursive: true })
  await writeFile(resolve(externalTarget, 'marker.txt'), 'preserved', 'utf8')
  await symlink(
    externalTarget,
    linkedWorkspace,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await assert.rejects(
    prepareIsolatedWorkspace(
      repositoryRoot,
      'codetether-codex-semantics-linked',
    ),
    /Refusing to reset linked semantics workspace/,
  )
  assert.equal(
    await readFile(resolve(externalTarget, 'marker.txt'), 'utf8'),
    'preserved',
  )
})
