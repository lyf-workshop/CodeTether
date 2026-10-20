import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const model = loadWebComponent(
  'components/app-shell/workspace-sidebar-model.ts',
)
const { workspaceShortcut } = loadWebComponent(
  'components/app-shell/workspace-shortcuts.ts',
)
const localId = 'machine_local01'
const remoteId = 'machine_remote01'
const projectId = 'proj_workspace01'
const localKey = `${projectId}:${localId}`
const remoteKey = `${projectId}:${remoteId}`
const empty = () => ({
  collapsedMachineIds: new Set(),
  expandedProjectKeys: new Set(),
})
const encoded = (overrides) =>
  JSON.stringify({
    version: 1,
    collapsedMachineIds: [remoteId],
    expandedProjectKeys: [localKey, remoteKey],
    ...overrides,
  })

test('tree preference round-trip stores only validated IDs under a ct-prefixed key', () => {
  assert.match(model.workspaceTreeExpansionPreferenceKey, /^ct-/u)
  const expansion = {
    collapsedMachineIds: new Set([remoteId]),
    expandedProjectKeys: new Set([localKey, remoteKey]),
    revealedContext: 'ephemeral navigation only',
    records: [{ title: 'must not persist', rootPath: '/private/path' }],
  }
  const raw = model.serializeWorkspaceTreeExpansion(expansion)
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    collapsedMachineIds: [remoteId],
    expandedProjectKeys: [localKey, remoteKey],
  })
  assert.deepEqual(model.parseWorkspaceTreeExpansion(raw), {
    collapsedMachineIds: new Set([remoteId]),
    expandedProjectKeys: new Set([localKey, remoteKey]),
  })
  assert.doesNotMatch(raw, /revealedContext|records|private|title/u)
})

test('malformed, partial, foreign-version or record-bearing preferences are empty, not partially trusted', () => {
  for (const raw of [
    null,
    '',
    '{',
    'null',
    '[]',
    'true',
    '1',
    JSON.stringify({ version: 1 }),
    encoded({ version: 2 }),
    encoded({ collapsedMachineIds: ['machine_bad'] }),
    encoded({ expandedProjectKeys: [`${projectId}:${localId}:extra`] }),
    encoded({ expandedProjectKeys: [`${projectId}:machine_bad`] }),
    encoded({ expandedProjectKeys: [`/private/path:${localId}`] }),
    encoded({ collapsedMachineIds: [42] }),
    encoded({ expandedProjectKeys: [{}] }),
    encoded({ records: [{ title: 'do not trust' }] }),
  ])
    assert.deepEqual(
      model.parseWorkspaceTreeExpansion(raw),
      empty(),
      String(raw),
    )
})

test('tree preferences survive a new storage read and inaccessible storage stays harmless', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const expansion = model.parseWorkspaceTreeExpansion(encoded())
  model.writeWorkspaceTreeExpansion(storage, expansion)
  assert.deepEqual(model.readWorkspaceTreeExpansion(storage), expansion)
  const blocked = {
    getItem() {
      throw new Error('unavailable')
    },
    setItem() {
      throw new Error('unavailable')
    },
  }
  assert.deepEqual(model.readWorkspaceTreeExpansion(blocked), empty())
  assert.doesNotThrow(() =>
    model.writeWorkspaceTreeExpansion(blocked, expansion),
  )
})

test('reloaded preferences reveal the exact current path but preserve unrelated expanded locations', () => {
  const restored = model.parseWorkspaceTreeExpansion(
    encoded({ expandedProjectKeys: [localKey] }),
  )
  const current = model.revealWorkspacePath(restored, remoteId, projectId)
  assert.equal(current.collapsedMachineIds.has(remoteId), false)
  assert.deepEqual([...current.expandedProjectKeys], [localKey, remoteKey])
  const closed = model.toggleWorkspaceProject(
    model.toggleWorkspaceMachine(current, remoteId),
    remoteKey,
  )
  assert.equal(model.revealWorkspacePath(closed, remoteId, projectId), closed)
  const reloaded = model.parseWorkspaceTreeExpansion(
    model.serializeWorkspaceTreeExpansion(closed),
  )
  const navigated = model.revealWorkspacePath(reloaded, remoteId, projectId)
  assert.equal(navigated.collapsedMachineIds.has(remoteId), false)
  assert.equal(navigated.expandedProjectKeys.has(remoteKey), true)
  assert.equal(navigated.expandedProjectKeys.has(localKey), true)
})

test('Ctrl B and Command B classify one sidebar toggle, with existing shortcuts unchanged', () => {
  assert.equal(workspaceShortcut({ key: 'b', ctrlKey: true }), 'toggle-sidebar')
  assert.equal(workspaceShortcut({ key: 'B', metaKey: true }), 'toggle-sidebar')
  assert.equal(workspaceShortcut({ key: 'k', ctrlKey: true }), 'palette')
  assert.equal(
    workspaceShortcut({ key: 'n', metaKey: true }),
    'new-conversation',
  )
  assert.equal(workspaceShortcut({ key: ',', ctrlKey: true }), 'settings')
  assert.equal(workspaceShortcut({ key: 'b' }), undefined)
  for (const flag of [
    'altKey',
    'shiftKey',
    'repeat',
    'isComposing',
    'defaultPrevented',
  ])
    assert.equal(
      workspaceShortcut({ key: 'b', ctrlKey: true, [flag]: true }),
      undefined,
    )
  assert.equal(
    workspaceShortcut({ key: 'b', metaKey: true, keyCode: 229 }),
    undefined,
  )
})

test('sidebar shortcut leaves input, text area, selection and content editing keys alone', () => {
  for (const kind of [
    'input',
    'textarea',
    'select',
    'contenteditable',
    'textbox',
    'searchbox',
    'combobox',
  ]) {
    const target = {
      closest: (selector) => (selector.includes(kind) ? target : null),
    }
    assert.equal(
      workspaceShortcut({ key: 'b', ctrlKey: true, target }),
      undefined,
      kind,
    )
    assert.equal(
      workspaceShortcut({ key: 'b', metaKey: true, target }),
      undefined,
      kind,
    )
    assert.equal(
      workspaceShortcut({ key: 'k', ctrlKey: true, target }),
      'palette',
      'do not change existing Ctrl K',
    )
  }
  assert.equal(
    workspaceShortcut({
      key: 'b',
      ctrlKey: true,
      target: { closest: () => null },
    }),
    'toggle-sidebar',
  )
})

test('actual AppShell keyboard handler toggles the sidebar instead of navigating or interrupting a dialog', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/components/app-shell/app-shell.tsx'),
    'utf8',
  )
  const body = source.slice(
    source.indexOf('    function handleShortcut'),
    source.indexOf("    window.addEventListener('keydown'"),
  )
  const output = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2023 },
  }).outputText
  const { workspaceNavigationBlocked } = loadWebComponent(
    'components/app-shell/workspace-shortcuts.ts',
  )
  let collapsed = false
  const navigations = []
  const dialogRef = { current: null }
  const handler = new Function(
    'workspaceShortcut',
    'workspaceNavigationBlocked',
    'document',
    'globalDialogRef',
    'globalDialog',
    'setSidebarCollapsed',
    'navigate',
    output + '\nreturn handleShortcut',
  )(
    workspaceShortcut,
    workspaceNavigationBlocked,
    { querySelector: () => null },
    dialogRef,
    null,
    (update) => {
      collapsed = update(collapsed)
    },
    (target) => navigations.push(target),
  )
  handler({ key: 'b', ctrlKey: true, preventDefault() {} })
  assert.equal(collapsed, true)
  handler({ key: 'B', metaKey: true, preventDefault() {} })
  assert.equal(collapsed, false)
  dialogRef.current = 'new-conversation'
  handler({ key: 'b', ctrlKey: true, preventDefault() {} })
  assert.equal(collapsed, false)
  assert.deepEqual(navigations, [])
})

const sidebarPath = resolve(
  import.meta.dirname,
  '../src/components/app-shell/workspace-sidebar.tsx',
)
const webRoot = resolve(import.meta.dirname, '../src')
const requireDependency = createRequire(sidebarPath)
const ui = loadUiComponent('index.ts')
let hostState = 'connected'
let fixtureMachines = []
let fixtureProjects = []
const module = { exports: {} }
const output = ts.transpileModule(readFileSync(sidebarPath, 'utf8'), {
  fileName: sidebarPath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText
new Function('require', 'module', 'exports', output)(
  (specifier) => {
    if (specifier === '@codetether/ui') return ui
    if (specifier === '@tanstack/react-router')
      return {
        useNavigate: () => () => {},
        Link: ({
          to,
          children,
          className,
          title,
          'aria-current': ariaCurrent,
        }) =>
          h(
            'a',
            { className, title, 'aria-current': ariaCurrent, href: to },
            children,
          ),
      }
    if (specifier === '@tanstack/react-query')
      return {
        useQuery: (options) => ({
          data:
            options.queryKey[1] === 'machines'
              ? fixtureMachines
              : options.queryKey[1] === 'projects'
                ? fixtureProjects
                : options.enabled === false
                  ? undefined
                  : [],
          isError: false,
        }),
      }
    if (specifier === '../../runtime/host/host-runtime-hooks')
      return {
        useHostRuntime: () => ({}),
        useHostConnectionState: () => hostState,
      }
    if (specifier.startsWith('.'))
      return loadWebComponent(
        relative(webRoot, resolve(dirname(sidebarPath), specifier)),
      )
    return requireDependency(specifier)
  },
  module,
  module.exports,
)

const stamp = '2026-10-19T12:00:00.000Z'
function machine(overrides = {}) {
  return {
    machineId: localId,
    kind: 'local',
    displayName: '这台电脑',
    availability: 'available',
    connectionState: 'local',
    capabilities: { projectAccess: true, providerExecution: true },
    ...overrides,
  }
}
function renderSidebar({
  stored = null,
  machines = [machine()],
  current = {},
} = {}) {
  fixtureMachines = machines
  fixtureProjects = [
    {
      projectId,
      name: 'Shared project',
      locations: machines.map((machine) => ({
        projectId,
        machineId: machine.machineId,
        rootPath: '/work/' + machine.machineId,
        availability: 'available',
        createdAt: stamp,
        updatedAt: stamp,
      })),
    },
  ]
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => stored, setItem() {} } },
  })
  try {
    return renderToStaticMarkup(
      h(module.exports.WorkspaceSidebar, {
        currentPath: '/devices',
        onNewConversation() {},
        onAddProject() {},
        ...current,
      }),
    )
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else delete globalThis.window
  }
}

test('actual sidebar render restores collapsed devices and automatically reveals current route after reload', () => {
  const machines = [
    machine(),
    machine({
      machineId: remoteId,
      kind: 'remote',
      displayName: 'Remote',
      connectionState: 'online',
    }),
  ]
  const stored = encoded()
  const first = renderSidebar({ stored, machines })
  assert.match(first, /aria-label="展开设备：Remote"/u)
  assert.match(first, /aria-label="折叠项目：Shared project"/u)
  const current = renderSidebar({
    stored,
    machines,
    current: { currentMachineId: remoteId, currentProjectId: projectId },
  })
  assert.match(current, /aria-label="折叠设备：Remote"/u)
  assert.equal(
    (current.match(/aria-label="折叠项目：Shared project"/gu) ?? []).length,
    2,
  )
})

test('actual sidebar add-project entry uses canonical device capability including provider execution', () => {
  hostState = 'connected'
  assert.match(renderSidebar(), /aria-label="在 这台电脑 上添加项目"/u)
  for (const disabled of [
    machine({
      capabilities: { projectAccess: true, providerExecution: false },
    }),
    machine({
      capabilities: { projectAccess: false, providerExecution: true },
    }),
    machine({ availability: 'unavailable' }),
    machine({ connectionState: 'offline' }),
  ])
    assert.doesNotMatch(
      renderSidebar({ machines: [disabled] }),
      /aria-label="在 这台电脑 上添加项目"/u,
    )
  hostState = 'reconnecting'
  assert.doesNotMatch(renderSidebar(), /aria-label="在 这台电脑 上添加项目"/u)
  hostState = 'connected'
})

test('sidebar project creation is gated by typed capability and location facts rather than reason copy', () => {
  const source = readFileSync(sidebarPath, 'utf8')
  assert.match(source, /machineCanAddProject\(machine\)/u)
  const create = source.slice(
    source.indexOf('  const canCreate ='),
    source.indexOf('  return (', source.indexOf('  const canCreate =')),
  )
  assert.doesNotMatch(create, /unavailableReason/u)
  assert.match(create, /location\.availability === 'available'/u)
})
