import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const source = (name) =>
  readFile(new URL('../src/' + name, import.meta.url), 'utf8')

test('workspace shortcuts admit only explicit non-composing unhandled modifiers', () => {
  const { workspaceShortcut } = loadWebComponent(
    'components/app-shell/workspace-shortcuts.ts',
  )
  const key = { key: 'k', ctrlKey: true }
  assert.equal(workspaceShortcut(key), 'palette')
  assert.equal(workspaceShortcut({ key: 'K', metaKey: true }), 'palette')
  assert.equal(
    workspaceShortcut({ key: 'n', metaKey: true }),
    'new-conversation',
  )
  assert.equal(workspaceShortcut({ key: ',', ctrlKey: true }), 'settings')
  assert.equal(workspaceShortcut({ key: 'k' }), undefined)
  for (const flag of [
    'altKey',
    'shiftKey',
    'repeat',
    'isComposing',
    'defaultPrevented',
  ])
    assert.equal(workspaceShortcut({ ...key, [flag]: true }), undefined)
  assert.equal(workspaceShortcut({ ...key, keyCode: 229 }), undefined)
  assert.equal(workspaceShortcut({ ...key, key: 'p' }), undefined)
})

test('pending dialog blocks Settings navigation from Ctrl comma as well as Ctrl N and K', () => {
  const { workspaceNavigationBlocked, workspaceShortcut } = loadWebComponent(
    'components/app-shell/workspace-shortcuts.ts',
  )
  for (const active of ['new-conversation', 'add-project', 'command-palette']) {
    const navigations = []
    const shortcut = workspaceShortcut({ key: ',', ctrlKey: true })
    if (!workspaceNavigationBlocked(active, false)) navigations.push(shortcut)
    assert.deepEqual(navigations, [])
  }
  assert.equal(workspaceNavigationBlocked(null, true), true)
  assert.equal(workspaceNavigationBlocked(null, false), false)
})

test('one synchronous dialog owner guards palette and new-conversation shortcuts without an old settings modal', async () => {
  const shell = await source('components/app-shell/app-shell.tsx')
  assert.match(
    shell,
    /'add-project' \| 'new-conversation' \| 'command-palette' \| null/u,
  )
  assert.match(shell, /globalDialogRef\.current = nextDialog/u)
  assert.match(shell, /globalDialogRef\.current === 'command-palette'/u)
  assert.match(shell, /globalDialogRef\.current !== null/u)
  assert.match(shell, /role="dialog"/u)
  assert.match(shell, /workspaceShortcut\(event\)/u)
  const shortcut = shell.slice(
    shell.indexOf('function handleShortcut'),
    shell.indexOf("window.addEventListener('keydown'"),
  )
  assert.ok(
    shortcut.indexOf('workspaceNavigationBlocked(') <
      shortcut.indexOf("event.key.toLowerCase() === 'n'"),
  )
  assert.ok(
    shortcut.indexOf('modalBlocksNavigation') <
      shortcut.indexOf('void navigate({'),
  )
  assert.match(shell, /removeEventListener\('keydown', handleShortcut\)/u)
  assert.match(shell, /kind: 'preselected'/u)
  assert.match(shell, /kind: 'fixed-project'/u)
  assert.match(shell, /<CommandPalette/u)
  assert.match(
    shell,
    /onSearch=\{\(event\) => openPalette\(event\.currentTarget\)\}/u,
  )
  assert.match(shell, /onSettings=\{[\s\S]*section: 'appearance'/u)
  assert.match(shell, /onAddDevice=\{[\s\S]*to: '\/add'/u)
  assert.match(shell, /<MobileWorkspaceNavigation/u)
  assert.doesNotMatch(
    shell,
    /settingsOpen|setSettingsOpen|<DesktopNotificationSettings|<DialogContent/u,
  )
  assert.doesNotMatch(shell, /inboxAttentionCount = 0/u)
})

test('typed mobile parent keeps exact route params/search and never uses guessed history', async () => {
  const [topbar, root, sidebar, responsive] = await Promise.all([
    source('components/app-shell/top-bar.tsx'),
    source('components/app-shell/root-layout.tsx'),
    source('components/app-shell/workspace-sidebar.tsx'),
    source('components/app-shell/workspace-responsive.css'),
  ])
  assert.match(topbar, /data-slot="desktop-breadcrumbs"/u)
  assert.match(topbar, /data-slot="mobile-breadcrumb"/u)
  assert.match(topbar, /data-slot="mobile-back-link"/u)
  assert.match(
    topbar,
    /resolvedBreadcrumbs[\s\S]*\.slice\(0, -1\)[\s\S]*\.reverse\(\)[\s\S]*\.find\(/u,
  )
  assert.match(topbar, /children \?\? breadcrumb\.label/u)
  assert.match(topbar, /search=\{breadcrumb\.search\}/u)
  assert.match(topbar, /to: '\/settings\/\$section'/u)
  assert.doesNotMatch(topbar, /history\.back|navigate\(-1\)/u)
  for (const path of [
    '/add',
    '/add/node',
    '/signin',
    '/roadmap',
    '/settings/appearance',
    '/settings/account',
    '/settings/notify',
    '/settings/background',
    '/settings/about',
  ])
    assert.ok(root.includes("'" + path + "':"), path)
  assert.match(root, /currentPath === '\/onboarding'/u)
  assert.match(root, /machineId: currentMachineId/u)
  assert.match(
    sidebar,
    /onSearch\?: \(event: MouseEvent<HTMLButtonElement>\) => void/u,
  )
  assert.match(sidebar, /data-slot="workspace-sidebar-search"/u)
  assert.match(sidebar, /section: 'account'/u)
  assert.match(responsive, /workspace-global-search/u)
})

test('settings and Doctor redirects keep only validated project context and real onboarding remains durable', async () => {
  const [router, settings, startup, about] = await Promise.all([
    source('router.tsx'),
    source('components/settings/settings-page.tsx'),
    source('components/onboarding/startup-gate.tsx'),
    source('components/settings/about-settings.tsx'),
  ])
  const doctor = router.slice(
    router.indexOf('const doctorRoute'),
    router.indexOf('const conversationRoute'),
  )
  assert.match(doctor, /validateSearch: parseSettingsSearch/u)
  assert.match(doctor, /section: 'about'/u)
  assert.match(doctor, /search: parseSettingsSearch\(search\)/u)
  assert.doesNotMatch(doctor, /component: DoctorPage/u)
  assert.match(router, /path: '\/settings\/\$section'/u)
  assert.match(router, /path: '\/onboarding'[\s\S]*component: OnboardingPage/u)
  assert.match(router, /path: '\/setup'[\s\S]*to: '\/onboarding'/u)
  assert.match(
    settings,
    /parseSettingsSearch\(useSearch\(\{ strict: false \}\)\)/u,
  )
  assert.equal((settings.match(/search=\{search\}/gu) ?? []).length, 2)
  assert.match(startup, /onboardingQuery\.data\.step === 'ready'/u)
  assert.match(startup, /<Navigate to="\/onboarding" replace/u)
  assert.match(
    about,
    /runtime\.updateOnboarding\(progress\.revision, \{ kind: 'reopen' \}\)/u,
  )
  assert.match(about, /to: '\/onboarding'/u)
})

test('Add Project focus return is optional, never overrides sibling/navigated success or active import', async () => {
  const [dialog, shell] = await Promise.all([
    source('components/projects/add-project-dialog.tsx'),
    source('components/app-shell/app-shell.tsx'),
  ])
  assert.match(dialog, /returnFocusRef\?: RefObject<HTMLElement \| null>/u)
  assert.match(dialog, /skipCloseFocusRestore\.current = true/u)
  assert.match(dialog, /onCloseAutoFocus=\{/u)
  assert.match(dialog, /returnFocusRef\?\.current\?\.isConnected/u)
  assert.match(dialog, /completionInFlightRef\.current/u)
  assert.match(dialog, /registrationInFlightRef\.current/u)
  assert.match(
    shell,
    /returnFocusRef=\{\s*returnToConversation \? undefined : commandPaletteTriggerRef\s*\}/u,
  )
  assert.match(
    shell,
    /newConversationTriggerRef\.current = commandPaletteTriggerRef\.current/u,
  )
})

test('project and conversation modal headings match the title-and-description prototype without invented icon tiles', async () => {
  for (const name of [
    'projects/add-project-dialog.tsx',
    'conversations/new-conversation-dialog.tsx',
  ]) {
    const dialog = await source('components/' + name)
    const heading = dialog.slice(
      dialog.indexOf('<DialogHeader>'),
      dialog.indexOf('</DialogHeader>'),
    )
    assert.match(heading, /<DialogTitle>/u)
    assert.match(heading, /<DialogDescription>/u)
    assert.doesNotMatch(
      heading,
      /<Plus|aria-hidden|bg-primary|place-items-center/u,
    )
  }
})

test('embedded Doctor uses Chinese product labels without changing typed diagnostic codes', async () => {
  const doctor = await source('components/doctor/doctor-page.tsx')
  for (const label of ['AI 工具状态', 'Relay 注册状态', 'Node 在线状态'])
    assert.ok(doctor.includes(label), label)
  assert.match(doctor, /AI 工具的官方登录/u)
  assert.match(doctor, /此 AI 工具版本不受支持/u)
  assert.doesNotMatch(
    doctor,
    /label="Provider 状态"|label="Relay enrollment"|label="Node presence"/u,
  )
  assert.match(doctor, /machine\.relay\.enrollment/u)
  assert.match(doctor, /machine\.relay\.nodePresence/u)
})

test('F05 keeps permanent Doctor under About without a product topbar entry', async () => {
  const [shell, about, settings] = await Promise.all([
    source('components/app-shell/app-shell.tsx'),
    source('components/settings/about-settings.tsx'),
    source('components/settings/settings-page.tsx'),
  ])
  assert.doesNotMatch(shell, /onDoctor=/u)
  assert.match(about, /<DoctorPage embedded/u)
  assert.match(settings, /id: 'about'/u)
  assert.match(settings, /to="\/settings\/\$section"/u)
  assert.match(about, /kind: 'reopen'/u)
})
