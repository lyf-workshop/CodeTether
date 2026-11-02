import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/render-ui.mjs'

const filename = resolve(
  import.meta.dirname,
  '../src/components/conversations/new-conversation-fields.tsx',
)
const requireDependency = createRequire(filename)
const ui = {
  ...loadUiComponent('components/select.tsx'),
  ...loadUiComponent('components/product/agent-badge.tsx'),
  ...loadUiComponent('lib/cn.ts'),
}
const module = { exports: {} }
const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText
new Function('require', 'module', 'exports', output)(
  (specifier) =>
    specifier === '@codetether/ui' ? ui : requireDependency(specifier),
  module,
  module.exports,
)
const { NewConversationFields } = module.exports

const project = {
  key: 'project_123:machine_local',
  projectId: 'project_123',
  machineId: 'machine_local',
  project: { name: 'Folder With A Long Name' },
  location: { rootPath: 'D:\\work\\folder' },
  machine: { kind: 'local', displayName: '本机' },
}
const provider = {
  provider: 'codex',
  agent: 'codex',
  displayName: 'Codex',
  capabilities: { reasoningControl: false, fileEdit: true, shell: true },
  reasoningOptions: [],
  reasoningLabel: '推理强度',
}
const option = { provider, eligibility: { eligible: true, label: '可用' } }
const base = {
  groups: [{ machineId: project.machineId, label: '本机', choices: [project] }],
  project,
  fixed: false,
  loading: false,
  busy: false,
  providerOptions: [option],
  selectedProvider: option,
  defaultReasoning: '__provider_default__',
  formId: 'new-conversation',
  onProjectChange() {},
  onProviderChange() {},
  onReasoningChange() {},
}
const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(NewConversationFields, { ...base, ...props }),
  )

test('new dialog fields render project, tool, then descriptor-supported reasoning without a model or message', () => {
  const item = {
    ...provider,
    capabilities: { ...provider.capabilities, reasoningControl: true },
    reasoningOptions: [{ id: 'effort-high', label: '深入' }],
    reasoningLabel: '思考投入',
  }
  const selected = { ...option, provider: item }
  const html = render({
    providerOptions: [selected],
    selectedProvider: selected,
  })
  assert.ok(html.indexOf('项目') < html.indexOf('AI 工具'))
  assert.ok(html.indexOf('AI 工具') < html.indexOf('思考投入'))
  assert.match(html, /aria-label="选择项目"/u)
  assert.match(html, /type="radio"[^>]*checked=""[^>]*value="codex"/u)
  assert.match(html, /aria-label="选择思考投入"/u)
  assert.doesNotMatch(html, /选择模型|选择运行电脑|textarea|type="text"/u)
})

test('fixed project row is locked and displays its exact device and full path title', () => {
  const html = render({ fixed: true })
  assert.match(html, /当前项目已固定/u)
  assert.match(html, /title="D:\\work\\folder"/u)
  assert.match(html, /本机/u)
  assert.doesNotMatch(html, /aria-label="选择项目"/u)
})

test('reasoning selector is absent when capability or descriptor options do not support it', () => {
  assert.doesNotMatch(render(), /aria-label="选择推理强度"/u)
  const item = {
    ...provider,
    capabilities: { ...provider.capabilities, reasoningControl: true },
  }
  assert.doesNotMatch(
    render({ selectedProvider: { ...option, provider: item } }),
    /aria-label="选择推理强度"/u,
  )
})

test('unavailable provider cards are disabled and explain the canonical reason', () => {
  const blocked = {
    ...option,
    eligibility: { eligible: false, label: '当前安装需要登录' },
  }
  const html = render({ providerOptions: [blocked], selectedProvider: blocked })
  assert.match(html, /type="radio"[^>]*disabled=""/u)
  assert.match(html, /当前安装需要登录/u)
})

test('unavailable project suppresses tool controls while keeping the project/device context visible', () => {
  const html = render({
    project: { ...project, unavailableReason: '设备离线' },
  })
  assert.match(html, /Folder With A Long Name/u)
  assert.doesNotMatch(html, /type="radio"/u)
})

test('remote restrictions derive from descriptor capabilities rather than provider names', () => {
  const remote = {
    ...project,
    machine: { ...project.machine, kind: 'remote', displayName: '构建节点' },
  }
  const html = render({ project: remote })
  assert.match(html, /在 构建节点 上运行时，这里不能停止或审批命令。/u)
  const complete = {
    ...option,
    provider: {
      ...provider,
      capabilities: {
        ...provider.capabilities,
        interrupt: true,
        approvals: true,
      },
    },
  }
  assert.doesNotMatch(
    render({ project: remote, selectedProvider: complete }),
    /不能停止或审批/u,
  )
})

test('busy creation prevents both project and provider changes without hiding selection context', () => {
  const html = render({ busy: true })
  assert.match(html, /role="combobox"[^>]*disabled=""/u)
  assert.match(html, /type="radio"[^>]*disabled=""/u)
  assert.match(html, /Folder With A Long Name/u)
})

test('provider capability copy states only the actual descriptor capabilities', () => {
  for (const [enabled, expected] of [
    [['fileRead'], '可以读取文件'],
    [['search'], '可以搜索文件'],
    [['fileRead', 'search'], '可以读取和搜索文件'],
    [['fileEdit'], '可以编辑文件'],
    [['shell'], '可以运行命令'],
    [['fileEdit', 'shell'], '可以编辑文件和运行命令'],
    [[], '可恢复的流式会话'],
  ]) {
    const capabilities = {
      reasoningControl: false,
      fileRead: enabled.includes('fileRead'),
      search: enabled.includes('search'),
      fileEdit: enabled.includes('fileEdit'),
      shell: enabled.includes('shell'),
    }
    const selected = { ...option, provider: { ...provider, capabilities } }
    const html = render({
      providerOptions: [selected],
      selectedProvider: selected,
    })
    assert.ok(html.includes(expected), enabled.join('+') + ': ' + expected)
    if (!capabilities.fileRead) assert.doesNotMatch(html, /可以读取/u)
    if (!capabilities.search) assert.doesNotMatch(html, /搜索文件/u)
    if (!capabilities.fileEdit) assert.doesNotMatch(html, /可以编辑/u)
    if (!capabilities.shell) assert.doesNotMatch(html, /运行命令/u)
  }
})
