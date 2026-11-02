import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const sourceRoot = resolve(import.meta.dirname, '../src')

test('Project Detail requires an explicit device for legacy multi-location Projects', async () => {
  const [detail, model] = await Promise.all([
    source('components/projects/project-detail-page.tsx'),
    source('components/projects/project-workspace-model.ts'),
  ])
  assert.match(detail, /resolveProjectWorkspaceContext\(/u)
  assert.match(detail, /project\.locations\.map/u)
  assert.match(detail, /key=\{location\.machineId\}/u)
  assert.match(detail, /machineId: location\.machineId/u)
  assert.match(detail, /currentMachineId=\{location\.machineId\}/u)
  assert.match(detail, /title=\{location\.rootPath\}/u)
  assert.match(detail, /选择要查看的设备/u)
  assert.match(model, /project\.locations\.length !== 1/u)
  assert.match(model, /kind: 'choose-device'/u)
  assert.doesNotMatch(
    detail,
    /soleProjectLocation|primaryProjectLocation|AddProjectLocationDialog|RemoveProjectLocationDialog/u,
  )
})

test('Add Project uses keyboard-accessible exact remote path entry without local directory browsing', () => {
  const { AddProjectFields } = loadWebComponent(
    'components/projects/add-project-fields.tsx',
  )
  const render = (busy = false) =>
    renderToStaticMarkup(
      createElement(AddProjectFields, {
        machines: [],
        machine: {
          machineId: 'machine_remote01',
          kind: 'remote',
          displayName: '配对设备',
        },
        fixedMachine: true,
        ready: true,
        busy,
        canPickDirectory: false,
        picking: false,
        path: '/srv/项目',
        name: '项目',
        hasError: false,
        pathInputRef: { current: null },
        pickerButtonRef: { current: null },
        onMachineChange() {},
        onPathChange() {},
        onNameChange() {},
        onPickDirectory() {
          throw new Error('remote paths must not invoke a local picker')
        },
      }),
    )
  const html = render()
  assert.match(html, /aria-label="已固定的设备"/u)
  assert.match(html, /配对设备/u)
  assert.match(html, /for="add-project-path"/u)
  assert.match(html, /value="\/srv\/项目"/u)
  assert.match(html, /aria-describedby="add-project-path-description"/u)
  assert.match(html, /配对设备暂不支持浏览文件夹/u)
  assert.doesNotMatch(html, /id="add-project-directory-picker"/u)
  assert.match(render(true), /id="add-project-path"[^>]*disabled=""/u)
})

test('Remote Location removal is explicit, metadata-only, and keyboard accessible', async () => {
  const [locations, dialog, actions] = await Promise.all([
    source('components/projects/project-location-removal-action.tsx'),
    source('components/projects/remove-project-location-dialog.tsx'),
    source('runtime/host/project-actions.ts'),
  ])

  assert.match(
    locations,
    /machine\.kind !== 'remote' \|\| location === undefined/u,
  )
  assert.match(
    locations,
    /projectLocationForMachine\(project, machine\.machineId\)/u,
  )
  assert.match(locations, /从这台设备移除/u)
  assert.match(locations, /allProjectConversationsQueryOptions/u)
  assert.match(locations, /conversation\.machineId === machine\.machineId/u)
  assert.match(locations, /conversation\.archivedAt !== undefined/u)
  assert.match(locations, /triggerRef\.current \?\? returnFocus\?\.\(\)/u)

  assert.match(dialog, /runtime\.removeProjectLocation/u)
  assert.match(dialog, /从这台设备移除项目/u)
  assert.match(dialog, /远程目录/u)
  assert.match(dialog, /其中的文件不会被删除/u)
  assert.match(dialog, /不会删除项目/u)
  assert.match(dialog, /不会自动取消/u)
  assert.match(dialog, /role="alert"/u)
  assert.match(dialog, /showCloseButton=\{!busy\}/u)
  assert.match(dialog, /onCloseAutoFocus/u)
  assert.match(dialog, /returnFocus\(\)\?\.focus\(\)/u)
  assert.match(dialog, /max-w-md overflow-x-hidden/u)
  assert.doesNotMatch(
    dialog,
    /directoryPicker|nativeCapabilities|filesystem|shell|invoke/u,
  )

  assert.match(actions, /removeProjectLocation/u)
  assert.match(actions, /machineQueryKeys\.list/u)
  assert.match(actions, /machineQueryKeys\.detail\(machine\)/u)
  assert.match(actions, /project_location_has_conversations/u)
  assert.match(actions, /project_location_local_required/u)
})

test('Remote Machine keeps Projects readable while execution and unpair remain capability-gated', async () => {
  const [detail, projects, unpair, model] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-projects-section.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
    source('components/machines/device-project-model.ts'),
  ])
  assert.match(
    detail,
    /<MachineProjectsSection\s+machine=\{machine\}\s+projects=\{projects\}/u,
  )
  assert.match(detail, /machine\.capabilities\.providerExecution/u)
  assert.match(detail, /这台设备当前不能运行 AI 工具/u)
  assert.match(projects, /ownProjects\.map/u)
  assert.match(projects, /projectLocationForMachine/u)
  assert.match(projects, /machineId: machine\.machineId/u)
  assert.match(unpair, /unpairMachinePreflight/u)
  assert.match(unpair, /preflight\.projects\.map/u)
  assert.match(unpair, /blocked\s*\?\s*\(\s*<DialogClose/u)
  assert.match(unpair, /知道了/u)
  assert.match(unpair, /取消配对不会自动移除项目/u)
  assert.match(model, /blocked: bound\.length > 0/u)
  assert.doesNotMatch(
    detail + projects,
    /AddProjectLocationDialog|RemoveProjectLocationDialog/u,
  )
})

async function source(relativePath) {
  return await readFile(resolve(sourceRoot, relativePath), 'utf8')
}
