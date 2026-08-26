import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  WorkspacePolicy,
  WorkspacePolicyError,
} from '../dist/api/workspace-policy.js'

test('authorizes existing directories within an explicit root', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'codetether-policy-'))
  t.after(async () => await rm(root, { recursive: true, force: true }))
  const child = resolve(root, 'project')
  await mkdir(child)

  const policy = await WorkspacePolicy.create([root])
  assert.equal(await policy.authorize(child), child)
})

test('rejects relative, missing, file, and outside paths', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'codetether-policy-'))
  const outside = await mkdtemp(resolve(tmpdir(), 'codetether-outside-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  const file = resolve(root, 'file.txt')
  await writeFile(file, 'not a directory')
  const policy = await WorkspacePolicy.create([root])

  await assert.rejects(() => policy.authorize('relative'), WorkspacePolicyError)
  await assert.rejects(
    () => policy.authorize(resolve(root, 'missing')),
    WorkspacePolicyError,
  )
  await assert.rejects(() => policy.authorize(file), WorkspacePolicyError)
  await assert.rejects(() => policy.authorize(outside), WorkspacePolicyError)
})

test('rejects a link that escapes the allowed root', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'codetether-policy-'))
  const outside = await mkdtemp(resolve(tmpdir(), 'codetether-outside-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  const link = resolve(root, 'escape')
  try {
    await symlink(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    ) {
      t.skip('Creating directory links is not permitted in this environment')
      return
    }
    throw error
  }

  const policy = await WorkspacePolicy.create([root])
  await assert.rejects(() => policy.authorize(link), WorkspacePolicyError)
})
