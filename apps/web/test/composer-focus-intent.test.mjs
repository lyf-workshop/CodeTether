import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const webSource = resolve(import.meta.dirname, '../src')

test('create navigation carries one transient Composer focus intent', async () => {
  const [dialog, route, router, composer, handoff] = await Promise.all([
    sourceOf('components/conversations/new-conversation-dialog.tsx'),
    sourceOf('components/conversation/conversation-detail-route.tsx'),
    sourceOf('router.tsx'),
    sourceOf('components/conversation/composer.tsx'),
    sourceOf('components/conversation/composer-focus-handoff.ts'),
  ])
  const navigationIndex = dialog.indexOf('await navigate({')
  const closeIndex = dialog.indexOf('closeAfterSuccess()', navigationIndex)

  assert.ok(navigationIndex >= 0)
  assert.ok(closeIndex > navigationIndex)
  assert.match(dialog, /search: \{ focus: 'composer' \}/u)
  assert.match(dialog, /skipCloseFocusRestore\.current = true/u)
  assert.match(dialog, /event\.preventDefault\(\)/u)
  assert.match(router, /focus: search\.focus === 'composer'/u)
  assert.match(route, /focus !== 'composer'/u)
  assert.match(route, /startComposerFocusHandoff/u)
  assert.match(route, /handledFocusRequestRef/u)
  assert.match(route, /new MutationObserver/u)
  assert.match(route, /replace: true/u)
  assert.match(handoff, /target\?\.focus\(\)/u)
  assert.match(handoff, /COMPOSER_FOCUS_HANDOFF_TIMEOUT_MS = 5_000/u)
  assert.doesNotMatch(route, /conversationComposerFocusIntents/u)
  assert.doesNotMatch(composer, /autoFocus=/u)
  assert.doesNotMatch(composer, /timeline\.blocks\.length/u)
})

test('Composer focus handoff is one-shot across duplicate effect setup', async () => {
  const { startComposerFocusHandoff } =
    await import('../.tmp/test-dist/components/conversation/composer-focus-handoff.js')
  let claimed = false
  let focused = 0
  let cleared = 0

  const options = {
    isBlocked: () => false,
    getTarget: () => ({ focus: () => (focused += 1) }),
    claim: () => {
      if (claimed) return false
      claimed = true
      return true
    },
    clearIntent: () => (cleared += 1),
    observe: () => () => undefined,
    scheduleTimeout: () => () => undefined,
  }

  startComposerFocusHandoff(options)
  startComposerFocusHandoff(options)

  assert.equal(focused, 1)
  assert.equal(cleared, 1)
})

test('Composer focus handoff waits for dialog close and expires safely', async () => {
  const { startComposerFocusHandoff } =
    await import('../.tmp/test-dist/components/conversation/composer-focus-handoff.js')
  let blocked = true
  let target = null
  let observed
  let expires
  let focused = 0
  let cleared = 0
  let observerStopped = 0
  let timeoutCancelled = 0

  const createOptions = () => ({
    isBlocked: () => blocked,
    getTarget: () => target,
    claim: () => true,
    clearIntent: () => (cleared += 1),
    observe: (onChange) => {
      observed = onChange
      return () => (observerStopped += 1)
    },
    scheduleTimeout: (onTimeout) => {
      expires = onTimeout
      return () => (timeoutCancelled += 1)
    },
  })

  startComposerFocusHandoff(createOptions())
  observed()
  assert.equal(focused, 0)

  blocked = false
  target = { focus: () => (focused += 1) }
  observed()
  assert.equal(focused, 1)
  assert.equal(cleared, 1)
  assert.equal(observerStopped, 1)
  assert.equal(timeoutCancelled, 1)

  target = null
  startComposerFocusHandoff(createOptions())
  expires()
  observed()
  assert.equal(focused, 1)
  assert.equal(cleared, 2)
  assert.equal(observerStopped, 2)
  assert.equal(timeoutCancelled, 2)
})

async function sourceOf(relativePath) {
  return await readFile(resolve(webSource, relativePath), 'utf8')
}
