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
  assert.match(presence, /PRESENCE_REFRESH_MS = 4 \* 60_000/u)
  assert.match(presence, /publishLocalSupervisorPresence/u)
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
  assert.equal(presenceKey, 'supervisor-presence-authorized-hosts')
  assert.notEqual(directoryKey, presenceKey)
  assert.match(directory, /return \{ hosts, ownedHosts, productDevice \}/u)
  assert.match(presence, /return \{ hosts, productDevice \}/u)

  const { QueryClient } = await import('@tanstack/react-query')
  const queryClient = new QueryClient()
  queryClient.setQueryData(['account', presenceKey, 'usr_test'], {
    hosts: [],
    productDevice: {},
  })
  assert.equal(
    queryClient.getQueryData(['account', directoryKey, 'usr_test']),
    undefined,
  )
})
