import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { AddProjectFields } = loadWebComponent(
  'components/projects/add-project-fields.tsx',
)
const local = machine('machine_local01', 'local')
const remote = machine('machine_remote01', 'remote')

test('Desktop local project form presents an editable path and native picker together', () => {
  const markup = render({ canPickDirectory: true })
  assert.match(markup, /<input[^>]+id="add-project-path"/u)
  assert.match(markup, /id="add-project-directory-picker"/u)
  assert.match(markup, /选择文件夹/u)
  assert.match(markup, /或输入这台电脑上的完整路径/u)
  assert.match(markup, /htmlFor="add-project-path"|for="add-project-path"/u)
})

test('Browser form retains manual local path entry without a fake native action', () => {
  const markup = render({ canPickDirectory: false })
  assert.match(markup, /<input[^>]+id="add-project-path"/u)
  assert.doesNotMatch(markup, /id="add-project-directory-picker"/u)
  assert.match(markup, /输入或粘贴这台电脑上的完整路径/u)
})

test('paired device form explains complete remote paths without a filesystem browser', () => {
  const markup = render({
    machine: remote,
    path: '/home/test/中文 有空格',
    canPickDirectory: false,
  })
  assert.match(markup, /配对设备暂不支持浏览文件夹/u)
  assert.doesNotMatch(markup, /id="add-project-directory-picker"/u)
  assert.match(markup, /value="\/home\/test\/中文 有空格"/u)
})

test('fixed device entry cannot silently become a target-selection control', () => {
  const markup = render({ fixedMachine: true, machine: remote })
  assert.match(markup, /aria-label="已固定的设备"/u)
  assert.match(markup, /配对设备/u)
  assert.doesNotMatch(markup, /role="combobox"/u)
})

test('unknown or unavailable targets disable workspace input while preserving draft values', () => {
  const markup = render({
    ready: false,
    path: 'C:\\用户\\有 空格',
    name: '保留的名称',
  })
  assert.match(markup, /id="add-project-path"[^>]*disabled=""/u)
  assert.match(markup, /value="C:\\用户\\有 空格"/u)
  assert.match(markup, /value="保留的名称"/u)
})

test('form errors remain linked to the editable path for keyboard and screen-reader recovery', () => {
  const markup = render({ hasError: true })
  assert.match(
    markup,
    /aria-describedby="add-project-path-description add-project-error"/u,
  )
  assert.match(markup, /aria-invalid="true"/u)
})

function render(overrides = {}) {
  return renderToStaticMarkup(
    h(AddProjectFields, {
      machines: [local, remote],
      machine: local,
      fixedMachine: false,
      ready: true,
      busy: false,
      canPickDirectory: false,
      picking: false,
      path: '',
      name: '',
      hasError: false,
      pathInputRef: { current: null },
      pickerButtonRef: { current: null },
      onMachineChange() {},
      onPathChange() {},
      onNameChange() {},
      onPickDirectory() {},
      ...overrides,
    }),
  )
}

function machine(machineId, kind) {
  return {
    machineId,
    kind,
    displayName: kind === 'local' ? 'Windows 电脑' : '配对设备',
    platform: kind === 'local' ? 'windows' : 'linux',
    architecture: 'x64',
    availability: 'available',
    connectionState: kind === 'local' ? 'local' : 'online',
    trustState: kind === 'local' ? 'local' : 'trusted',
    isLocal: kind === 'local',
    createdAt: '2026-10-18T00:00:00.000Z',
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: true,
      nativeFolderPicker: kind === 'local',
      notifications: false,
    },
  }
}
