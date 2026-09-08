import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnCodexCompatibilityProcess } from '../dist/probe-supervision.js'

test(
  'missing POSIX guardian fails closed without unhandled spawn error or fallback',
  { skip: process.platform === 'win32' },
  async (t) => {
    const previous = [
      process.env.CODETETHER_DESKTOP_MANAGED,
      process.env.CODETETHER_POSIX_GUARDIAN,
    ]
    t.after(() => {
      for (const [index, key] of [
        'CODETETHER_DESKTOP_MANAGED',
        'CODETETHER_POSIX_GUARDIAN',
      ].entries()) {
        if (previous[index] === undefined) delete process.env[key]
        else process.env[key] = previous[index]
      }
    })
    process.env.CODETETHER_DESKTOP_MANAGED = '1'
    process.env.CODETETHER_POSIX_GUARDIAN =
      '/__codetether_nonexistent_guardian__'
    assert.throws(
      () =>
        spawnCodexCompatibilityProcess({
          executable: process.execPath,
          arguments: ['--version'],
          environment: {},
          timeoutMs: 1000,
        }),
      /could not start/u,
    )
    await new Promise((resolve) => setImmediate(resolve))
  },
)
