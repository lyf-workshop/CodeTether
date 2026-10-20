import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as reactQuery from '@tanstack/react-query'
import { loadWebComponent } from './fixtures/render-ui.mjs'
import { act, createDom } from './fixtures/dom.mjs'

const { QueryClient, QueryClientProvider, QueryObserver } = reactQuery

const { authorizedMobileDevices } = loadWebComponent(
  'runtime/account/authorized-mobile-devices.ts',
)
const now = Date.parse('2026-10-19T12:00:00Z')
const device = (id, deviceType = 'mobile') => ({
  deviceId: id,
  ownerUserId: 'usr_owner',
  deviceType,
  label: id,
  fingerprint: `fingerprint-${id}`,
  keyGeneration: 1,
})
const authorization = (id, extra = {}) => ({
  authorizationId: `authorization-${id}`,
  deviceId: id,
  userId: 'usr_owner',
  hostId: 'host_local',
  scope: 'supervisor_read',
  deviceFingerprint: `fingerprint-${id}`,
  deviceKeyGeneration: 1,
  issuedAt: '2026-10-18T12:00:00Z',
  expiresAt: '2026-10-20T12:00:00Z',
  ...extra,
})
const context = { hostId: 'host_local', ownerUserId: 'usr_owner', now }

async function renderList(
  devices,
  { identity = { hostId: 'host_local' }, stale = false } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const identityKey = ['host', 'local-identity-for-directory']
  const grantKey = [
    'account',
    'host-supervisor-grants',
    identity?.hostId ?? 'unavailable',
    'usr_owner',
  ]
  queryClient.setQueryData(identityKey, identity)
  queryClient.setQueryData(grantKey, { devices })
  if (stale)
    await queryClient
      .fetchQuery({
        queryKey: grantKey,
        queryFn: async () => {
          throw new Error('fixture refresh failed')
        },
      })
      .catch(() => {})
  const beforeQueries = queryClient.getQueryCache().getAll().length
  const mocks = new Map([
    ['@tanstack/react-query', reactQuery],
    [
      '@tanstack/react-router',
      {
        Link: ({ to, children, className }) =>
          h('a', { href: to, className }, children),
      },
    ],
    [
      '../../runtime/account/remote-supervisor',
      {
        readLocalHostIdentity: () =>
          assert.fail('read-only view must not fetch identity'),
      },
    ],
  ])
  const { AuthorizedMobileDevices } = loadWebComponent(
    'components/settings/authorized-mobile-devices.tsx',
    mocks,
  )
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client: queryClient },
      h(AuthorizedMobileDevices, { userId: 'usr_owner' }),
    ),
  )
  assert.equal(queryClient.getQueryCache().getAll().length, beforeQueries)
  assert.equal(queryClient.isFetching(), 0)
  queryClient.clear()
  return html
}

test('only current authorizations for this owner and Host expose mobile/tablet metadata', () => {
  const result = authorizedMobileDevices(
    context,
    [authorization('phone'), authorization('tablet'), authorization('desktop')],
    [
      device('phone'),
      device('tablet', 'tablet'),
      device('desktop', 'desktop_client'),
    ],
  )
  assert.deepEqual(result, [
    {
      deviceId: 'phone',
      name: 'phone',
      type: 'mobile',
      authorizedAt: '2026-10-18T12:00:00Z',
    },
    {
      deviceId: 'tablet',
      name: 'tablet',
      type: 'tablet',
      authorizedAt: '2026-10-18T12:00:00Z',
    },
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /fingerprint|proof|token|keyGeneration/,
  )
})

test('expired, different Host/account, mismatched key and missing device metadata stay absent', () => {
  const records = [
    authorization('expired', { expiresAt: '2026-10-19T11:59:59Z' }),
    authorization('other-host', { hostId: 'host_other' }),
    authorization('other-owner', { userId: 'usr_other' }),
    authorization('wrong-key', { deviceKeyGeneration: 2 }),
    authorization('wrong-fingerprint', { deviceFingerprint: 'different' }),
    authorization('missing'),
    authorization('invalid-date', { issuedAt: 'invalid' }),
    authorization('wrong-account-device'),
  ]
  assert.deepEqual(
    authorizedMobileDevices(context, records, [
      ...records
        .filter(
          ({ deviceId }) =>
            deviceId !== 'missing' && deviceId !== 'wrong-account-device',
        )
        .map(({ deviceId }) => device(deviceId)),
      { ...device('wrong-account-device'), ownerUserId: 'usr_other' },
    ]),
    [],
  )
})

test('duplicate grants collapse by device and missing data never fabricates a list', () => {
  assert.deepEqual(authorizedMobileDevices(context, [], []), [])
  const result = authorizedMobileDevices(
    context,
    [
      authorization('phone'),
      authorization('phone', { issuedAt: '2026-10-19T10:00:00Z' }),
    ],
    [device('phone')],
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].authorizedAt, '2026-10-19T10:00:00Z')
})

test('actual account section renders only safe read-only names, type, authorization date and roadmap', async () => {
  const devices = authorizedMobileDevices(
    context,
    [authorization('phone')],
    [device('phone')],
  )
  const html = await renderList(devices)
  assert.match(html, /已允许访问的手机和平板/)
  assert.match(html, /phone/)
  assert.match(html, /手机 · 授权于/)
  assert.match(html, /dateTime="2026-10-18T12:00:00Z"/)
  assert.match(html, /href="\/roadmap"/)
  assert.match(html, /移除功能会在配对码配对上线时提供/)
  assert.doesNotMatch(
    html,
    /<button|<input|role="switch"|fingerprint|authorizationId|proof|keyHandle/,
  )
})

test('no authorizations or no exact local identity hides the whole account section', async () => {
  assert.equal(await renderList([]), '')
  assert.equal(
    await renderList([{ name: 'test', type: 'mobile' }], { identity: null }),
    '',
  )
})

test('a failed refresh labels retained authorization metadata as last known', async () => {
  const devices = authorizedMobileDevices(
    context,
    [authorization('phone')],
    [device('phone')],
  )
  assert.match(await renderList(devices, { stale: true }), /上次读取的授权记录/)
})

test('mounted cache-only account view cannot replace an active owner fetcher and unsubscribes on unmount', async () => {
  const dom = await createDom()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const identityKey = ['host', 'local-identity-for-directory']
  const grantKey = [
    'account',
    'host-supervisor-grants',
    'host_local',
    'usr_owner',
  ]
  client.setQueryData(identityKey, { hostId: 'host_local' })
  client.setQueryData(grantKey, { devices: [] })
  let ownerCalls = 0,
    viewRequests = 0,
    subscriptions = 0
  const fetcher = async () => ({
    devices: [
      {
        deviceId: 'phone',
        name: 'phone-' + ++ownerCalls,
        type: 'mobile',
        authorizedAt: '2026-10-18T12:00:00Z',
      },
    ],
  })
  const owner = new QueryObserver(client, {
    queryKey: grantKey,
    queryFn: fetcher,
    staleTime: Infinity,
    retry: false,
  })
  const releaseOwner = owner.subscribe(() => {})
  await owner.refetch()
  assert.equal(ownerCalls, 1)
  const cache = client.getQueryCache()
  const originalSubscribe = cache.subscribe.bind(cache)
  cache.subscribe = (listener) => {
    subscriptions++
    const release = originalSubscribe(listener)
    return () => {
      subscriptions--
      release()
    }
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => {
    viewRequests++
    return Promise.reject(new Error('The cache-only view must not fetch'))
  }
  const originalError = console.error,
    errors = []
  console.error = (...args) => {
    errors.push(args.join(' '))
    originalError(...args)
  }
  const { AuthorizedMobileDevices } = loadWebComponent(
    'components/settings/authorized-mobile-devices.tsx',
    new Map([
      ['@tanstack/react-query', reactQuery],
      [
        '@tanstack/react-router',
        {
          Link: ({ to, children, className }) =>
            h('a', { href: to, className }, children),
        },
      ],
      [
        '../../runtime/account/remote-supervisor',
        {
          readLocalHostIdentity: () => {
            viewRequests++
            throw new Error('The cache-only view must not read identity')
          },
        },
      ],
    ]),
  )
  let closed = false
  try {
    await dom.render(
      h(
        QueryClientProvider,
        { client },
        h(AuthorizedMobileDevices, { userId: 'usr_owner' }),
      ),
    )
    assert.match(dom.container.textContent, /phone-1/u)
    await act(async () => {
      await client.invalidateQueries({ queryKey: grantKey, exact: true })
    })
    assert.equal(ownerCalls, 2)
    await dom.until(() => dom.container.textContent.includes('phone-2'))
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
    assert.equal(viewRequests, 0)
    assert.equal(subscriptions, 2)
    await dom.close()
    closed = true
    assert.equal(subscriptions, 0)
    client.setQueryData(grantKey, { devices: [] })
    await Promise.resolve()
    assert.deepEqual(errors, [])
  } finally {
    if (!closed) await dom.close()
    releaseOwner()
    client.clear()
    globalThis.fetch = originalFetch
    console.error = originalError
  }
})
