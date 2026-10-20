import assert from 'node:assert/strict'
import test from 'node:test'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'

const machine = {
  machineId: 'machine_r2sidebar01',
  displayName: '测试设备',
  kind: 'remote',
  connectionState: 'online',
  availability: 'available',
  capabilities: { projectAccess: true, providerExecution: true },
}
const reason = '设备恢复在线并可以运行 AI 工具后，即可添加项目。'

function renderDevice(value) {
  const fixture = metadataUiFixture({ machines: [value] })
  const { WorkspaceDeviceSection } = fixture.load(
    'components/app-shell/workspace-device-section.tsx',
  )
  const { MachineProjectsSection } = fixture.load(
    'components/machines/machine-projects-section.tsx',
  )
  return {
    fixture,
    sidebar: fixture.render(WorkspaceDeviceSection, {
      group: { machine: value, projects: [] },
      active: false,
      expanded: true,
      onExpandedChange() {},
      onAddProject() {
        assert.fail('rendering a disabled action must not create a project')
      },
    }),
    page: fixture.render(MachineProjectsSection, {
      machine: value,
      projects: [],
    }),
  }
}

test('online devices explain each missing add-project capability in both sidebar and device page', () => {
  for (const unavailable of [
    {
      ...machine,
      capabilities: { ...machine.capabilities, projectAccess: false },
    },
    {
      ...machine,
      capabilities: { ...machine.capabilities, providerExecution: false },
    },
    { ...machine, availability: 'unavailable' },
  ]) {
    const { sidebar, page, fixture } = renderDevice(unavailable)
    assert.ok(sidebar.includes(reason))
    assert.ok(sidebar.includes(`title="${reason}"`))
    assert.ok(page.includes(reason))
    assert.doesNotMatch(sidebar, /aria-label="在 测试设备 上添加项目"/u)
    assert.doesNotMatch(page, /data-slot="add-project-card"/u)
    assert.equal(fixture.requests.length, 0)
  }
})

test('capable devices retain the add action without a cannot-add warning', () => {
  const { sidebar, page, fixture } = renderDevice(machine)
  assert.match(sidebar, /aria-label="在 测试设备 上添加项目"/u)
  assert.ok(!sidebar.includes(reason))
  assert.ok(!page.includes(reason))
  assert.equal(fixture.requests.length, 0)
})

test('offline sidebar devices keep their connection status without an add action', () => {
  const { sidebar, page } = renderDevice({
    ...machine,
    connectionState: 'offline',
  })
  assert.match(sidebar, /离线/u)
  assert.doesNotMatch(sidebar, /aria-label="在 测试设备 上添加项目"/u)
  assert.ok(page.includes(reason))
})
