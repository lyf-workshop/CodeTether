import assert from 'node:assert/strict'
import test from 'node:test'
import * as reactQuery from '@tanstack/react-query'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const catalog = {
  provider: 'codex',
  availableModels: [{ id: 'available-model', name: 'Available model' }],
}

async function fixture(t, initial = {}) {
  const client = new reactQuery.QueryClient()
  const dom = await createDom()
  t.after(async () => {
    const picker = dom.window.document.querySelector('[role="listbox"]')
    if (picker) {
      const trigger = dom.container.querySelector('[role="combobox"]')
      await dom.perform(() =>
        picker.dispatchEvent(
          new dom.window.KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        ),
      )
      // Radix restores focus in a timer; finish it before restoring DOM globals.
      await dom.until(
        () =>
          !dom.window.document.querySelector('[role="listbox"]') &&
          dom.window.document.activeElement === trigger,
      )
    }
    await dom.close()
    client.clear()
  })
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const requests = []
  const runtime = {
    refreshConversationModels(conversationId) {
      const request = { conversationId, ...Promise.withResolvers() }
      requests.push(request)
      return request.promise
    },
  }
  let connectionState = 'connected'
  let controls
  const dependencies = new Map([
    ['@tanstack/react-query', reactQuery],
    [
      '../../runtime/host/host-runtime-hooks.js',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => connectionState,
      },
    ],
  ])
  const { useLiveConversationControls } = loadWebComponent(
    'components/conversation/use-live-conversation-controls.ts',
    dependencies,
  )
  const { Composer } = loadWebComponent('components/conversation/composer.tsx')
  function Probe({ id, canCompose, kind, turnStatus, archivedAt }) {
    const capabilities = { canCompose, canResolveApproval: false }
    controls = useLiveConversationControls(
      {
        id,
        provider: 'codex',
        archivedAt,
        turns: [],
        pendingApprovals: [],
        currentTurn:
          turnStatus === undefined ? undefined : { status: turnStatus },
      },
      capabilities,
      kind,
    )
    return h(Composer, {
      conversationId: id,
      capabilities,
      controller: controls.composer,
      modelSwitchController: controls.modelSwitch,
      agent: 'codex',
      modelSettings: {
        currentModel: 'unavailable-model',
        availableModels: [],
        reasoningOptions: [],
        canSelectModel: true,
        canSelectReasoning: false,
      },
    })
  }
  let props = {
    id: 'conv_refresh_a',
    canCompose: true,
    kind: 'local',
    ...initial,
  }
  const render = async (next = {}) => {
    props = { ...props, ...next }
    await dom.render(
      h(reactQuery.QueryClientProvider, { client }, h(Probe, props)),
    )
  }
  await render()
  return {
    ...dom,
    requests,
    render,
    controls: () => controls,
    setConnection: (state) => {
      connectionState = state
    },
    warning: () =>
      dom.window.document.body.textContent.includes('不在此账号的可用模型中'),
    async resolve(index, provider = catalog) {
      await dom.perform(() => requests[index].resolve({ provider }))
    },
    async openPicker() {
      const trigger = dom.container.querySelector('[role="combobox"]')
      await dom.perform(() =>
        trigger.dispatchEvent(
          new dom.window.KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        ),
      )
    },
  }
}

test('local opening refreshes once and Turn completion or reconnection never repeats it', async (t) => {
  const view = await fixture(t)
  assert.equal(view.requests.length, 1)
  await view.resolve(0)
  assert.equal(view.warning(), true)
  await view.render({ canCompose: false, turnStatus: 'running' })
  await view.render({ canCompose: true, turnStatus: 'completed' })
  view.setConnection('reconnecting')
  await view.render({ canCompose: false })
  view.setConnection('connected')
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)
  assert.equal(view.warning(), true)
  await view.render({ id: 'conv_refresh_b' })
  assert.equal(view.requests.length, 2)
  assert.equal(view.warning(), false)
  await view.resolve(1)
  await view.render({ id: 'conv_refresh_a' })
  assert.equal(view.requests.length, 3)
})

test('local opening waits for the first composable state and failed reads are not automatically retried', async (t) => {
  const view = await fixture(t, { canCompose: false })
  assert.equal(view.requests.length, 0)
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)
  await view.perform(() =>
    view.requests[0].reject(new Error('catalog unavailable')),
  )
  assert.equal(view.warning(), false)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.container.querySelector('[role="alert"]'), null)
  await view.render({ canCompose: false })
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)
  await view.openPicker()
  assert.equal(view.requests.length, 2)
  await view.perform(() =>
    view.requests[1].reject(new Error('catalog unavailable again')),
  )
  assert.notEqual(view.controls().modelSwitch.error, undefined)
  assert.match(
    view.container.querySelector('[role="alert"]')?.textContent ?? '',
    /暂时无法连接/u,
  )
})

test('opening the picker during an automatic read queues one fresh explicit read', async (t) => {
  const view = await fixture(t)
  assert.equal(view.requests.length, 1)
  await view.openPicker()
  assert.equal(view.requests.length, 1)
  await view.perform(() =>
    view.requests[0].reject(new Error('catalog unavailable')),
  )
  await view.until(() => view.requests.length === 2)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  await view.perform(() =>
    view.requests[1].reject(new Error('explicit catalog unavailable')),
  )
  assert.match(
    view.container.querySelector('[role="alert"]')?.textContent ?? '',
    /暂时无法连接/u,
  )
  assert.equal(view.requests.length, 2)
})

test('an in-flight automatic success still gets the menu a fresh catalog', async (t) => {
  const view = await fixture(t)
  await view.openPicker()
  await view.resolve(0)
  await view.until(() => view.requests.length === 2)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  await view.resolve(1, {
    ...catalog,
    availableModels: [{ id: 'fresh-model', name: 'Fresh model' }],
  })
  assert.equal(
    view.controls().modelSwitch.catalog.availableModels[0].id,
    'fresh-model',
  )
  assert.equal(view.requests.length, 2)
})

test('an automatic wrong-provider catalog is quiet until a picker read also fails', async (t) => {
  const view = await fixture(t)
  await view.resolve(0, { ...catalog, provider: 'claude' })
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.container.querySelector('[role="alert"]'), null)
  await view.openPicker()
  assert.equal(view.requests.length, 2)
  await view.resolve(1, { ...catalog, provider: 'claude' })
  assert.match(view.controls().modelSwitch.error, /模型列表与当前会话不匹配/u)
})

test('remote opening does not read a catalog but opening its picker still refreshes', async (t) => {
  const view = await fixture(t, { kind: 'remote' })
  assert.equal(view.requests.length, 0)
  await view.render({ canCompose: false })
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 0)
  await view.openPicker()
  assert.equal(view.requests.length, 1)
  await view.resolve(0)
})

test('picker refresh preserves the catalog and warning until a failure invalidates them', async (t) => {
  const view = await fixture(t)
  await view.resolve(0)
  assert.equal(view.warning(), true)
  await view.openPicker()
  assert.equal(view.requests.length, 2)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  assert.equal(view.controls().modelSwitch.catalog, catalog)
  assert.equal(view.warning(), true)
  await view.perform(() =>
    view.requests[1].reject(new Error('catalog unavailable')),
  )
  assert.equal(view.controls().modelSwitch.catalog, undefined)
  assert.equal(view.warning(), false)
})

test('a delayed catalog cannot populate a different opened conversation', async (t) => {
  const view = await fixture(t)
  await view.render({ id: 'conv_refresh_b' })
  assert.equal(view.requests.length, 2)
  await view.resolve(0)
  assert.equal(view.controls().modelSwitch.catalog, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  await view.resolve(1)
  assert.equal(view.controls().modelSwitch.catalog, catalog)
})

test('a delayed local failure cannot surface after opening a remote conversation', async (t) => {
  const view = await fixture(t)
  await view.render({ id: 'conv_refresh_remote', kind: 'remote' })
  await view.perform(() =>
    view.requests[0].reject(new Error('old local request failed')),
  )
  assert.equal(view.requests.length, 1)
  assert.equal(view.controls().modelSwitch.catalog, undefined)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, false)
})

const archivedAt = '2026-11-19T12:00:00.000Z'

test('an archived local conversation reads nothing until restoration even when composing stays available', async (t) => {
  const view = await fixture(t, { archivedAt, canCompose: true })
  assert.equal(view.requests.length, 0)
  await view.perform(() => {
    void view.controls().modelSwitch.refreshModels()
  })
  assert.equal(view.requests.length, 0)
  assert.equal(view.controls().modelSwitch.loadingModels, false)

  await view.render({ archivedAt: undefined })
  assert.equal(view.requests.length, 1)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  await view.resolve(0)
  assert.equal(view.warning(), true)
  await view.render({ canCompose: false, turnStatus: 'running' })
  await view.render({ canCompose: true, turnStatus: 'completed' })
  view.setConnection('reconnecting')
  await view.render({ canCompose: false })
  view.setConnection('connected')
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)
  assert.equal(view.warning(), true)

  await view.render({ archivedAt })
  assert.equal(view.requests.length, 1)
  await view.render({ archivedAt: undefined })
  assert.equal(view.requests.length, 2)
  await view.resolve(1)
  assert.equal(view.warning(), true)
})

test('archiving clears a quiet failed initial read and restoration permits one new automatic read', async (t) => {
  const view = await fixture(t)
  await view.perform(() =>
    view.requests[0].reject(new Error('initial catalog read failed')),
  )
  assert.equal(view.controls().modelSwitch.error, undefined)
  await view.render({ canCompose: false })
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)

  await view.render({ archivedAt })
  assert.equal(view.controls().modelSwitch.catalog, undefined)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, false)
  await view.render({ archivedAt: undefined })
  assert.equal(view.requests.length, 2)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, true)
  await view.resolve(1)
  assert.equal(view.warning(), true)
})

test('archiving clears a loaded catalog and pending picker refresh, then restoration waits until composing is available', async (t) => {
  const view = await fixture(t)
  await view.resolve(0)
  assert.equal(view.warning(), true)
  await view.openPicker()
  assert.equal(view.requests.length, 2)
  assert.equal(view.controls().modelSwitch.loadingModels, true)

  await view.render({ archivedAt })
  assert.equal(view.controls().modelSwitch.catalog, undefined)
  assert.equal(view.controls().modelSwitch.loadingModels, false)
  assert.equal(view.controls().modelSwitch.error, undefined)
  assert.equal(view.warning(), false)
  await view.resolve(1)
  assert.equal(view.controls().modelSwitch.catalog, undefined)

  await view.render({ archivedAt: undefined, canCompose: false })
  assert.equal(view.requests.length, 2)
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 3)
  await view.resolve(2)
  assert.equal(view.warning(), true)
})

for (const outcome of ['success', 'failure']) {
  for (const phase of ['archived', 'restored-pending', 'restored-completed']) {
    test(`a delayed ${outcome} cannot change catalog state while ${phase}`, async (t) => {
      const view = await fixture(t)
      const settleOldRequest = async () => {
        if (outcome === 'success') {
          await view.resolve(0, {
            provider: 'codex',
            availableModels: [
              { id: 'unavailable-model', name: 'Stale catalog model' },
            ],
          })
        } else {
          await view.perform(() =>
            view.requests[0].reject(new Error('stale catalog read failed')),
          )
        }
      }
      await view.render({ archivedAt })
      assert.equal(view.controls().modelSwitch.catalog, undefined)
      assert.equal(view.controls().modelSwitch.error, undefined)
      assert.equal(view.controls().modelSwitch.loadingModels, false)

      if (phase === 'archived') {
        await settleOldRequest()
        assert.equal(view.controls().modelSwitch.catalog, undefined)
        assert.equal(view.controls().modelSwitch.error, undefined)
        assert.equal(view.controls().modelSwitch.loadingModels, false)
      }

      await view.render({ archivedAt: undefined })
      assert.equal(view.requests.length, 2)
      if (phase === 'restored-pending') {
        await settleOldRequest()
        assert.equal(view.controls().modelSwitch.catalog, undefined)
        assert.equal(view.controls().modelSwitch.error, undefined)
        assert.equal(view.controls().modelSwitch.loadingModels, true)
      }

      await view.resolve(1)
      if (phase === 'restored-completed') await settleOldRequest()
      assert.equal(view.controls().modelSwitch.catalog, catalog)
      assert.equal(view.controls().modelSwitch.error, undefined)
      assert.equal(view.controls().modelSwitch.loadingModels, false)
      assert.equal(view.warning(), true)
    })
  }
}

test('restoring a remote conversation never refreshes automatically but its picker still does', async (t) => {
  const view = await fixture(t, { kind: 'remote', archivedAt })
  assert.equal(view.requests.length, 0)
  await view.render({ archivedAt: undefined })
  assert.equal(view.requests.length, 0)
  await view.render({ canCompose: false })
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 0)
  await view.openPicker()
  assert.equal(view.requests.length, 1)
  await view.resolve(0)
  assert.equal(view.warning(), true)
})
