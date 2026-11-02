import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

import {
  normalizeAccountEmail,
  normalizeAccountOtp,
  requestAccountSignInCode,
  verifyAccountSignInCode,
  accountSignInErrorMessage,
  presentAccountSession,
} from '../.tmp/test-dist/runtime/account/account-auth-actions.js'
import {
  settingsSectionFromPath,
  parseSettingsSearch,
} from '../.tmp/test-dist/components/settings/settings-model.js'

test('theme previews resolve the nested theme tokens rather than inherited page aliases', async () => {
  const source = await readFile(
    new URL(
      '../src/components/settings/appearance-settings.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const preview = source.slice(source.indexOf('function ThemePreview'))
  for (const token of ['--ct-bg', '--ct-side', '--ct-line-strong', '--ct-ink'])
    assert.ok(preview.includes(token), token)
  assert.doesNotMatch(
    preview,
    /bg-background|bg-navigation|bg-text-muted|bg-primary-action/u,
  )
})

test('settings sections are bounded, canonical and do not expose a Host directory', () => {
  for (const section of [
    'appearance',
    'account',
    'notify',
    'background',
    'about',
  ])
    assert.equal(settingsSectionFromPath('/settings/' + section), section)
  assert.equal(settingsSectionFromPath('/settings'), 'appearance')
  assert.equal(settingsSectionFromPath('/settings/unknown'), 'appearance')
  assert.equal(settingsSectionFromPath('/settings/account/extra'), 'appearance')
})

test('account session presentation never duplicates access or refresh credentials', () => {
  assert.equal(presentAccountSession(null), null)
  assert.deepEqual(
    presentAccountSession({
      user: { id: 'user-1', email: 'user@example.com' },
      access_token: 'private-access',
      refresh_token: 'private-refresh',
    }),
    { userId: 'user-1', email: 'user@example.com' },
  )
  assert.deepEqual(presentAccountSession({ user: { id: 'user-2' } }), {
    userId: 'user-2',
  })
})

test('legacy Doctor and settings routes preserve only a validated public Project context', async () => {
  assert.deepEqual(
    parseSettingsSearch({
      projectId: 'proj_settings_context',
      secret: 'ignored',
    }),
    { projectId: 'proj_settings_context' },
  )
  for (const value of [
    undefined,
    'invalid',
    '../secret',
    { projectId: 'proj_settings_context' },
  ])
    assert.deepEqual(parseSettingsSearch({ projectId: value }), {})
  const router = await source('router.tsx')
  const doctor = router.slice(
    router.indexOf('const doctorRoute'),
    router.indexOf('const conversationRoute'),
  )
  assert.match(doctor, /beforeLoad: \(\{ search \}\) =>/u)
  assert.match(doctor, /to: '\/settings\/\$section'/u)
  assert.match(doctor, /section: 'about'/u)
  assert.match(doctor, /search: parseSettingsSearch\(search\)/u)
  assert.match(
    router,
    /path: '\/settings\/\$section',[\s\S]*?validateSearch: parseSettingsSearch/u,
  )
})

test('email and login code validation preserves the existing account-only contract', async () => {
  assert.equal(
    normalizeAccountEmail('  user@example.com  '),
    'user@example.com',
  )
  assert.equal(normalizeAccountOtp(' 123456 '), '123456')
  assert.equal(normalizeAccountOtp('1234567890'), '1234567890')
  for (const invalid of ['', 'user', 'a@', 'x'.repeat(321) + '@test.com'])
    assert.throws(() => normalizeAccountEmail(invalid))
  for (const invalid of ['12345', '12345678901', '12345a', '12 3456'])
    assert.throws(() => normalizeAccountOtp(invalid))
  const calls = []
  const client = {
    auth: {
      signInWithOtp: async (request) => {
        calls.push(['request', request])
        return { error: null }
      },
      verifyOtp: async (request) => {
        calls.push(['verify', request])
        return { error: null }
      },
    },
  }
  await requestAccountSignInCode(client, ' user@example.com ')
  await verifyAccountSignInCode(client, 'user@example.com', ' 123456 ')
  assert.deepEqual(calls, [
    [
      'request',
      { email: 'user@example.com', options: { shouldCreateUser: false } },
    ],
    ['verify', { email: 'user@example.com', token: '123456', type: 'email' }],
  ])
})

test('account action failures are localized and never reveal provider credentials', async () => {
  const secret = new Error('Authorization: Bearer private-session')
  const client = {
    auth: {
      signInWithOtp: async () => ({ error: secret }),
      verifyOtp: async () => {
        throw secret
      },
    },
  }
  await assert.rejects(requestAccountSignInCode(client, 'user@example.com'))
  await assert.rejects(
    verifyAccountSignInCode(client, 'user@example.com', '123456'),
  )
  for (const stage of ['email', 'otp']) {
    const copy = accountSignInErrorMessage(secret, stage)
    assert.match(copy, /登录码/u)
    assert.doesNotMatch(copy, /Authorization|Bearer|private-session/u)
  }
  assert.match(
    accountSignInErrorMessage(new Error('account_email_invalid'), 'email'),
    /有效的邮箱/u,
  )
  assert.match(
    accountSignInErrorMessage(new Error('account_otp_invalid'), 'otp'),
    /数字登录码/u,
  )
})

test('settings uses one theme owner, existing desktop preference persistence, real session and Doctor actions', async () => {
  const [appearance, account, about, session, signin] = await Promise.all([
    source('components/settings/appearance-settings.tsx'),
    source('components/settings/account-settings.tsx'),
    source('components/settings/about-settings.tsx'),
    source('runtime/account/use-account-session.ts'),
    source('components/settings/sign-in-page.tsx'),
  ])
  assert.match(appearance, /useSyncExternalStore/u)
  assert.match(appearance, /getThemeController\(\)\.setPreference/u)
  assert.doesNotMatch(appearance, /localStorage|dataset\.theme/u)
  const dom = await createDom()
  const { DesktopNotificationSettings } = loadWebComponent(
    'components/settings/desktop-notification-settings.tsx',
  )
  const saved = new Map()
  let saveFails = false
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      if (saveFails) throw new Error('fixture storage unavailable')
      saved.set(key, value)
    },
  }
  try {
    await dom.render(
      h(DesktopNotificationSettings, { notificationAvailable: true, storage }),
    )
    const switches = [...dom.container.querySelectorAll('[role="switch"]')]
    assert.equal(switches.length, 3)
    for (const control of switches) {
      assert.equal(control.getAttribute('aria-checked'), 'true')
      assert.ok(
        document.getElementById(control.getAttribute('aria-describedby'))
          ?.textContent,
      )
    }
    await dom.perform(() => switches[0].click())
    assert.equal(switches[0].getAttribute('aria-checked'), 'false')
    assert.equal(JSON.parse([...saved.values()][0]).enabled.approval, false)
    saveFails = true
    await dom.perform(() => switches[0].click())
    assert.equal(
      switches[0].getAttribute('aria-checked'),
      'false',
      'failed persistence must retain the previous preference',
    )
    assert.match(
      dom.container.querySelector('[role="alert"]').textContent,
      /当前设置未更改/u,
    )
    await dom.render(
      h(DesktopNotificationSettings, { notificationAvailable: false }),
    )
    assert.equal(dom.container.querySelector('[role="switch"]'), null)
    assert.match(dom.container.textContent, /通知中不包含会话标题/u)
    assert.match(dom.container.textContent, /浏览器中请查看“待处理”/u)
  } finally {
    await dom.close()
  }
  assert.match(account, /supabase\.auth\.signOut\(\)/u)
  assert.match(session, /auth\.getSession\(\)/u)
  assert.match(session, /onAuthStateChange/u)
  assert.match(session, /subscription\.unsubscribe\(\)/u)
  assert.match(session, /useQuery\(/u)
  assert.match(about, /<DoctorPage embedded/u)
  assert.match(
    about,
    /runtime\.updateOnboarding\(progress\.revision, \{ kind: 'reopen' \}\)/u,
  )
  assert.match(signin, /requestAccountSignInCode/u)
  assert.match(signin, /verifyAccountSignInCode/u)
  assert.match(signin, /autoComplete="one-time-code"/u)
  assert.match(signin, /更换邮箱/u)
  assert.match(signin, /role="alert"/u)
  for (const text of [account, session, signin]) {
    assert.doesNotMatch(
      text,
      /listOwnedHosts|listAuthorizedHosts|enrollLocalHost|requestHostAccess|supervisor_control|access_token|refresh_token/u,
    )
  }
})

test('background settings links unavailable autostart only to the roadmap without a fake toggle', async () => {
  const { BackgroundSettings } = loadWebComponent(
    'components/settings/background-settings.tsx',
    new Map([
      [
        '@tanstack/react-router',
        { Link: ({ to, children }) => h('a', { href: to }, children) },
      ],
    ]),
  )
  const desktop = renderToStaticMarkup(
    h(BackgroundSettings, { available: true }),
  )
  assert.match(desktop, /href="\/roadmap"/u)
  assert.match(desktop, /查看后续规划/u)
  assert.doesNotMatch(desktop, /role="switch"|data-tone="off"/u)
  assert.match(desktop, /始终开启/u)
  const browser = renderToStaticMarkup(h(BackgroundSettings))
  assert.match(browser, /浏览器没有桌面后台运行能力/u)
  assert.doesNotMatch(browser, /始终开启|role="switch"/u)
})

test('notification metadata uses only cold device/project context and never hydrates conversation titles', async () => {
  const [main, metadataReader, model] = await Promise.all([
    source('main.tsx'),
    source('runtime/notifications/attention-notification-metadata.ts'),
    source('runtime/notifications/desktop-notification-model.ts'),
  ])
  const metadata = main.slice(
    main.indexOf('resolveMetadata:'),
    main.indexOf('navigate: async'),
  )
  assert.match(metadata, /resolveAttentionNotificationMetadata/u)
  assert.match(metadataReader, /projectDetailQueryOptions/u)
  assert.match(metadataReader, /allProjectConversationsQueryOptions/u)
  assert.match(
    metadataReader,
    /candidate\.conversationId === attention\.conversationId/u,
  )
  assert.match(
    metadataReader,
    /candidate\.machineId === conversation\.machineId/u,
  )
  assert.doesNotMatch(
    metadata,
    /conversationTitle|conversationListQueryOptions|getConversation|payload/u,
  )
  assert.doesNotMatch(
    metadataReader,
    /conversationTitle|getConversation|\.title|payload/u,
  )
  assert.doesNotMatch(model, /metadata\.conversationTitle|CONVERSATION_TITLE_/u)
})

async function source(path) {
  return readFile(new URL('../src/' + path, import.meta.url), 'utf8')
}
