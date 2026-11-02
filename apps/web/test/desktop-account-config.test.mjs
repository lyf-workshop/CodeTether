import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { desktopAccountConfigErrors } from '../scripts/check-desktop-account-config.mjs'
import { readSupabaseConfiguration } from '../.tmp/test-dist/runtime/account/account-config.js'
import {
  createSupabaseAccountClient,
  getSupabaseAccountClient,
} from '../.tmp/test-dist/runtime/account/supabase-account.js'

const packagedEnvironment = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(32)}`,
  VITE_CODETETHER_CONTROL_PLANE_URL: 'https://api.example.org',
}

test('packaged Desktop public configuration creates an account client without a session', async () => {
  assert.deepEqual(desktopAccountConfigErrors(packagedEnvironment), [])
  const result = readSupabaseConfiguration(packagedEnvironment)
  assert.deepEqual(result.errors, [])
  assert.ok(result.configuration)
  const client = createSupabaseAccountClient(result.configuration)
  assert.equal(client.supabaseUrl, packagedEnvironment.VITE_SUPABASE_URL)
  assert.equal((await client.auth.getSession()).data.session, null)
})

test('missing or invalid public fields produce explicit errors without values', () => {
  assert.deepEqual(desktopAccountConfigErrors({}), [
    'VITE_SUPABASE_URL is missing',
    'VITE_SUPABASE_PUBLISHABLE_KEY is missing',
    'VITE_CODETETHER_CONTROL_PLANE_URL is missing',
  ])
  assert.deepEqual(readSupabaseConfiguration({}).errors, [
    'VITE_SUPABASE_URL is missing',
    'VITE_SUPABASE_PUBLISHABLE_KEY is missing',
  ])
  assert.deepEqual(
    readSupabaseConfiguration({
      ...packagedEnvironment,
      VITE_SUPABASE_URL: 'not-a-url',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'invalid-key',
    }).errors,
    [
      'VITE_SUPABASE_URL is invalid',
      'VITE_SUPABASE_PUBLISHABLE_KEY is invalid',
    ],
  )
  assert.equal(getSupabaseAccountClient(), undefined)
})

test('bundled public configuration can initialize a fresh client after Desktop restart', async () => {
  const firstConfiguration =
    readSupabaseConfiguration(packagedEnvironment).configuration
  const restartedConfiguration =
    readSupabaseConfiguration(packagedEnvironment).configuration
  assert.ok(firstConfiguration)
  assert.ok(restartedConfiguration)
  const first = createSupabaseAccountClient(firstConfiguration)
  const restarted = createSupabaseAccountClient(restartedConfiguration)
  assert.notEqual(first, restarted)
  assert.equal(restarted.supabaseUrl, packagedEnvironment.VITE_SUPABASE_URL)
  assert.equal((await restarted.auth.getSession()).data.session, null)
})

test('Desktop packaging requires the public account configuration preflight', async () => {
  const tauri = await readFile(
    new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url),
    'utf8',
  )
  assert.equal(
    JSON.parse(tauri).build.beforeBuildCommand,
    'pnpm --dir ../web build:desktop',
  )
})
