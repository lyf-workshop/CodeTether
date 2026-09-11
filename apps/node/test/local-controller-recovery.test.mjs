import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  MachineWireMessageSchema,
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  generateMachineTlsIdentity,
  newControllerId,
} from '@codetether/machine-transport'

import {
  LocalControllerRecoveryError,
  parseLocalControllerCommand,
  runLocalControllerCommand,
} from '../dist/local-controller-recovery.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import { NodeStateStore } from '../dist/state-store.js'

async function controller() {
  return {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
}

async function openState(directory, options = {}) {
  return await NodeStateStore.open({
    dataDirectory: directory,
    displayName: 'Recovery Node',
    platform: 'macOS',
    architecture: 'arm64',
    ...options,
  })
}

async function startNode(directory, port = 0) {
  const state = await openState(directory)
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port,
  })
  const address = await service.listen()
  return {
    state,
    service,
    endpoint: { host: '127.0.0.1', port: address.port },
  }
}

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

test('local recovery is targeted, confirmed, atomic, identity-preserving, and returns to normal pairing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-recovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const oldController = await controller()
  let running = await startNode(directory)
  const pairing = await running.service.enablePairing()
  const pending = await beginRemoteMachinePairing({
    endpoint: running.endpoint,
    pairingCode: pairing.code,
    controller: oldController,
  })
  const oldPeer = await pending.confirm()
  const originalMachine = { ...running.state.machine }
  const originalIdentityFingerprint =
    running.state.identity.publicKeyFingerprint
  const port = running.endpoint.port
  await running.service.close()

  const preservedFiles = [
    ['provider-installations.json', '{"provider":"preserved"}\n'],
    ['relay.json', '{"relay":"preserved"}\n'],
    ['project-state.json', '{"project":"preserved"}\n'],
  ]
  for (const [name, value] of preservedFiles) {
    await writeFile(join(directory, name), value, { mode: 0o600 })
  }
  const before = Object.fromEntries(
    await Promise.all(
      [
        'node.json',
        'node-identity.json',
        ...preservedFiles.map(([name]) => name),
      ].map(async (name) => [name, await digest(join(directory, name))]),
    ),
  )

  const options = {
    action: 'recover',
    dataDirectory: directory,
    controllerId: oldController.controllerId,
    json: false,
  }
  await assert.rejects(
    runLocalControllerCommand(options, { confirm: async () => 'wrong' }),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'confirmation_rejected',
  )
  let state = await openState(directory, { requireExisting: true })
  assert.equal(state.trustedControllerCount, 1)
  await state.close()

  const recovered = await runLocalControllerCommand(options, {
    confirm: async (target) => target.confirmation,
    now: () => new Date('2026-09-11T14:00:00.000Z'),
  })
  assert.equal(recovered.status, 'revoked')
  state = await openState(directory, { requireExisting: true })
  assert.equal(state.trustedControllerCount, 0)
  assert.deepEqual(state.machine, originalMachine)
  assert.equal(state.identity.publicKeyFingerprint, originalIdentityFingerprint)
  assert.equal(
    state.controllerRecoveryAudit(oldController.controllerId)?.result,
    'revoked',
  )
  await state.close()
  for (const [name, expected] of Object.entries(before)) {
    assert.equal(await digest(join(directory, name)), expected)
  }

  const repeated = await runLocalControllerCommand(options, {
    confirm: async () => {
      throw new Error('must not confirm an already completed recovery')
    },
  })
  assert.equal(repeated.status, 'already_revoked')

  running = await startNode(directory, port)
  await assert.rejects(
    connectTrustedRemoteMachine({
      peer: oldPeer,
      controller: oldController,
    }),
    /authentication|disabled|connection/u,
  )
  const newController = await controller()
  const replacementMode = await running.service.enablePairing()
  const replacementPending = await beginRemoteMachinePairing({
    endpoint: running.endpoint,
    pairingCode: replacementMode.code,
    controller: newController,
  })
  const replacementPeer = await replacementPending.confirm()
  const connected = await connectTrustedRemoteMachine({
    peer: replacementPeer,
    controller: newController,
  })
  await connected.ping()
  connected.close()
  assert.deepEqual(running.state.machine, originalMachine)
  await running.service.close()
})

test('running Node lock blocks local recovery and wrong target leaves trust intact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-recovery-lock-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const trusted = await controller()
  const running = await startNode(directory)
  await running.state.trustController({
    controllerId: trusted.controllerId,
    publicKeyFingerprint: trusted.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await assert.rejects(
    runLocalControllerCommand(
      {
        action: 'recover',
        dataDirectory: directory,
        controllerId: trusted.controllerId,
        json: false,
      },
      { confirm: async (target) => target.confirmation },
    ),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'active_node_operations',
  )
  assert.equal(running.state.trustedControllerCount, 1)
  await running.service.close()

  await assert.rejects(
    runLocalControllerCommand(
      {
        action: 'recover',
        dataDirectory: directory,
        controllerId: newControllerId(),
        json: false,
      },
      { confirm: async (target) => target.confirmation },
    ),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'target_controller_not_found',
  )
  const state = await openState(directory, { requireExisting: true })
  assert.equal(state.trustedControllerCount, 1)
  await state.close()
})

test('failed atomic recovery write retains the old trust and no audit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-recovery-write-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const trusted = await controller()
  let state = await openState(directory)
  await state.trustController({
    controllerId: trusted.controllerId,
    publicKeyFingerprint: trusted.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await state.close()
  await assert.rejects(
    runLocalControllerCommand(
      {
        action: 'recover',
        dataDirectory: directory,
        controllerId: trusted.controllerId,
        json: false,
      },
      {
        confirm: async (target) => target.confirmation,
        writeTrustState: async () => {
          throw new Error('injected atomic write failure')
        },
      },
    ),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'state_write_failed',
  )
  state = await openState(directory, { requireExisting: true })
  assert.equal(state.trustedControllerCount, 1)
  assert.equal(state.controllerRecoveryAudit(trusted.controllerId), undefined)
  await state.close()
})

test('production CLI rejects non-interactive recovery without mutating trust', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-recovery-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const trusted = await controller()
  let state = await openState(directory)
  await state.trustController({
    controllerId: trusted.controllerId,
    publicKeyFingerprint: trusted.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await state.close()
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../dist/main.js', import.meta.url)),
      'controller',
      'recover',
      '--data-dir',
      directory,
      '--controller',
      trusted.controllerId,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
  )
  child.stdout.resume()
  let stderr = ''
  child.stderr.on('data', (value) => {
    stderr += value.toString()
  })
  const [exitCode] = await once(child, 'close')
  assert.equal(exitCode, 1)
  assert.match(stderr, /confirmation_rejected/u)
  state = await openState(directory, { requireExisting: true })
  assert.equal(state.trustedControllerCount, 1)
  await state.close()
})

test('recovery requires existing state, an explicit target, and is absent from the remote protocol', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-recovery-empty-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(
    runLocalControllerCommand({
      action: 'list',
      dataDirectory: join(directory, 'missing'),
      json: false,
    }),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'existing_state_required',
  )
  assert.throws(
    () => parseLocalControllerCommand(['recover', '--data-dir', directory]),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'multiple_controllers_require_target',
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      type: 'controller.recover',
      controllerId: newControllerId(),
    }).success,
    false,
  )

  await mkdir(join(directory, 'state'))
  const state = await openState(join(directory, 'state'))
  await state.close()
  await assert.rejects(
    runLocalControllerCommand({
      action: 'recover',
      dataDirectory: join(directory, 'state'),
      controllerId: newControllerId(),
      json: false,
    }),
    (error) =>
      error instanceof LocalControllerRecoveryError &&
      error.code === 'no_trusted_controller',
  )
})
