import assert from 'node:assert/strict'
import test from 'node:test'
import { createDom, h } from './fixtures/dom.mjs'
import { metadataUiFixture } from './fixtures/metadata-ui.mjs'

const local = machine('local', '本机测试', 'local')
const online = machine('online', '在线测试机', 'online')
const connecting = machine('connecting', '连接中测试机', 'connecting')
const offline = [
  machine('offline_a', '配对测试机 A', 'offline'),
  machine('offline_b', '配对测试机 B', 'offline'),
]

const surfaces = [
  {
    label: 'Devices page',
    path: 'components/machines/machines-page.tsx',
    exportName: 'MachinesPage',
  },
  {
    label: 'workspace sidebar',
    path: 'components/app-shell/workspace-sidebar.tsx',
    exportName: 'WorkspaceSidebar',
    props: { currentPath: '/devices', onNewConversation() {} },
  },
]

for (const { label, path, exportName, props } of surfaces) {
  test(`${label} keeps the local computer first and hides only offline paired computers until expanded`, async (t) => {
    const fixture = metadataUiFixture({
      machines: [offline[0], online, offline[1], connecting, local],
    })
    const Component = fixture.load(path)[exportName]
    const dom = await createDom()
    t.after(() => dom.close())
    await dom.render(h(Component, props))

    const toggle = offlineGroup(dom.container)
    assert.ok(toggle)
    assert.match(toggle.textContent, /其他电脑\s*·\s*2 台离线/u)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(toggle.tabIndex, 0)
    const group = dom.window.document.getElementById(
      toggle.getAttribute('aria-controls'),
    )
    assert.ok(group?.hidden)
    assert.deepEqual(
      deviceLinks(dom.container),
      [local, online, connecting].map(deviceHref),
    )
    for (const machine of offline) {
      assert.ok(!dom.container.textContent.includes(machine.displayName))
    }
    if (exportName === 'MachinesPage') {
      const localCard = dom.container
        .querySelector(`a[href="${deviceHref(local)}"]`)
        .closest('article')
      assert.match(localCard.textContent, /这台电脑无需账号即可使用。/u)
      assert.match(
        dom.container.textContent,
        /账号用于将手机或平板与电脑配对。其他电脑也可以直接配对，无需账号。/u,
      )
    }

    await dom.perform(() => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(group.hidden, false)
    assert.deepEqual(
      new Set(deviceLinks(group)),
      new Set(offline.map(deviceHref)),
    )
    for (const machine of offline) {
      assert.ok(group.textContent.includes(machine.displayName))
    }
    assert.match(group.textContent, /离线/u)
    assert.deepEqual(
      deviceLinks(dom.container).slice(0, 3),
      [local, online, connecting].map(deviceHref),
    )

    const other = surfaces.find((surface) => surface.path !== path)
    const OtherComponent = fixture.load(other.path)[other.exportName]
    await dom.render(h(OtherComponent, other.props))
    assert.equal(
      offlineGroup(dom.container).getAttribute('aria-expanded'),
      'false',
    )
    await dom.render(h(Component, props))
    const browseAgain = offlineGroup(dom.container)
    assert.equal(browseAgain.getAttribute('aria-expanded'), 'true')
    for (const machine of offline) {
      assert.ok(deviceLinks(dom.container).includes(deviceHref(machine)))
    }

    const initialMachines = fixture.state.machines
    const recovered = {
      ...offline[0],
      connectionState: 'online',
      availability: 'available',
      capabilities: online.capabilities,
    }
    fixture.state.machines = initialMachines.map((machine) =>
      machine === offline[0] ? recovered : machine,
    )
    await dom.render(h(Component, props))
    const currentGroup = dom.window.document.getElementById(
      browseAgain.getAttribute('aria-controls'),
    )
    assert.match(browseAgain.textContent, /其他电脑\s*·\s*1 台离线/u)
    assert.deepEqual(deviceLinks(currentGroup), [deviceHref(offline[1])])
    assert.ok(deviceLinks(dom.container).includes(deviceHref(recovered)))

    fixture.state.machines = initialMachines
    await dom.render(h(Component, props))
    await dom.perform(() => browseAgain.click())
    assert.equal(browseAgain.getAttribute('aria-expanded'), 'false')
    assert.deepEqual(
      deviceLinks(dom.container),
      [local, online, connecting].map(deviceHref),
    )
    assert.equal(fixture.mutations.length, 0)
    assert.deepEqual(fixture.requests, [])

    fixture.state.machines = [local]
    await dom.render(h(Component, props))
    assert.equal(offlineGroup(dom.container), undefined)
    assert.deepEqual(deviceLinks(dom.container), [deviceHref(local)])
  })
}

function machine(id, displayName, connectionState) {
  const usable = connectionState === 'local' || connectionState === 'online'
  return {
    machineId: `machine_w0_${id}`,
    displayName,
    kind: connectionState === 'local' ? 'local' : 'remote',
    connectionState,
    platform: 'Windows',
    architecture: 'x64',
    availability: usable ? 'available' : 'unavailable',
    capabilities: { projectAccess: usable, providerExecution: usable },
  }
}

function deviceHref(machine) {
  return `/devices/${machine.machineId}`
}

function deviceLinks(container) {
  return [...container.querySelectorAll('a[href^="/devices/"]')].map((link) =>
    link.getAttribute('href'),
  )
}

function offlineGroup(container) {
  return [...container.querySelectorAll('button[aria-expanded]')].find(
    (button) => button.textContent.includes('其他电脑'),
  )
}
