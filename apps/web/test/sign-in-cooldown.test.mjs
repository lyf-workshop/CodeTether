import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { SIGN_IN_RESEND_COOLDOWN_MS, signInResendSeconds } = loadWebComponent(
  'components/settings/sign-in-cooldown.ts',
)

test('sign-in resend cooldown is exactly thirty seconds and rounds remaining partial seconds up', () => {
  const now = 10_000
  const availableAt = now + SIGN_IN_RESEND_COOLDOWN_MS
  assert.equal(SIGN_IN_RESEND_COOLDOWN_MS, 30_000)
  assert.equal(signInResendSeconds(availableAt, now), 30)
  assert.equal(signInResendSeconds(availableAt, now + 1), 30)
  assert.equal(signInResendSeconds(availableAt, now + 1_000), 29)
  assert.equal(signInResendSeconds(availableAt, availableAt - 1), 1)
  assert.equal(signInResendSeconds(availableAt, availableAt), 0)
  assert.equal(signInResendSeconds(availableAt, availableAt + 60_000), 0)
})

test('cooldown accounts for a suspended tab using elapsed time rather than counting timer ticks', () => {
  assert.equal(signInResendSeconds(40_000, 39_500), 1)
  assert.equal(signInResendSeconds(40_000, 45_000), 0)
  assert.equal(signInResendSeconds(0, 45_000), 0)
})

test('signin enforces cooldown before requesting and disposes its UI timer without sending or storing credentials', async () => {
  const source = await readFile(
    new URL('../src/components/settings/sign-in-page.tsx', import.meta.url),
    'utf8',
  )
  const run = source.slice(
    source.indexOf('async function run('),
    source.indexOf('function submit('),
  )
  assert.match(
    run,
    /action === 'request' &&\s*signInResendSeconds\(resendAvailableAtRef\.current\) > 0/u,
  )
  assert.ok(
    run.indexOf('signInResendSeconds') < run.indexOf('mutation.mutateAsync'),
  )
  assert.match(source, /disabled=\{busy \|\| resendSeconds > 0\}/u)
  assert.match(source, /重新发送登录码（\$\{resendSeconds\} 秒）/u)
  assert.match(source, /window\.clearTimeout/u)
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|setInterval|autoRetry/u,
  )
})
