import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startLocalCodexHost } from '../dist/api/local-codex-host.js'
import { HostStartupTimeline } from '../dist/api/startup-timeline.js'

test('repeated local startups: slow Provider discovery cannot block Product API or Supervisor; shutdown joins probes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-startup-ready-'))
  const timings = []
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      let probes = 0
      const phases = {}
      const discovery = async ({ signal }) => {
        probes++
        await Promise.race([
          gate,
          new Promise((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          ),
        ])
        signal.throwIfAborted()
        return { installations: [], truncated: false }
      }
      const host = await startLocalCodexHost({
        allowedOrigins: [],
        databasePath: join(directory, `${attempt}.sqlite3`),
        hostVersion: 'isolated-test',
        port: 0,
        supervisorPort: 0,
        supervisorBindHost: '127.0.0.1',
        supervisorAdvertiseHost: '192.0.2.7',
        supervisorRelay: null,
        startupTimeline: new HostStartupTimeline((phase, ms) => {
          phases[phase] = ms
        }),
        providerDiscoveryForTests: {
          discoverCodex: discovery,
          discoverClaude: discovery,
        },
      })
      try {
        for (let n = 0; probes < 2 && n < 100; n++)
          await new Promise((resolve) => setTimeout(resolve, 10))
        assert.equal(probes, 2)
        assert.equal(phases.PROVIDER_DISCOVERY_DONE, undefined)
        assert.ok(phases.LOCAL_READY < 15_000)
        assert.ok(phases.PRODUCT_API_4317_LISTENING <= phases.LOCAL_READY)
        assert.ok(phases.SUPERVISOR_4318_LISTENING <= phases.LOCAL_READY)
        assert.equal(
          (await fetch(`${host.baseUrl}/api/v1/bootstrap`)).status,
          200,
        )
        // Hold discovery unresolved AFTER local reads work, rather than just
        // increasing any launch timeout. No real Provider process is started.
        await new Promise((resolve) => setTimeout(resolve, 1200))
        assert.equal(phases.PROVIDER_DISCOVERY_DONE, undefined)
        assert.equal(
          (await fetch(`${host.baseUrl}/api/v1/machines`)).status,
          200,
        )
        release()
        for (
          let n = 0;
          phases.PROVIDER_DISCOVERY_DONE === undefined && n < 100;
          n++
        )
          await new Promise((resolve) => setTimeout(resolve, 10))
        assert.ok(phases.PROVIDER_DISCOVERY_DONE > phases.LOCAL_READY + 1000)
        timings.push(phases)
      } finally {
        release()
        await host.close()
      }
    }
    process.stdout.write(
      `ISOLATED_WINDOWS_STARTUP_TIMINGS=${JSON.stringify(timings)}\n`,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Host shutdown cancels discovery before closing durable state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-startup-cancel-'))
  let aborted = 0
  let started = 0
  const discovery = async ({ signal }) => {
    started++
    await new Promise((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          aborted++
          resolve()
        },
        { once: true },
      ),
    )
    signal.throwIfAborted()
    return { installations: [], truncated: false }
  }
  try {
    const host = await startLocalCodexHost({
      allowedOrigins: [],
      databasePath: join(directory, 'state.sqlite3'),
      hostVersion: 'test',
      port: 0,
      supervisorRelay: null,
      providerDiscoveryForTests: {
        discoverCodex: discovery,
        discoverClaude: discovery,
      },
    })
    for (let n = 0; started < 2 && n < 100; n++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(started, 2)
    await host.close()
    assert.equal(aborted, 2)
    await host.close()
    assert.equal(aborted, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
