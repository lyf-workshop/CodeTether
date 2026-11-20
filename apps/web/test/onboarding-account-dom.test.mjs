import assert from 'node:assert/strict'
import test from 'node:test'
import * as reactQuery from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { QueryClient, QueryClientProvider } = reactQuery

test('first-run screens link to the existing account settings and return to the same setup step', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  })
  t.after(() => queryClient.clear())
  const { onboardingQueryKeys } = loadWebComponent(
    'runtime/host/onboarding-query.ts',
  )
  let navigate
  let progress = { step: 'welcome', revision: 1 }
  const runtime = {
    async getOnboarding() {
      return { onboarding: progress }
    },
    async getMachine(machineId) {
      return { machine: { machineId }, providers: [] }
    },
    async getDoctor() {
      return {
        doctor: {
          thisComputer: {
            machineId: 'machine_account01',
            displayName: '测试电脑',
            platform: 'win32',
            architecture: 'x64',
            state: 'ready',
          },
          providers: [],
        },
      }
    },
    async updateOnboarding(revision, transition) {
      assert.equal(revision, 1)
      assert.deepEqual(transition, { kind: 'continue' })
      progress = { step: 'computer_check', revision: 2 }
      queryClient.setQueryData(onboardingQueryKeys.progress, progress)
      return { data: { onboarding: progress } }
    },
  }
  const hostHooks = {
    useHostRuntime: () => runtime,
    useHostConnectionState: () => 'connected',
  }
  const dependencies = new Map([
    ['@tanstack/react-query', reactQuery],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => navigate,
        Navigate: ({ to }) => {
          useEffect(() => navigate(to), [to])
          return null
        },
        Link: ({ to, params, children, ...props }) => {
          const href = to.replace('$section', params?.section ?? '$section')
          return h(
            'a',
            {
              ...props,
              href,
              onClick: (event) => {
                event.preventDefault()
                navigate(href)
              },
            },
            children,
          )
        },
      },
    ],
    ['./onboarding-layout.css', {}],
    ['../../runtime/host/host-runtime-hooks', hostHooks],
    ['../runtime/host/host-runtime-hooks', hostHooks],
    [
      '../../runtime/account/use-account-session',
      {
        useAccountSession: () => ({ supabase: {}, query: { data: null } }),
      },
    ],
  ])
  const { StartupGate } = loadWebComponent(
    'components/onboarding/startup-gate.tsx',
    dependencies,
  )
  const { OnboardingPage } = loadWebComponent(
    'components/onboarding/onboarding-page.tsx',
    dependencies,
  )
  const { AccountSettings } = loadWebComponent(
    'components/settings/account-settings.tsx',
    dependencies,
  )
  const routes = {
    '/': StartupGate,
    '/onboarding': OnboardingPage,
    '/settings/account': AccountSettings,
  }
  function Harness() {
    const [path, setPath] = useState('/')
    navigate = setPath
    return h(routes[path])
  }
  for (const [key, value] of Object.entries({
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (original === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, original)
    })
  }
  await dom.render(h(QueryClientProvider, { client: queryClient }, h(Harness)))

  function find(selector, title) {
    return [...dom.container.querySelectorAll(selector)].find(
      (element) => element.textContent.trim() === title,
    )
  }

  async function openAccountAndReturn(expectedHeading) {
    const entry = find('a', '已有账号？登录')
    assert.equal(entry.getAttribute('href'), '/settings/account')
    assert.equal(entry.tabIndex, 0)
    await dom.perform(() => {
      entry.focus()
      assert.equal(dom.window.document.activeElement, entry)
      entry.click()
    })
    await dom.until(() => find('h1', '账号'))
    const returnLink = find('a', '返回设置向导')
    assert.equal(returnLink.getAttribute('href'), '/onboarding')
    await dom.perform(() => returnLink.click())
    await dom.until(() => find('h1', expectedHeading))
    assert.equal(dom.container.querySelectorAll('h1').length, 1)
    await dom.until(
      () =>
        dom.window.document.activeElement ===
        dom.container.querySelector('#setup-main'),
    )
  }

  await dom.until(() => find('button', '开始设置'))
  assert.match(dom.container.textContent, /在这台电脑上使用不需要账号/u)
  await openAccountAndReturn('你的 AI 编程助手，在你的每台设备上都能接着用')
  assert.equal(progress.revision, 1)

  await dom.perform(() => find('button', '开始设置').click())
  await dom.until(() => find('h1', '检查 AI 工具'))
  await openAccountAndReturn('检查 AI 工具')
  assert.equal(progress.revision, 2)
})
