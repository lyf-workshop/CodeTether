import { chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = process.argv[2] ?? resolve(homedir(), 'agenthub-work/v4-build.env')
const destination = resolve(appDirectory, 'Config/Local.xcconfig')
const allowed = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_CODETETHER_CONTROL_PLANE_URL',
  'CODETETHER_SUPERVISOR_RELAY_ENDPOINT',
  'CODETETHER_SUPERVISOR_RELAY_ID',
  'CODETETHER_SUPERVISOR_RELAY_FINGERPRINT',
])
const values = new Map()

try {
  const contents = await readFile(envPath, 'utf8')
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u)
    if (!match || !allowed.has(match[1])) continue
    values.set(match[1], unquote(match[2]))
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw new Error('Unable to read the local build configuration', { cause: error })
  }
}

for (const key of allowed) {
  if (values.has(key)) continue
  const value = process.env[key]
  if (typeof value === 'string' && value.length > 0) values.set(key, value)
}

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_CODETETHER_CONTROL_PLANE_URL',
]
const missing = required.filter((key) => !values.get(key))
if (missing.length) throw new Error(`Missing required local build variables: ${missing.join(', ')}`)

for (const key of required.filter((name) => name.endsWith('_URL'))) {
  const url = new URL(values.get(key))
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid local build URL for ${key}`)
  }
}

const relayKeys = [
  'CODETETHER_SUPERVISOR_RELAY_ENDPOINT',
  'CODETETHER_SUPERVISOR_RELAY_ID',
  'CODETETHER_SUPERVISOR_RELAY_FINGERPRINT',
]
const relayCount = relayKeys.filter((key) => values.get(key)).length
if (relayCount !== 0 && relayCount !== relayKeys.length) {
  throw new Error('Relay build configuration must be complete or absent')
}

const settings = [
  ['SUPABASE_URL', 'VITE_SUPABASE_URL'],
  ['SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  ['CODETETHER_CONTROL_PLANE_URL', 'VITE_CODETETHER_CONTROL_PLANE_URL'],
  ['RELAY_ENDPOINT', 'CODETETHER_SUPERVISOR_RELAY_ENDPOINT'],
  ['RELAY_ID', 'CODETETHER_SUPERVISOR_RELAY_ID'],
  ['RELAY_FINGERPRINT', 'CODETETHER_SUPERVISOR_RELAY_FINGERPRINT'],
]
const output = settings
  .map(([setting, key]) => `${setting} = ${xcconfigValue(values.get(key) ?? '')}`)
  .join('\n')
  .concat('\n')

await writeFile(destination, output, { encoding: 'utf8', mode: 0o600 })
await chmod(destination, 0o600)
process.stdout.write(`Local iPad build configuration generated; optional Relay settings: ${relayCount === 0 ? 'absent' : 'complete'}\n`)

function unquote(value) {
  if (value.length < 2) return value
  const quote = value[0]
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return value
  const inner = value.slice(1, -1)
  return quote === '"' ? inner.replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\"', '"').replaceAll('\\\\', '\\') : inner
}

function xcconfigValue(value) {
  const containsControl = Array.from(value, (character) => character.codePointAt(0))
    .some((codePoint) => codePoint < 0x20 || codePoint === 0x7f)
  if (containsControl) throw new Error('Local build setting contains a control character')
  if (/[\s"\\]/u.test(value)) throw new Error('Local build setting contains unsupported whitespace or quoting')
  return value.replaceAll('://', ':/$()/')
}
