import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { NodeStateStore } from '../dist/state-store.js'

function openState(dataDirectory) {
  return NodeStateStore.open({
    dataDirectory,
    displayName: 'State race fixture',
    platform: 'Linux',
    architecture: 'x64',
  })
}

test('stale acquisition and stale main lock concurrent recovery admits exactly one owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-state-race-'))
  const lockPath = join(directory, 'node.lock')
  const acquisitionPath = `${lockPath}.acquire`
  const staleOwner = {
    pid: 2_147_483_647,
    nonce: 'a'.repeat(32),
  }
  let winner
  try {
    await writeFile(lockPath, `${JSON.stringify(staleOwner)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await mkdir(acquisitionPath)
    await writeFile(
      join(acquisitionPath, 'owner.json'),
      `${JSON.stringify({ ...staleOwner, nonce: 'b'.repeat(32) })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )

    const attempts = await Promise.allSettled(
      Array.from({ length: 24 }, async () => await openState(directory)),
    )
    const fulfilled = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    )
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 23)
    assert.equal(
      rejected.every((attempt) => attempt.reason instanceof Error),
      true,
    )
    winner = fulfilled[0].value

    const owned = JSON.parse(await readFile(lockPath, 'utf8'))
    assert.equal(owned.pid, process.pid)
    assert.notEqual(owned.nonce, staleOwner.nonce)
    assert.equal(owned.nonce.length, 32)
  } finally {
    await winner?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test("failed stale owner's release cannot remove a replacement nonce-owned main lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-state-nonce-'))
  const lockPath = join(directory, 'node.lock')
  let staleOwner
  try {
    staleOwner = await openState(directory)
    const replacement = {
      pid: process.pid,
      nonce: 'f'.repeat(32),
    }
    const replacementText = `${JSON.stringify(replacement)}\n`
    await writeFile(lockPath, replacementText, 'utf8')

    await assert.rejects(
      staleOwner.close(),
      /ownership changed; refusing removal/u,
    )
    assert.equal(await readFile(lockPath, 'utf8'), replacementText)
    await assert.rejects(openState(directory), /already in use/u)
  } finally {
    await staleOwner?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
