import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const guardianModule = new URL(
  '../dist/provider-process-guardian.js',
  import.meta.url,
).href

test(
  'a finite Provider exit also releases its guardian',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async () => {
    const { spawnNodeProviderProcess } = await import(guardianModule)
    const controller = spawnNodeProviderProcess({
      provider: 'claude-code',
      executable: process.execPath,
      arguments: ['-e', "process.stdout.write('completed\\n')"],
      environment: {},
    })
    let stdout = ''
    controller.child.stdout.setEncoding('utf8')
    controller.child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    try {
      await controller.ownershipEstablished
      const [code, signal] = await Promise.race([
        once(controller.child, 'close'),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('finite Provider guardian did not exit')),
            2_000,
          ),
        ),
      ])
      assert.equal(code, 0)
      assert.equal(signal, null)
      assert.equal(stdout, 'completed\n')
      assert.equal(processIsRunning(controller.child.pid), false)
    } finally {
      await controller.close().catch(() => undefined)
    }
  },
)

test(
  'hard Node-owner death cleans the exact Provider group and preserves unrelated work',
  { skip: process.platform === 'win32', timeout: 20_000 },
  async () => {
    const providerProgram = [
      "const { spawn } = require('node:child_process')",
      "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 60000)'], { shell: false, stdio: 'ignore' })",
      "process.stdout.write(JSON.stringify({ providerPid: process.pid, descendantPid: descendant.pid }) + '\\n')",
      'setInterval(() => undefined, 60000)',
    ].join(';')
    const guardianExecutable =
      process.env.CODETETHER_PROVIDER_GUARDIAN_TEST_EXECUTABLE
    const guardianLaunch =
      guardianExecutable === undefined
        ? undefined
        : {
            executable: guardianExecutable,
            arguments: ['--codetether-internal-provider-guardian'],
          }
    const ownerProgram = [
      `import { spawnNodeProviderProcess } from ${JSON.stringify(guardianModule)}`,
      `const controller = spawnNodeProviderProcess(${JSON.stringify({
        provider: 'codex',
        executable: process.execPath,
        arguments: ['-e', providerProgram],
        environment: {},
      })}, ${JSON.stringify(guardianLaunch)})`,
      'await controller.ownershipEstablished',
      "let buffered = ''",
      "controller.child.stdout.setEncoding('utf8')",
      "controller.child.stdout.on('data', (chunk) => { buffered += chunk; const end = buffered.indexOf('\\n'); if (end < 0) return; const owned = JSON.parse(buffered.slice(0, end)); process.stdout.write(JSON.stringify({ guardianPid: controller.child.pid, ...owned }) + '\\n') })",
      'setInterval(() => undefined, 60000)',
    ].join(';')
    const owner = spawn(
      process.execPath,
      ['--input-type=module', '--eval', ownerProgram],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const unrelated = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 60000)'],
      { shell: false, stdio: 'ignore' },
    )
    let owned
    try {
      owned = await readJsonLine(owner)
      assert.ok(processIsRunning(owned.guardianPid))
      assert.ok(processIsRunning(owned.providerPid))
      assert.ok(processIsRunning(owned.descendantPid))
      assert.ok(processIsRunning(unrelated.pid))

      process.kill(owner.pid, 'SIGKILL')
      await once(owner, 'close')

      await waitUntilStopped([
        owned.guardianPid,
        owned.providerPid,
        owned.descendantPid,
      ])
      assert.equal(processIsRunning(unrelated.pid), true)
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        process.kill(owner.pid, 'SIGKILL')
        await once(owner, 'close')
      }
      if (owned !== undefined && processIsRunning(owned.providerPid)) {
        signalExactGroup(owned.providerPid)
      }
      if (owned !== undefined && processIsRunning(owned.guardianPid)) {
        process.kill(owned.guardianPid, 'SIGKILL')
      }
      if (unrelated.exitCode === null && unrelated.signalCode === null) {
        unrelated.kill('SIGKILL')
        await once(unrelated, 'close')
      }
    }
  },
)

async function readJsonLine(child) {
  child.stdout.setEncoding('utf8')
  return await new Promise((resolve, reject) => {
    let buffered = ''
    const failed = (error) => reject(error)
    child.once('error', failed)
    child.once('close', (code) => {
      reject(new Error(`owner closed before reporting ownership (${code})`))
    })
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      const end = buffered.indexOf('\n')
      if (end < 0) return
      child.off('error', failed)
      resolve(JSON.parse(buffered.slice(0, end)))
    })
  })
}

async function waitUntilStopped(pids) {
  const deadline = Date.now() + 8_000
  while (pids.some(processIsRunning)) {
    if (Date.now() >= deadline) {
      throw new Error('exact Provider ownership tree survived parent death')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (process.platform !== 'linux') {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code !== 'ESRCH'
    }
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    return stat.split(' ')[2] !== 'Z'
  } catch (error) {
    return error?.code !== 'ENOENT'
  }
}

function signalExactGroup(processGroupId) {
  try {
    process.kill(-processGroupId, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}
