import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as reactQuery from '@tanstack/react-query'

import { act, createDom } from './fixtures/dom.mjs'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const { QueryClient, QueryClientProvider, QueryObserver } = reactQuery
const identityKey = ['host', 'local-identity-for-directory']
const grantKey = [
  'account',
  'host-supervisor-grants',
  'host_local',
  'usr_owner',
]
const device = {
  deviceId: 'dev_phone',
  label: 'vivo X60',
  platform: 'Android',
  authorizationId: 'hauth_private',
  pairingRootAuthorizationId: 'hauth_lineage',
  lastUsedAt: '2026-10-18T12:00:00Z',
  expiresAt: '2026-10-20T12:00:00Z',
  status: 'active',
  renewalEligible: false,
}

function fixture({ loadPairingOwner, removePairedDevice } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const owner = { host: { hostId: 'host_local' } }
  const { AuthorizedMobileDevices } = loadWebComponent(
    'components/machines/authorized-mobile-devices.tsx',
    new Map([
      ['@tanstack/react-query', reactQuery],
      [
        '@codetether/ui',
        {
          ...loadUiComponent('index.ts'),
          // The shared Radix Portal caches document availability before JSDOM.
          DialogContent: ({ children }) =>
            h('div', { role: 'dialog' }, children),
        },
      ],
      [
        '../../runtime/account/account-config.js',
        { controlPlaneBaseUrl: 'https://control-plane.test' },
      ],
      [
        '../../runtime/account/supabase-account.js',
        {
          getSupabaseAccountClient: () => ({
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'usr_owner' } } },
              }),
            },
          }),
        },
      ],
      [
        '../../runtime/native/native-capabilities.js',
        { nativeCapabilities: {} },
      ],
      [
        '../../runtime/account/pairing-client.js',
        {
          loadPairingOwner: loadPairingOwner ?? (async () => owner),
          removePairedDevice:
            removePairedDevice ??
            (async () => assert.fail('unexpected removal')),
        },
      ],
    ]),
  )
  client.setQueryData(identityKey, { hostId: 'host_local' })
  const view = h(
    QueryClientProvider,
    { client },
    h(AuthorizedMobileDevices, { userId: 'usr_owner' }),
  )
  return { client, view, owner }
}

test('device rows show safe name, system, last use, and expired state', async () => {
  const { client, view } = fixture()
  try {
    client.setQueryData(grantKey, {
      devices: [
        device,
        {
          ...device,
          deviceId: 'dev_tablet',
          label: '平板',
          status: 'expired',
          lastUsedAt: null,
        },
      ],
    })
    await assert.rejects(
      client.fetchQuery({
        queryKey: grantKey,
        queryFn: async () => {
          throw new Error('fixture refresh failed')
        },
      }),
    )
    const html = renderToStaticMarkup(view)
    assert.match(html, /手机和平板/)
    assert.match(html, /vivo X60/)
    assert.match(html, /Android · 上次使用/)
    assert.match(html, /dateTime="2026-10-18T12:00:00Z"/)
    assert.match(html, /暂时无法更新/)
    assert.match(html, /已失效，重新配对/)
    assert.match(html, /还未使用/)
    assert.match(html, /aria-label="移除 vivo X60"/)
    assert.doesNotMatch(html, /hauth_|dev_phone|fingerprint|proof|keyHandle/)
    assert.equal(client.getQueryCache().getAll().length, 2)
  } finally {
    client.clear()
  }
})

test('device list subscribes to the exact owner cache without replacing its fetcher', async () => {
  const dom = await createDom()
  const { client, view } = fixture()
  let calls = 0
  const fetcher = async () => ({
    devices: [{ ...device, label: 'phone-' + ++calls }],
  })
  const owner = new QueryObserver(client, {
    queryKey: grantKey,
    queryFn: fetcher,
    staleTime: Infinity,
  })
  const releaseOwner = owner.subscribe(() => {})
  const cache = client.getQueryCache()
  const subscribe = cache.subscribe.bind(cache)
  let subscriptions = 0
  cache.subscribe = (listener) => {
    subscriptions++
    const release = subscribe(listener)
    return () => {
      subscriptions--
      release()
    }
  }
  let closed = false
  try {
    await owner.refetch()
    await dom.render(view)
    assert.match(dom.container.textContent, /phone-1/u)
    await act(async () => {
      await client.invalidateQueries({ queryKey: grantKey, exact: true })
    })
    await dom.until(() => dom.container.textContent.includes('phone-2'))
    assert.equal(calls, 2)
    assert.equal(
      cache.find({ queryKey: grantKey, exact: true }).options.queryFn,
      fetcher,
    )
    assert.equal(
      cache.find({ queryKey: grantKey, exact: true }).getObserversCount(),
      1,
    )
    assert.equal(
      cache.find({ queryKey: identityKey, exact: true }).getObserversCount(),
      0,
    )
    assert.equal(subscriptions, 2)
    await dom.close()
    closed = true
    assert.equal(subscriptions, 0)
  } finally {
    if (!closed) await dom.close()
    releaseOwner()
    client.clear()
  }
})

test('remove opens the exact named confirmation and only submits after confirmation', async () => {
  const dom = await createDom()
  const calls = []
  const { client, view, owner } = fixture({
    removePairedDevice: async (...args) => calls.push(args),
  })
  client.setQueryData(grantKey, { devices: [device] })
  try {
    await dom.render(view)
    await act(async () =>
      dom.container.querySelector('[aria-label="移除 vivo X60"]').click(),
    )
    assert.match(
      document.body.textContent,
      /移除后 vivo X60 会立刻断开，要再用就重新配对。电脑上正在运行的工作不受影响。/,
    )
    assert.equal(calls.length, 0)
    const confirm = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find((button) => button.textContent === '移除')
    assert.ok(confirm)
    await act(async () => confirm.click())
    await dom.until(() => !dom.container.textContent.includes('vivo X60'))
    assert.deepEqual(calls, [[owner, device]])
  } finally {
    await dom.close()
    client.clear()
  }
})
