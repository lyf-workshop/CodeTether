import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSelectedDirectoryPresentation,
  projectAddActionLabel,
} from '../.tmp/test-dist/components/projects/add-project-presentation.js'
import { runProjectDirectoryPicker } from '../.tmp/test-dist/components/projects/add-project-directory-interaction.js'
import {
  createNativeCapabilities,
  hasTauriRuntime,
} from '../.tmp/test-dist/runtime/native/native-capabilities.js'

test('Browser capability stays unavailable without loading Tauri code', async () => {
  let loadCalls = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: false,
    loadTauriCore: async () => {
      loadCalls += 1
      throw new Error('Browser must not load Tauri')
    },
  })

  assert.equal(hasTauriRuntime({}), false)
  assert.equal(hasTauriRuntime({ isTauri: true }), true)
  assert.equal(hasTauriRuntime({ isTauri: false }), false)
  assert.equal(capabilities.directoryPicker.available, false)
  await assert.rejects(
    capabilities.directoryPicker.pickDirectory(),
    /unavailable/u,
  )
  assert.equal(loadCalls, 0)
})

test('Desktop capability invokes only the narrow project directory command', async () => {
  const calls = []
  const selectedPath =
    'C:\\Users\\Administrator\\My Projects\\项目测试\\我的 Agent 项目'
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command) => {
        calls.push(command)
        return selectedPath
      },
    }),
  })

  assert.equal(capabilities.directoryPicker.available, true)
  assert.equal(await capabilities.directoryPicker.pickDirectory(), selectedPath)
  assert.deepEqual(calls, ['pick_project_directory'])
})

test('Native picker cancellation is a null result and errors remain rejectable', async () => {
  const cancelled = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({ invoke: async () => null }),
  })
  assert.equal(await cancelled.directoryPicker.pickDirectory(), null)

  const failed = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async () => {
        throw new Error('native failure details')
      },
    }),
  })
  await assert.rejects(
    failed.directoryPicker.pickDirectory(),
    /native failure/u,
  )
})

test('Add Project picker preserves the dialog on cancel and restores focus', async () => {
  let focusCalls = 0
  const outcome = await runProjectDirectoryPicker(
    {
      available: true,
      pickDirectory: async () => null,
    },
    () => {
      focusCalls += 1
    },
  )

  assert.deepEqual(outcome, { kind: 'cancelled' })
  assert.equal(focusCalls, 1)
})

test('Add Project picker returns selected paths and restores focus', async () => {
  const selectedPath =
    'C:\\Users\\Administrator\\My Projects\\项目测试\\我的 Agent 项目'
  let focusCalls = 0
  const outcome = await runProjectDirectoryPicker(
    {
      available: true,
      pickDirectory: async () => selectedPath,
    },
    () => {
      focusCalls += 1
    },
  )

  assert.deepEqual(outcome, { kind: 'selected', path: selectedPath })
  assert.equal(focusCalls, 1)
})

test('Add Project picker converts native failures to safe UI state and restores focus', async () => {
  let focusCalls = 0
  const outcome = await runProjectDirectoryPicker(
    {
      available: true,
      pickDirectory: async () => {
        throw new Error('native implementation details')
      },
    },
    () => {
      focusCalls += 1
    },
  )

  assert.deepEqual(outcome, { kind: 'error' })
  assert.equal(focusCalls, 1)
})

test('Rapid picker clicks share one in-flight native dialog', async () => {
  const pending = deferred()
  let invokeCalls = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async () => {
        invokeCalls += 1
        return await pending.promise
      },
    }),
  })

  const first = capabilities.directoryPicker.pickDirectory()
  const second = capabilities.directoryPicker.pickDirectory()
  assert.strictEqual(second, first)
  await Promise.resolve()
  assert.equal(invokeCalls, 1)

  pending.resolve('C:\\workspaces\\one')
  assert.equal(await first, 'C:\\workspaces\\one')
})

test('Selected directory presentation preserves long, spaced and Unicode paths', () => {
  const unicode = createSelectedDirectoryPresentation(
    'C:\\Users\\lyfff\\My Projects\\项目测试\\我的 Agent 项目\\',
  )
  assert.deepEqual(unicode, {
    name: '我的 Agent 项目',
    path: 'C:\\Users\\lyfff\\My Projects\\项目测试\\我的 Agent 项目\\',
  })

  const longName = '很长的目录名'.repeat(20)
  const long = createSelectedDirectoryPresentation(`D:/work/${longName}`)
  assert.equal(long.name, longName)
  assert.equal(long.path, `D:/work/${longName}`)
  assert.equal(projectAddActionLabel(true), '选择文件夹')
  assert.equal(projectAddActionLabel(false), '添加项目')
})

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
