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
  function Probe({ id, canCompose, kind, turnStatus }) {
    const capabilities = { canCompose, canResolveApproval: false }
    controls = useLiveConversationControls(
      {
        id,
        provider: 'codex',
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
    async resolve(index) {
      await dom.perform(() => requests[index].resolve({ provider: catalog }))
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
  await view.render({ canCompose: false })
  await view.render({ canCompose: true })
  assert.equal(view.requests.length, 1)
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
