import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test(
  'CLI owns stop signals before readiness and restarts with the same identity',
  { skip: process.platform === 'win32', timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codetether-cli-shutdown-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    let machineId
    for (let iteration = 0; iteration < 10; iteration++) {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL('../dist/main.js', import.meta.url)),
          '--json',
          '--data-dir',
          join(root, 'state'),
          '--bind',
          '127.0.0.1',
          '--port',
          '0',
        ],
        {
          env: { HOME: root, PATH: '/usr/bin:/bin' },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        },
      )
      const closed = once(child, 'close')
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
      let buffer = ''
      let ready
      child.stderr.resume()
      child.stdout.on('data', (value) => {
        buffer += value.toString()
        const end = buffer.indexOf('\n')
        if (end !== -1 && ready === undefined) {
          ready = JSON.parse(buffer.slice(0, end))
          child.kill('SIGTERM')
        }
      })
      try {
        const [code, signal] = await closed
        assert.equal(signal, null)
        assert.equal(code, 0)
        assert.equal(ready?.event, 'node.ready')
        machineId ??= ready.machineId
        assert.equal(ready.machineId, machineId)
      } finally {
        clearTimeout(deadline)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await closed
        }
      }
    }
  },
)
