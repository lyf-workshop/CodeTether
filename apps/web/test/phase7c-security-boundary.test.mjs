import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const workspace = resolve(process.cwd(), '..', '..')

test('Web and public Host contracts contain no endpoint private key material', async () => {
  const manifest = JSON.parse(
    await readFile(join(workspace, 'apps', 'web', 'package.json'), 'utf8'),
  )
  for (const forbiddenDependency of [
    '@codetether/machine-transport',
    '@codetether/relay-client',
    '@codetether/relay-protocol',
  ]) {
    assert.equal(forbiddenDependency in manifest.dependencies, false)
  }

  const publicSources = await readSources([
    join(workspace, 'apps', 'web', 'src'),
    join(workspace, 'packages', 'client', 'src'),
    join(workspace, 'packages', 'protocol', 'src'),
  ])

  for (const privateMaterial of [
    'privateKeyPem',
    'private_key_pem',
    'trafficSecret',
    'traffic_secret',
    'sessionTicket',
    'session_ticket',
    'TLSKEYLOGFILE',
    'SSLKEYLOGFILE',
    'MachineTlsIdentitySchema',
    'RelayApplicationIdentitySchema',
    'controllerCredentialRef',
    'exportKeyingMaterial',
  ]) {
    assert.equal(publicSources.includes(privateMaterial), false)
  }
})

test('production Machine transport exposes no environment-controlled TLS bypass', async () => {
  const securitySources = await readSources([
    join(workspace, 'packages', 'machine-transport', 'src'),
    join(workspace, 'packages', 'relay-client', 'src'),
    join(workspace, 'apps', 'host', 'src', 'api'),
    join(workspace, 'apps', 'node', 'src'),
  ])

  for (const insecureEscape of [
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'SSLKEYLOGFILE',
    'TLSKEYLOGFILE',
    '--tls-keylog',
    'enableTrace',
    'maxEarlyData',
    'setSession(',
    'allowPlaintextMachine',
    'disableMachineTls',
    'trustAnyMachine',
  ]) {
    assert.equal(securitySources.includes(insecureEscape), false)
  }
})

async function readSources(roots) {
  const files = (
    await Promise.all(roots.map(async (root) => await sourceFiles(root)))
  ).flat()
  return (
    await Promise.all(files.map(async (file) => await readFile(file, 'utf8')))
  ).join('\n')
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return await sourceFiles(path)
        return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
      }),
    )
  ).flat()
}
