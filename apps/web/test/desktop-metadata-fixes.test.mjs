import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'
import { CodeTetherResponseError } from '@codetether/client'

const at = '2026-10-19T00:00:00.000Z'
const local = {
  machineId: 'machine_s7local01',
  displayName: '这台电脑',
  kind: 'local',
  isLocal: true,
  platform: 'windows',
  architecture: 'x64',
  availability: 'available',
  connectionState: 'local',
  capabilities: { projectAccess: true, providerExecution: true },
}
const remote = {
  ...local,
  machineId: 'machine_s7remote01',
  displayName: '远程服务器',
  kind: 'remote',
  isLocal: false,
  platform: 'linux',
  connectionState: 'online',
}
const project = {
  projectId: 'proj_s7shared01',
  name: '旧项目',
  locations: [
    {
      machineId: local.machineId,
      rootPath: 'D:\\共享项目',
      availability: 'available',
    },
    {
      machineId: remote.machineId,
      rootPath: '/home/test/共享项目',
      availability: 'available',
    },
  ],
  createdAt: at,
  updatedAt: at,
}
const conversation = {
  conversationId: 'conv_s7local01',
  projectId: project.projectId,
  machineId: local.machineId,
  provider: 'codex',
  status: 'running',
  lastActivityAt: at,
}

test('device overview reads one project index and zero per-machine details, preserving exact location cards', async () => {
  const f = metadataUiFixture({
    machines: [remote, local],
    projects: [project],
    conversations: [conversation],
  })
  const { MachinesPage } = f.load('components/machines/machines-page.tsx')
  const html = f.render(MachinesPage)
  assert.equal(f.fanout.length, 0)
  const index = f.reads.filter(
    (read) => read.enabled && read.queryKey[1] === 'projects',
  )
  assert.equal(index.length, 1)
  await index[0].queryFn({ signal: undefined })
  assert.equal(f.requests.filter(([kind]) => kind === 'projects').length, 1)
  assert.equal(f.requests.filter(([kind]) => kind === 'detail').length, 0)
  assert.ok(html.indexOf('这台电脑') < html.indexOf('远程服务器'))
  assert.ok(html.includes('D:\\共享项目'))
  assert.ok(html.includes('/home/test/共享项目'))
  assert.match(html, /Node 配对/u)
  assert.doesNotMatch(html, /通过 Relay|局域网直连/u)
})

test('visible project cards request cold metrics immediately; unobserved metrics never display zero', () => {
  const f = metadataUiFixture({
    machines: [local],
    projects: [project],
    conversations: [conversation],
  })
  const { MachineProjectsSection } = f.load(
    'components/machines/machine-projects-section.tsx',
  )
  const html = f.render(MachineProjectsSection, {
    machine: local,
    projects: [project],
    showAddCard: false,
  })
  assert.match(html, /1 个会话/u)
  assert.match(html, /1 个进行中/u)
  assert.ok(
    f.reads.some(
      (read) => read.queryKey[1] === 'project-conversations' && read.enabled,
    ),
  )
  assert.equal(f.requests.length, 0)
  f.state.conversations = undefined
  const unknown = f.render(MachineProjectsSection, {
    machine: local,
    projects: [project],
    showAddCard: false,
  })
  assert.doesNotMatch(unknown, /0 个会话/u)
})

test('shared project-index failure is explicit instead of empty device projects', () => {
  const f = metadataUiFixture({ machines: [remote], projects: [] })
  f.state.projectsFailed = true
  f.state.projectsUnknown = true
  const { MachinesPage } = f.load('components/machines/machines-page.tsx')
  const html = f.render(MachinesPage)
  assert.match(html, /暂时无法读取项目/u)
  assert.match(html, /重试/u)
  assert.doesNotMatch(html, /这台设备上还没有项目/u)
})

test('a registration race reports the exact changed target in Chinese without sending or falling back', async () => {
  const f = metadataUiFixture({ machines: [local, remote] })
  const { AddProjectDialog } = f.load(
    'components/projects/add-project-dialog.tsx',
  )
  f.render(AddProjectDialog, {
    fixedMachineId: remote.machineId,
    open: true,
    directoryPicker: { available: false },
  })
  f.state.machines = [
    local,
    { ...remote, connectionState: 'offline', availability: 'unavailable' },
  ]
  const mutation = f.mutations[0]
  let failure
  await assert.rejects(
    mutation.mutationFn({
      machineId: remote.machineId,
      path: '/home/test/项目',
    }),
    (error) => {
      failure = error
      assert.equal(error.name, 'ProjectCreationMachineUnavailableError')
      assert.match(error.message, /恢复在线后/u)
      return true
    },
  )
  f.state.mutationError = failure
  const html = f.render(AddProjectDialog, {
    fixedMachineId: remote.machineId,
    open: true,
    directoryPicker: { available: false },
  })
  assert.match(html, /恢复在线后才能在这台设备上添加项目/u)
  assert.doesNotMatch(html, /暂时无法连接，请重试|Selected Machine/u)
  assert.equal(f.requests.length, 0)
})

test('registration rechecks live Host connection after the dialog was rendered', async () => {
  const f = metadataUiFixture({ machines: [local, remote] })
  const { AddProjectDialog } = f.load(
    'components/projects/add-project-dialog.tsx',
  )
  f.render(AddProjectDialog, {
    fixedMachineId: remote.machineId,
    open: true,
    directoryPicker: { available: false },
  })
  f.state.connection = 'reconnecting'
  await assert.rejects(
    f.mutations[0].mutationFn({ machineId: remote.machineId, path: '/test' }),
    /恢复连接后/u,
  )
  assert.equal(f.requests.length, 0)
})

for (const refreshFails of [false, true]) {
  test(`canonical folder race refreshes once without replay and reports actual refresh result: ${refreshFails}`, async () => {
    const f = metadataUiFixture({
      machines: [local, remote],
      projects: [project],
    })
    const conflict = new CodeTetherResponseError(409, {
      protocolVersion: 1,
      code: 'project_location_conflict',
      message: 'synthetic private conflict',
    })
    f.runtime.createRemoteProject = async () => {
      f.requests.push(['create'])
      throw conflict
    }
    if (refreshFails)
      f.runtime.listProjects = async () => {
        f.requests.push(['projects'])
        throw new Error('synthetic offline')
      }
    const { AddProjectDialog } = f.load(
      'components/projects/add-project-dialog.tsx',
    )
    const props = {
      fixedMachineId: remote.machineId,
      open: true,
      directoryPicker: { available: false },
    }
    f.render(AddProjectDialog, props)
    let failure
    await assert.rejects(
      f.mutations[0].mutationFn({
        machineId: remote.machineId,
        path: '/home/test/共享项目',
      }),
      (error) => {
        failure = error
        assert.equal(error.name, 'ProjectFolderRegistrationConflictError')
        assert.equal(error.listUpdated, !refreshFails)
        return true
      },
    )
    f.state.mutationError = failure
    const html = f.render(AddProjectDialog, props)
    if (refreshFails) {
      assert.match(html, /列表暂时无法更新/u)
      assert.doesNotMatch(html, /列表已更新/u)
    } else assert.match(html, /这个文件夹刚被添加过，列表已更新/u)
    assert.equal(f.requests.filter(([kind]) => kind === 'create').length, 1)
    assert.equal(f.requests.filter(([kind]) => kind === 'projects').length, 1)
    assert.doesNotMatch(html, /synthetic private conflict/u)
  })
}

test('an unrelated 409 is never called a duplicate folder or retried', async () => {
  const f = metadataUiFixture({ machines: [local, remote] })
  const conflict = new CodeTetherResponseError(409, {
    protocolVersion: 1,
    code: 'conflict',
    message: 'synthetic unrelated conflict',
  })
  f.runtime.createRemoteProject = async () => {
    f.requests.push(['create'])
    throw conflict
  }
  const { AddProjectDialog } = f.load(
    'components/projects/add-project-dialog.tsx',
  )
  const props = {
    fixedMachineId: remote.machineId,
    open: true,
    directoryPicker: { available: false },
  }
  f.render(AddProjectDialog, props)
  await assert.rejects(
    f.mutations[0].mutationFn({ machineId: remote.machineId, path: '/test' }),
    (error) => error === conflict,
  )
  f.state.mutationError = conflict
  const html = f.render(AddProjectDialog, props)
  assert.doesNotMatch(html, /这个文件夹刚被添加过|列表已更新/u)
  assert.match(html, /项目状态已经变化/u)
  assert.deepEqual(f.requests, [['create']])
})

test('shared checkbox renders a labelled keyboard control with checked, mixed and disabled semantics', () => {
  const { Checkbox } = loadUiComponent('components/checkbox.tsx')
  const html = renderToStaticMarkup(
    h(Checkbox, { 'aria-label': '选择旧会话', checked: true, disabled: false }),
  )
  assert.match(html, /role="checkbox"/u)
  assert.match(html, /aria-label="选择旧会话"/u)
  assert.match(html, /aria-checked="true"/u)
  assert.match(html, /data-slot="checkbox"/u)
  const mixed = renderToStaticMarkup(
    h(Checkbox, {
      'aria-label': '选择结果',
      checked: 'indeterminate',
      disabled: true,
    }),
  )
  assert.match(mixed, /aria-checked="mixed"/u)
  assert.match(mixed, /disabled=""/u)
})

test('actual previous-session row uses the shared labelled checkbox without changing default selection', () => {
  const f = metadataUiFixture({
    candidates: [
      {
        discoveryCandidateId: 'candidate_s7resume01',
        title: '以前的工作',
        provider: 'codex',
        machineId: local.machineId,
        resumeStatus: 'supported',
        alreadyAdopted: false,
        createdAt: at,
      },
    ],
  })
  const { PreviousConversationsStep } = f.load(
    'components/projects/previous-conversations-step.tsx',
  )
  const html = f.render(PreviousConversationsStep, {
    projectId: project.projectId,
    machineId: local.machineId,
    presentation: 'embedded',
    onFinished() {},
  })
  assert.match(html, /data-slot="checkbox"/u)
  assert.match(html, /aria-label="选择 以前的工作"/u)
  assert.match(html, /aria-checked="true"/u)
  assert.match(html, /导入所选/u)
  assert.equal(f.requests.length, 0)
})

test('unpair entry and already-open confirmation both honor current Host readiness', async () => {
  const f = metadataUiFixture({ machines: [remote] })
  const { MachineConnectionSection } = f.load(
    'components/machines/machine-detail-page.tsx',
  )
  const html = f.render(MachineConnectionSection, {
    machine: remote,
    connection: {
      state: 'online',
      currentEndpoint: { host: 'test.local', port: 4318 },
    },
    hostReady: false,
    onUnpair() {},
  })
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?取消配对/u)
  const { UnpairMachineDialog } = f.load(
    'components/machines/unpair-machine-dialog.tsx',
  )
  f.render(UnpairMachineDialog, {
    machine: remote,
    projects: [],
    open: true,
    onOpenChange() {},
  })
  const mutation = f.mutations.at(-1)
  f.state.connection = 'reconnecting'
  await assert.rejects(mutation.mutationFn(), /恢复连接后/u)
  assert.equal(f.requests.length, 0)
})

test('shared layout tokens keep exact existing media boundaries and compact sidebar size', () => {
  const { workspaceLayoutTokens, workspaceLayoutMedia } = loadWebComponent(
    'components/app-shell/workspace-layout-tokens.ts',
  )
  assert.equal(workspaceLayoutTokens.compactSidebarWidth, 224)
  assert.equal(workspaceLayoutTokens.narrowDesktopMaximum, 1180)
  assert.equal(workspaceLayoutTokens.compactWorkspaceMaximum, 1000)
  assert.equal(workspaceLayoutTokens.phoneMaximum, 600)
  assert.equal(workspaceLayoutTokens.themeGridMinimum, 390)
  assert.equal(workspaceLayoutMedia.narrowDesktop, '(max-width: 1180px)')
})

test('named layout variants compile and agree with the shared JavaScript breakpoint contract', async () => {
  const { workspaceLayoutTokens: t } = loadWebComponent(
    'components/app-shell/workspace-layout-tokens.ts',
  )
  const css = await readFile(
    new URL('../../../packages/ui/src/styles/globals.css', import.meta.url),
    'utf8',
  )
  for (const [name, operator, expected] of [
    ['narrow-desktop', '<=', t.narrowDesktopMaximum],
    ['compact-workspace', '<=', t.compactWorkspaceMaximum],
    ['expanded-workspace', '>=', t.compactWorkspaceMaximum + 1],
    ['phone', '<=', t.phoneMaximum],
    ['above-phone', '>=', t.phoneMaximum + 1],
    ['theme-grid', '>=', t.themeGridMinimum],
  ]) {
    const expression = new RegExp(
      '@custom-variant ' +
        name +
        ' \\(@media \\(width ' +
        operator +
        ' ([0-9.]+)rem\\)\\);',
      'u',
    )
    assert.equal(
      Number(expression.exec(css)?.[1]) * 16,
      expected,
      name + ' exact inclusive edge',
    )
  }
  const { compile } = createRequire(
    new URL('../../../packages/ui/package.json', import.meta.url),
  )('tailwindcss')
  const output = (
    await compile(
      css.replace(/^@(?:import|source)[^;]+;\s*/gmu, '') +
        '\n@tailwind utilities;',
    )
  ).build([
    'narrow-desktop:sr-only',
    'compact-workspace:gap-6',
    'expanded-workspace:grid-cols-2',
    'phone:grid-cols-1',
    'above-phone:hidden',
    'theme-grid:grid-cols-3',
    'min-h-(--layout-startup-min-height)',
  ])
  for (const name of [
    'narrow-desktop',
    'compact-workspace',
    'expanded-workspace',
    'phone',
    'above-phone',
    'theme-grid',
  ])
    assert.ok(
      output.includes('.' + name + '\\:'),
      name + ' emits a real utility',
    )
  assert.match(output, /min-height: var\(--layout-startup-min-height\)/u)
})
