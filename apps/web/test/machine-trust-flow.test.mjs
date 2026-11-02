import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MachinePairingFlow,
  getMachineTrustLease,
  runMachineTrustMutation,
} from '../.tmp/test-dist/components/machines/machine-trust-flow.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function runtime(overrides = {}) {
  const calls = []
  return {
    calls,
    async beginRemoteMachinePairing() {
      calls.push('begin')
      return { data: { candidate: { pairingAttemptId: 'attempt_one' } } }
    },
    async confirmRemoteMachinePairing(id) {
      calls.push(['confirm', id])
      return { data: { machine: { machineId: 'machine_one' } } }
    },
    async cancelRemoteMachinePairing(id) {
      calls.push(['cancel', id])
      return { data: {} }
    },
    ...overrides,
  }
}
const target = { kind: 'direct', address: { host: '192.0.2.2', port: 4318 } }

test('one runtime owns one synchronous UI lease while other runtimes are independent', async () => {
  const first = runtime()
  const second = runtime()
  const flow = new MachinePairingFlow(first)
  const begun = flow.begin(target, '123456')
  await assert.rejects(
    runMachineTrustMutation(first, async () => 'unpair'),
    /already active/u,
  )
  assert.equal(
    await runMachineTrustMutation(second, async () => 'independent'),
    'independent',
  )
  await begun
  assert.ok(getMachineTrustLease(first).getSnapshot())
  await flow.cancel('attempt_one')
  assert.equal(getMachineTrustLease(first).getSnapshot(), undefined)
})
test('begin keeps ownership until actual confirmation and sends only the exact attempt', async () => {
  const host = runtime()
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  await assert.rejects(flow.confirm('attempt_wrong'), /not current/u)
  await assert.rejects(
    runMachineTrustMutation(host, async () => true),
    /already active/u,
  )
  const confirmed = await flow.confirm('attempt_one')
  assert.equal(confirmed.data.machine.machineId, 'machine_one')
  assert.deepEqual(host.calls, ['begin', ['confirm', 'attempt_one']])
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('double submission cannot begin two Host operations', async () => {
  const response = deferred()
  let count = 0
  const host = runtime({
    beginRemoteMachinePairing() {
      count += 1
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  const first = flow.begin(target, '123456')
  await assert.rejects(flow.begin(target, '123456'), /already active/u)
  response.resolve({ data: { candidate: { pairingAttemptId: 'attempt_one' } } })
  await first
  assert.equal(count, 1)
  await flow.dispose()
})
test('failed begin releases ownership and does not retry automatically', async () => {
  let count = 0
  const host = runtime({
    async beginRemoteMachinePairing() {
      count += 1
      throw new Error('offline')
    },
  })
  const flow = new MachinePairingFlow(host)
  await assert.rejects(flow.begin(target, '123456'), /offline/u)
  assert.equal(count, 1)
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('failed confirm retains the actual attempt for explicit cancel instead of replay', async () => {
  let count = 0
  const host = runtime({
    async confirmRemoteMachinePairing() {
      count += 1
      throw new Error('expired')
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  await assert.rejects(flow.confirm('attempt_one'), /expired/u)
  assert.equal(count, 1)
  assert.ok(getMachineTrustLease(host).getSnapshot())
  await flow.cancel('attempt_one')
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('failed cancel keeps visible flow ownership until explicit retry or disposal', async () => {
  let count = 0
  const host = runtime({
    async cancelRemoteMachinePairing() {
      count += 1
      if (count === 1) throw new Error('offline')
      return { data: {} }
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  await assert.rejects(flow.cancel('attempt_one'), /offline/u)
  assert.ok(getMachineTrustLease(host).getSnapshot())
  await flow.cancel('attempt_one')
  assert.equal(count, 2)
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('late begin after unmount cancels only its own attempt and releases lease', async () => {
  const response = deferred()
  const host = runtime({
    beginRemoteMachinePairing() {
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  const begun = flow.begin(target, '123456')
  const disposed = flow.dispose()
  response.resolve({
    data: { candidate: { pairingAttemptId: 'attempt_late' } },
  })
  await assert.rejects(begun, /disposed/u)
  await disposed
  assert.deepEqual(host.calls, [['cancel', 'attempt_late']])
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('unmount during confirmation never revokes successfully created trust', async () => {
  const response = deferred()
  const host = runtime({
    confirmRemoteMachinePairing() {
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  const confirmed = flow.confirm('attempt_one')
  const disposed = flow.dispose()
  response.resolve({ data: { machine: { machineId: 'machine_one' } } })
  await confirmed
  await disposed
  assert.deepEqual(host.calls, ['begin'])
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
test('cleanup failure is bounded and cannot strand the frontend lease', async () => {
  let count = 0
  const host = runtime({
    async cancelRemoteMachinePairing() {
      count += 1
      throw new Error('offline')
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  await flow.dispose()
  assert.equal(count, 1)
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
  await flow.dispose()
  assert.equal(count, 1)
})
test('unpair errors release UI ownership without changing the Host error', async () => {
  const host = runtime()
  const original = new Error('machine_has_project_locations')
  await assert.rejects(
    runMachineTrustMutation(host, async () => {
      throw original
    }),
    (error) => error === original,
  )
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})

test('double confirmation sends exactly one request and does not queue trust work', async () => {
  const response = deferred()
  let count = 0
  const host = runtime({
    confirmRemoteMachinePairing() {
      count += 1
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  const confirmed = flow.confirm('attempt_one')
  await assert.rejects(flow.confirm('attempt_one'), /already active/u)
  response.resolve({ data: { machine: { machineId: 'machine_one' } } })
  await confirmed
  assert.equal(count, 1)
})

test('failed confirmation during disposal cancels its own attempt only once', async () => {
  const response = deferred()
  const host = runtime({
    confirmRemoteMachinePairing() {
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  const confirmed = flow.confirm('attempt_one')
  const disposed = flow.dispose()
  response.reject(new Error('transport unavailable'))
  await assert.rejects(confirmed, /transport unavailable/u)
  await disposed
  assert.deepEqual(host.calls, ['begin', ['cancel', 'attempt_one']])
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})

test('cancel failure while leaving is bounded and never automatically re-issued', async () => {
  const response = deferred()
  let count = 0
  const host = runtime({
    cancelRemoteMachinePairing() {
      count += 1
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  const cancelled = flow.cancel('attempt_one')
  const disposed = flow.dispose()
  response.reject(new Error('transport unavailable'))
  await assert.rejects(cancelled, /transport unavailable/u)
  await disposed
  assert.equal(count, 1)
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})

test('an old disposed flow cannot release a newly acquired generation', async () => {
  const host = runtime()
  const old = new MachinePairingFlow(host)
  await old.begin(target, '123456')
  await old.cancel('attempt_one')
  const current = new MachinePairingFlow(host)
  await current.begin(target, '123456')
  const token = getMachineTrustLease(host).getSnapshot()
  await old.dispose()
  assert.equal(getMachineTrustLease(host).getSnapshot(), token)
  await current.dispose()
})

test('begin cannot bypass a pending unpair request on the same runtime', async () => {
  const response = deferred()
  const host = runtime()
  const unpair = runMachineTrustMutation(
    host,
    async () => await response.promise,
  )
  const flow = new MachinePairingFlow(host)
  await assert.rejects(flow.begin(target, '123456'), /already active/u)
  assert.deepEqual(host.calls, [])
  response.resolve('removed')
  await unpair
  await flow.begin(target, '123456')
  await flow.dispose()
})

test('concurrent disposal is idempotent and retains ownership until bounded cleanup settles', async () => {
  const response = deferred()
  let count = 0
  const host = runtime({
    cancelRemoteMachinePairing() {
      count += 1
      return response.promise
    },
  })
  const flow = new MachinePairingFlow(host)
  await flow.begin(target, '123456')
  const first = flow.dispose()
  const second = flow.dispose()
  assert.ok(getMachineTrustLease(host).getSnapshot())
  await assert.rejects(
    runMachineTrustMutation(host, async () => true),
    /already active/u,
  )
  response.resolve({ data: {} })
  await Promise.all([first, second])
  assert.equal(count, 1)
  assert.equal(getMachineTrustLease(host).getSnapshot(), undefined)
})
