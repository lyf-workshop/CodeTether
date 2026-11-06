import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const appPath = process.argv[2] && resolve(process.argv[2])
if (!appPath) fail('usage: verify-build-config.mjs <CodeTether.app>')

const plistPath = resolve(appPath, 'Info.plist')
let plist
try {
  const result = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) fail('unable to read the final Info.plist')
  plist = JSON.parse(result.stdout)
} catch {
  fail('unable to read the final Info.plist')
}

const required = [
  'CodeTetherControlPlaneURL',
  'CodeTetherSupabaseURL',
  'CodeTetherSupabasePublishableKey',
]
const relay = [
  'CodeTetherRelayEndpoint',
  'CodeTetherRelayID',
  'CodeTetherRelayFingerprint',
]

const values = new Map()
for (const key of [...required, ...relay]) {
  const value = plist[key]
  if (typeof value !== 'string') fail(`${key} is missing or not a string`)
  values.set(key, value)
}

const urlHostnames = new Map()
for (const key of ['CodeTetherControlPlaneURL', 'CodeTetherSupabaseURL']) {
  const url = parseOrigin(values.get(key))
  if (!url) fail(`${key} has an invalid HTTPS origin`)
  urlHostnames.set(key, url.hostname)
}

const publishableKey = values.get('CodeTetherSupabasePublishableKey')
if (
  publishableKey.length === 0 ||
  Buffer.byteLength(publishableKey, 'utf8') > 2048 ||
  Array.from(publishableKey, (character) => character.codePointAt(0)).some(
    (codePoint) => codePoint < 33 || codePoint > 126,
  )
) {
  fail('CodeTetherSupabasePublishableKey has an invalid shape')
}

const relayPresent = relay.filter((key) => values.get(key).length > 0).length
if (relayPresent !== 0 && relayPresent !== relay.length) {
  fail('Relay configuration is incomplete')
}

for (const key of required) console.log(`${key}: present, shape correct`)
for (const [key, hostname] of urlHostnames) console.log(`${key} host: ${hostname}`)
for (const key of relay) {
  console.log(`${key}: ${relayPresent === 0 ? 'absent' : 'present, shape correct'}`)
}

function parseOrigin(value) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) return null
    return url
  } catch {
    return null
  }
}

function fail(message) {
  console.error(`iPad build configuration check failed: ${message}`)
  process.exit(1)
}
