import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainPath = new URL('../src/main.tsx', import.meta.url)
const remotePath = new URL(
  '../src/runtime/account/remote-supervisor.ts',
  import.meta.url,
)
const directoryPath = new URL(
  '../src/components/hosts/host-directory-page.tsx',
  import.meta.url,
)

test('Controller-only startup never creates a local Host identity', async () => {
  const source = await readFile(mainPath, 'utf8')
  assert.doesNotMatch(source, /ensureDesktopHostIdentity/u)
  assert.doesNotMatch(source, /host_identity_key_create/u)
  assert.doesNotMatch(source, /host_identity_persist_failed/u)
})

test('Host lifecycle distinguishes disabled, enabled-unclaimed, and claimed states', async () => {
  const source = await readFile(remotePath, 'utf8')
  assert.match(
    source,
    /export type LocalHostLifecycleState =\s*\n\s*'?disabled'?\s*\|\s*'?enabled_unclaimed'?\s*\|\s*'?claimed'?/u,
  )
  assert.match(source, /deriveLocalHostLifecycleState/u)
  assert.match(
    source,
    /ownedHosts\.some\(\(host\) => host\.hostId === identity\.hostId\)/u,
  )
})

test('Uninitialized Host identity uses null so TanStack Query can represent success', async () => {
  const source = await readFile(remotePath, 'utf8')
  assert.match(
    source,
    /response\.status === 404\) return null/u,
  )
  assert.match(
    source,
    /identity: LocalHostIdentityRecord \| null \| undefined/u,
  )
})

test('Host key creation is an explicit action and does not claim or publish', async () => {
  const [remote, directory] = await Promise.all([
    readFile(remotePath, 'utf8'),
    readFile(directoryPath, 'utf8'),
  ])
  const start = remote.indexOf('export async function enableLocalHostIdentity')
  const end = remote.indexOf('\n}\n', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const enableAction = remote.slice(start, end + 3)
  assert.match(enableAction, /capability\.createKey\(\)/u)
  assert.match(enableAction, /method: 'POST'/u)
  assert.doesNotMatch(enableAction, /supervisor-host-presence/u)
  assert.doesNotMatch(enableAction, /publishLocalSupervisorPresence/u)
  assert.doesNotMatch(enableAction, /claim|authorization/u)
  assert.match(directory, /Enable this Mac as a Host/u)
  assert.match(
    directory,
    /enrollLocalHost\(/u,
  )
  assert.match(directory, /Complete Host setup/u)
})

test('Remote Controller path remains ProductDevice-scoped when local Host is disabled', async () => {
  const [main, remote, directory] = await Promise.all([
    readFile(mainPath, 'utf8'),
    readFile(remotePath, 'utf8'),
    readFile(directoryPath, 'utf8'),
  ])
  assert.doesNotMatch(main, /nativeCapabilities\.hostIdentity/u)
  assert.match(remote, /deviceIdentity: ProductDeviceIdentityCapability/u)
  assert.match(directory, /!exactLocalHost \|\| forceRemote/u)
  assert.doesNotMatch(
    directory,
    /deviceIdentity:\s*nativeCapabilities\.hostIdentity/u,
  )
})
