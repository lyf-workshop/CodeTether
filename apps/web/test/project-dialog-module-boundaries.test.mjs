import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as query from '@tanstack/react-query'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'

const projectSource = new URL('../src/components/projects/', import.meta.url)

test('project registration and previous-session modules each stay within the approved review bound', async () => {
  for (const path of [
    'add-project-dialog.tsx',
    'use-add-project-dialog.ts',
    'created-project-step.tsx',
    'previous-conversations-step.tsx',
    'use-previous-conversations.ts',
    'use-previous-conversations-selection.ts',
    'previous-conversations-view.tsx',
    'previous-conversations-presentation.ts',
  ]) {
    const content = await readFile(new URL(path, projectSource), 'utf8')
    assert.ok(
      content.trimEnd().split(/\r?\n/u).length <= 400,
      `${path} exceeds 400 lines`,
    )
  }
})

test('the extracted Add Project view renders target recovery instead of losing controller bindings', () => {
  const f = metadataUiFixture()
  f.state.connection = 'reconnecting'
  const { AddProjectDialog } = f.load(
    'components/projects/add-project-dialog.tsx',
  )
  const html = f.render(AddProjectDialog, {
    open: true,
    fixedMachineId: 'machine_split01',
  })
  assert.match(html, /CodeTether 暂时无法连接。恢复连接后可以继续添加项目。/u)
  assert.match(html, /<button[^>]*disabled=""[^>]*>添加<\/button>/u)
  assert.equal(f.requests.length, 0)
})

test('the extracted created-project step retains exact remote scope, polite success and completion arguments', async () => {
  const project = {
    projectId: 'proj_split01',
    name: '已有项目',
    locations: [
      { machineId: 'machine_local01', rootPath: 'C:\\Local' },
      { machineId: 'machine_remote01', rootPath: '/test/remote' },
    ],
  }
  let previousProps
  const dependencies = new Map([
    [
      '@tanstack/react-query',
      { ...query, useQuery: () => ({ data: project, isError: false }) },
    ],
    ['../../runtime/host/host-runtime-hooks', { useHostRuntime: () => ({}) }],
    [
      './previous-conversations-step',
      {
        PreviousConversationsStep: (props) => {
          previousProps = props
          return h('div', { 'data-discovery-machine': props.machineId })
        },
      },
    ],
  ])
  const { CreatedProjectStep } = loadWebComponent(
    'components/projects/created-project-step.tsx',
    dependencies,
  )
  const completed = []
  const { Dialog } = loadUiComponent('index.ts')
  const html = renderToStaticMarkup(
    h(
      Dialog,
      { open: true },
      h(CreatedProjectStep, {
        context: {
          projectId: project.projectId,
          machineId: 'machine_remote01',
          created: true,
        },
        machineName: '远程设备',
        onFinished: (...args) => {
          completed.push(args)
        },
      }),
    ),
  )
  assert.match(html, /role="status"/u)
  assert.match(html, /项目已添加/u)
  assert.match(html, /\/test\/remote/u)
  assert.doesNotMatch(html, /C:\\Local/u)
  assert.equal(previousProps.projectId, project.projectId)
  assert.equal(previousProps.machineId, 'machine_remote01')
  await previousProps.onFinished('reviewed')
  assert.deepEqual(completed, [[project, true, 'machine_remote01']])
})
