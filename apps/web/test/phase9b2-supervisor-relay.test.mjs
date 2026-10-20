import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const presencePath = new URL(
  '../src/runtime/account/local-supervisor-presence.tsx',
  import.meta.url,
)
const remotePath = new URL(
  '../src/runtime/account/remote-supervisor.ts',
  import.meta.url,
)
const mainPath = new URL('../src/main.tsx', import.meta.url)

test('forced Relay replaces non-Relay sessions and accepts only Direct or Relay transports', async () => {
  const remote = await readFile(remotePath, 'utf8')
  assert.match(remote, /\{ forceRelay: true \}/u)
  assert.match(
    remote,
    /options\.forceRelay !== true \|\| existing\.transport === 'relay'/u,
  )
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

test('remote Controller reads do not require the local Host identity', async () => {
  const remote = await readFile(remotePath, 'utf8')
  assert.doesNotMatch(
    remote,
    /deviceIdentity:\s*nativeCapabilities\.hostIdentity/u,
  )
  assert.match(remote, /deviceIdentity: ProductDeviceIdentityCapability/u)
  assert.match(
    remote,
    /createDeviceRequestProof\(\{[\s\S]*?identity: options\.deviceIdentity/u,
  )
})

test('UI grant reconciliation is outside My Hosts but does not own cloud presence renewal', async () => {
  const [main, presence] = await Promise.all([
    readFile(mainPath, 'utf8'),
    readFile(presencePath, 'utf8'),
  ])
  assert.match(main, /<LocalSupervisorPresenceCoordinator \/>/u)
  assert.match(presence, /GRANT_REFRESH_MS = 60_000/u)
  assert.match(presence, /reconcileLocalSupervisorGrants/u)
  assert.doesNotMatch(presence, /publishLocalSupervisorPresence/u)
  assert.match(presence, /listOwnedHosts/u)
  assert.match(presence, /connectionState === 'connected'/u)
  assert.equal(
    (presence.match(/refetchIntervalInBackground:\s*true/gu) ?? []).length,
    2,
    'directory and grant observation may continue while hidden, but do not renew the lease',
  )
  assert.doesNotMatch(presence, /Controller|Node pairing|machine_tls_v1/u)
})

test('presence observation retains its own bounded cache shape', async () => {
  const presence = await readFile(presencePath, 'utf8')
  const presenceKey = presence.match(
    /queryKey:\s*\[\s*'account',\s*'([^']+)',/u,
  )?.[1]
  assert.equal(presenceKey, 'supervisor-grants-owned-hosts')
  assert.match(presence, /return \{ hosts, productDevice(?:, devices)? \}/u)
  assert.doesNotMatch(presence, /queryKey: \['account', 'host-directory'/u)
})
