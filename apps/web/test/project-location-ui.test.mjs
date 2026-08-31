import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const sourceRoot = resolve(import.meta.dirname, '../src')

test('Project Detail presents every durable Machine location without choosing a sole path', async () => {
  const [detail, locations, row, projectsPage] = await Promise.all([
    source('components/projects/project-detail-page.tsx'),
    source('components/projects/project-locations-section.tsx'),
    source('components/projects/project-row.tsx'),
    source('components/projects/projects-page.tsx'),
  ])

  assert.match(detail, /<ProjectLocationsSection/u)
  assert.match(detail, /project\.locations\.length/u)
  assert.doesNotMatch(detail, /soleProjectLocation/u)
  assert.match(locations, /project\.locations\.map/u)
  assert.match(locations, /key=\{location\.machineId\}/u)
  assert.match(locations, /to="\/machines\/\$machineId"/u)
  assert.match(locations, /远程机器当前离线/u)
  assert.match(locations, /truncate/u)
  assert.match(row, /primaryProjectLocation/u)
  assert.match(row, /共 \{project\.locations\.length\} 个位置/u)
  assert.doesNotMatch(projectsPage, /soleProjectLocation/u)
})

test('Add Location is a bounded, keyboard-accessible remote path registration flow', async () => {
  const dialog = await source(
    'components/projects/add-project-location-dialog.tsx',
  )

  assert.match(dialog, /runtime\.registerProjectLocation/u)
  assert.match(dialog, /machine\.capabilities\.projectAccess/u)
  assert.match(dialog, /machine\.connectionState === 'online'/u)
  assert.match(dialog, /registeredMachineIds\.has/u)
  assert.match(dialog, /candidates\.find/u)
  assert.match(dialog, /machine\.connectionState === 'online'/u)
  assert.match(dialog, /aria-label="选择远程机器"/u)
  assert.match(dialog, /ref=\{pathInputRef\}/u)
  assert.match(dialog, /onOpenAutoFocus/u)
  assert.match(dialog, /if \(!machineReady\) return/u)
  assert.match(dialog, /aria-invalid/u)
  assert.match(dialog, /aria-describedby/u)
  assert.match(dialog, /aria-busy=\{busy\}/u)
  assert.match(dialog, /role="alert"/u)
  assert.match(dialog, /showCloseButton=\{!busy\}/u)
  assert.match(dialog, /if \(!nextOpen && busy\) return/u)
  assert.match(dialog, /max-w-lg overflow-x-hidden/u)
  assert.match(dialog, /不浏览文件或执行命令/u)
  assert.doesNotMatch(
    dialog,
    /directoryPicker|nativeCapabilities|shell|invoke/u,
  )
})

test('Remote Location removal is explicit, metadata-only, and keyboard accessible', async () => {
  const [locations, dialog, actions] = await Promise.all([
    source('components/projects/project-locations-section.tsx'),
    source('components/projects/remove-project-location-dialog.tsx'),
    source('runtime/host/project-actions.ts'),
  ])

  assert.match(locations, /machine\?\.kind === 'remote'/u)
  assert.match(locations, /DropdownMenuTrigger/u)
  assert.match(locations, /更多工作区位置操作/u)
  assert.match(locations, /移除位置/u)
  assert.match(locations, /onCloseAutoFocus/u)
  assert.match(locations, /tabIndex=\{-1\}/u)
  assert.doesNotMatch(locations, /disabled=\{!machineReachable\}/u)

  assert.match(dialog, /runtime\.removeProjectLocation/u)
  assert.match(dialog, /移除工作区位置/u)
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

test('Remote Machine keeps Projects readable but execution and destructive unpair remain gated', async () => {
  const [detail, projects, unpair] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-projects-section.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
  ])

  assert.match(detail, /projects=\{machineQuery\.data\.projects\}/u)
  assert.match(
    detail,
    /<MachineProjectsSection machine=\{machine\} projects=\{projects\}/u,
  )
  assert.match(detail, /远程智能体与会话执行仍未启用/u)
  assert.match(detail, /disabled=\{projects\.length > 0\}/u)
  assert.match(projects, /projects\.map/u)
  assert.match(projects, /projectLocationForMachine/u)
  assert.match(unpair, /projectCount > 0/u)
  assert.match(unpair, /请先在对应的项目详情中明确移除这些位置/u)
  assert.match(unpair, /取消配对不会自动删除位置/u)
})

async function source(relativePath) {
  return await readFile(resolve(sourceRoot, relativePath), 'utf8')
}
