import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const directoryPath = new URL(
  '../src/components/hosts/host-directory-page.tsx',
  import.meta.url,
)
const presencePath = new URL(
  '../src/runtime/account/local-supervisor-presence.tsx',
  import.meta.url,
)
const remotePath = new URL(
  '../src/runtime/account/remote-supervisor.ts',
  import.meta.url,
)
const mainPath = new URL('../src/main.tsx', import.meta.url)

test('forced Relay is validation-only and bypasses local and Direct selection', async () => {
  const [directory, remote] = await Promise.all([
    readFile(directoryPath, 'utf8'),
    readFile(remotePath, 'utf8'),
  ])
  assert.match(directory, /VITE_CODETETHER_FORCE_RELAY/u)
  assert.match(
    directory,
    /forceRelay\s*\|\|\s*\n\s*import\.meta\.env\.VITE_CODETETHER_FORCE_REMOTE/u,
  )
  assert.match(directory, /forceRelay,\s*\n\s*signal/u)
  assert.match(remote, /\{ forceRelay: true \}/u)
  assert.match(remote, /transport !== 'direct' && transport !== 'relay'/u)
  assert.match(remote, /async function closeRemoteSupervisorSession/u)
  assert.match(remote, /method: 'DELETE'/u)
  assert.match(
    remote,
    /const cached = remoteSessions\.get\(options\.host\.hostId\)/u,
  )
  assert.match(
    remote,
    /await closeRemoteSupervisorSession\(options\.host\.hostId, cached\)/u,
  )
})

test('Supervisor Relay presence is maintained outside the My Hosts route', async () => {
  const [main, presence] = await Promise.all([
    readFile(mainPath, 'utf8'),
    readFile(presencePath, 'utf8'),
  ])
  assert.match(main, /<LocalSupervisorPresenceCoordinator \/>/u)
  assert.match(presence, /PRESENCE_REFRESH_MS = 60_000/u)
  assert.match(presence, /publishLocalSupervisorPresence/u)
  assert.match(presence, /listOwnedHosts/u)
  assert.match(presence, /connectionState === 'connected'/u)
  assert.doesNotMatch(presence, /Controller|Node pairing|machine_tls_v1/u)
})

test('presence reads cannot populate the My Hosts directory cache with a partial shape', async () => {
  const [directory, presence] = await Promise.all([
    readFile(directoryPath, 'utf8'),
    readFile(presencePath, 'utf8'),
  ])
  const directoryKey = directory.match(
    /queryKey:\s*\[\s*'account',\s*'([^']+)',/u,
  )?.[1]
  const presenceKey = presence.match(
    /queryKey:\s*\[\s*'account',\s*'([^']+)',/u,
  )?.[1]
  assert.equal(directoryKey, 'host-directory')
  assert.equal(presenceKey, 'supervisor-presence-owned-hosts')
  assert.notEqual(directoryKey, presenceKey)
  assert.match(directory, /return \{ hosts, ownedHosts, productDevice \}/u)
  assert.match(presence, /return \{ hosts, productDevice \}/u)

  const { QueryClient } = await import('@tanstack/react-query')
  const queryClient = new QueryClient()
  const userId = 'usr_test'
  const presenceQueryKey = ['account', presenceKey, userId]
  const directoryQueryKey = ['account', directoryKey, userId]
  const authorizedHost = { hostId: 'host_authorized' }
  const ownedHosts = [
    { hostId: 'host_authorized', access: { state: 'authorized' } },
    { hostId: 'host_needs_access', access: { state: 'none' } },
  ]
  const productDevice = { deviceId: 'dev_test' }

  await Promise.all([
    queryClient.fetchQuery({
      queryKey: presenceQueryKey,
      queryFn: async () => ({ hosts: [authorizedHost], productDevice }),
    }),
    queryClient.fetchQuery({
      queryKey: directoryQueryKey,
      queryFn: async () => ({
        hosts: [authorizedHost],
        ownedHosts,
        productDevice,
      }),
    }),
  ])
  const authenticatedDirectory = queryClient.getQueryData(directoryQueryKey)
  assert.equal(authenticatedDirectory.ownedHosts.length, 2)
  assert.equal(authenticatedDirectory.hosts[0].hostId, 'host_authorized')
  assert.deepEqual(
    authenticatedDirectory.ownedHosts.map((host) => host.access.state),
    ['authorized', 'none'],
  )

  await queryClient.fetchQuery({
    queryKey: presenceQueryKey,
    queryFn: async () => ({ hosts: [], productDevice }),
  })
  assert.deepEqual(queryClient.getQueryData(presenceQueryKey).hosts, [])
  assert.strictEqual(
    queryClient.getQueryData(directoryQueryKey),
    authenticatedDirectory,
  )
  assert.equal(authenticatedDirectory.ownedHosts.length, 2)
})

test('authenticated My Hosts retains authorized and access-required render branches', async () => {
  const directory = await readFile(directoryPath, 'utf8')
  assert.match(directory, /function AuthenticatedHostDirectory\(/u)
  assert.match(directory, /title="My Hosts"/u)
  assert.match(
    directory,
    /ownedHost\.access\.state === 'authorized' &&\s*host !== undefined/u,
  )
  assert.match(directory, /<ConnectedHostCard/u)
  assert.match(directory, /<AccessRequiredHostCard/u)
  assert.match(directory, /'Access required'/u)
  assert.match(directory, /<CheckCircle2 aria-hidden="true" \/> Online/u)
})
