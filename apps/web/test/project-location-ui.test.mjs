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
  assert.match(unpair, /不会自动删除这些位置，因此暂时不能取消配对/u)
})

async function source(relativePath) {
  return await readFile(resolve(sourceRoot, relativePath), 'utf8')
}
