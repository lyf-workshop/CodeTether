import assert from 'node:assert/strict'
import test from 'node:test'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'
import { act, createDom, h } from './fixtures/dom.mjs'

const { useState } = await import('react')
const reactQuery = await import('@tanstack/react-query')
const { QueryClient, QueryClientProvider } = reactQuery

test('real signin DOM blocks duplicate sends for thirty seconds, counts down elapsed time, then allows an explicit resend', async () => {
  const fixture = await mountSignin()
  try {
    await fixture.enter('input[type="email"]', 'fixture@example.test')
    await fixture.submitTwice()
    assert.equal(fixture.calls.request.length, 1)
    assert.equal(fixture.calls.request[0].options.shouldCreateUser, false)
    assert.match(fixture.resend().textContent, /30 秒/u)
    assert.equal(fixture.resend().disabled, true)
    const otp = fixture.element.querySelector(
      'input[autocomplete="one-time-code"]',
    )
    assert.equal(document.activeElement, otp)
    await act(async () => {
      fixture.resend().click()
    })
    assert.equal(fixture.calls.request.length, 1)
    await fixture.advance(29_000)
    assert.match(fixture.resend().textContent, /1 秒/u)
    assert.equal(fixture.resend().disabled, true)
    assert.equal(
      document.activeElement,
      otp,
      'countdown renders must not steal or reset OTP focus',
    )
    await fixture.advance(1_000)
    assert.equal(fixture.resend().textContent, '重新发送登录码')
    assert.equal(fixture.resend().disabled, false)
    assert.equal(
      fixture.calls.request.length,
      1,
      'expiry must never automatically resend',
    )
    await act(async () => {
      fixture.resend().click()
      fixture.resend().click()
    })
    assert.equal(fixture.calls.request.length, 2)
    assert.match(fixture.resend().textContent, /30 秒/u)
    assert.equal(fixture.timers.size, 1)
  } finally {
    await fixture.cleanup()
  }
  assert.equal(fixture.timers.size, 0, 'unmount must retire the local UI timer')
})

test('signin verification remains usable during resend cooldown and changing email cannot bypass the request guard', async () => {
  const fixture = await mountSignin()
  try {
    await fixture.enter('input[type="email"]', 'fixture@example.test')
    await fixture.submitTwice()
    await fixture.enter('input[autocomplete="one-time-code"]', '123456')
    assert.equal(
      fixture.element.querySelector('button[type="submit"]').disabled,
      false,
    )
    await fixture.submitTwice()
    assert.equal(fixture.calls.verify.length, 1)
    assert.equal(fixture.calls.request.length, 1)
    const change = [...fixture.element.querySelectorAll('button')].find(
      (button) => button.textContent === '更换邮箱',
    )
    await act(async () => {
      change.click()
    })
    assert.equal(
      fixture.element.querySelector('button[type="submit"]').disabled,
      true,
    )
    await fixture.submitTwice()
    assert.equal(fixture.calls.request.length, 1)
  } finally {
    await fixture.cleanup()
  }
})

test('real CommandList DOM retains input focus and a controlled listbox owner with only group and option descendants', async () => {
  const dom = await createDom()
  dom.window.Element.prototype.scrollIntoView = () => {}
  const { CommandList } = loadUiComponent('components/command-list.tsx')
  const element = dom.container
  const groups = [
    {
      id: 'devices',
      label: '设备',
      items: [
        { id: 'one', label: '这台电脑' },
        { id: 'two', label: '测试设备' },
      ],
    },
  ]
  function Harness({ expanded = true, items = groups }) {
    const [highlightedId, setHighlightedId] = useState()
    return h(CommandList, {
      groups: items,
      expanded,
      query: '',
      highlightedId,
      onQueryChange() {},
      onHighlightChange: setHighlightedId,
      onSelect() {},
    })
  }
  try {
    await dom.render(h(Harness))
    const input = element.querySelector('[role="combobox"]')
    const listbox = document.getElementById(input.getAttribute('aria-controls'))
    assert.equal(listbox.getAttribute('role'), 'listbox')
    assert.equal(listbox.children.length, 0)
    for (const id of listbox.getAttribute('aria-owns').split(' ')) {
      const group = document.getElementById(id)
      assert.equal(group.getAttribute('role'), 'group')
      assert.ok(
        [...group.children].every(
          (child) => child.getAttribute('role') === 'option',
        ),
      )
      const heading = document.getElementById(
        group.getAttribute('aria-labelledby'),
      )
      assert.equal(heading.tagName, 'H3')
      assert.equal(listbox.contains(heading), false)
    }
    await act(async () => {
      input.focus()
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
        }),
      )
    })
    assert.equal(document.activeElement, input)
    assert.equal(
      document.getElementById(input.getAttribute('aria-activedescendant'))
        .textContent,
      '测试设备',
    )
    await dom.render(h(Harness, { expanded: false }))
    assert.equal(input.getAttribute('aria-expanded'), 'false')
    assert.equal(input.hasAttribute('aria-activedescendant'), false)
    await dom.render(h(Harness, { items: [] }))
    assert.equal(input.getAttribute('aria-expanded'), 'false')
    assert.equal(
      listbox.contains(element.querySelector('[role="status"]')),
      false,
    )
  } finally {
    await dom.close()
  }
})

async function mountSignin() {
  const dom = await createDom()
  const calls = { request: [], verify: [] }
  const supabase = {
    auth: {
      async signInWithOtp(request) {
        calls.request.push(request)
        return { error: null }
      },
      async verifyOtp(request) {
        calls.verify.push(request)
        return { error: null }
      },
    },
  }
  const query = { data: null, isError: false, async refetch() {} }
  const navigate = () => assert.fail('Unexpected real navigation')
  const dependencies = new Map([
    ['@tanstack/react-query', reactQuery],
    [
      '../../runtime/account/use-account-session',
      {
        accountSessionQueryKey: ['fixture-account-session'],
        useAccountSession: () => ({ supabase, query }),
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => navigate,
        Link: ({ to, children, ...props }) =>
          h('a', { href: to, ...props }, children),
      },
    ],
    ['./account-settings', { AccountConfigurationNotice: () => null }],
  ])
  const { SignInPage } = loadWebComponent(
    'components/settings/sign-in-page.tsx',
    dependencies,
  )
  const element = dom.container
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  let now = 100_000,
    nextTimer = 0
  const timers = new Map()
  const dateNow = Date.now,
    setTimeout = window.setTimeout,
    clearTimeout = window.clearTimeout
  const originalFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    'requestAnimationFrame',
  )
  globalThis.requestAnimationFrame = (callback) => {
    callback()
    return 0
  }
  Date.now = () => now
  window.setTimeout = (callback, delay) => {
    const id = ++nextTimer
    timers.set(id, { callback, due: now + delay })
    return id
  }
  window.clearTimeout = (id) => timers.delete(id)
  const cleanup = async () => {
    await dom.close()
    queryClient.clear()
    Date.now = dateNow
    dom.window.setTimeout = setTimeout
    dom.window.clearTimeout = clearTimeout
    if (originalFrame === undefined) delete globalThis.requestAnimationFrame
    else
      Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame)
  }
  try {
    await dom.render(
      h(QueryClientProvider, { client: queryClient }, h(SignInPage)),
    )
  } catch (error) {
    await cleanup()
    throw error
  }
  return {
    calls,
    element,
    timers,
    resend: () =>
      [...element.querySelectorAll('button')].find((button) =>
        button.textContent.startsWith('重新发送登录码'),
      ),
    async enter(selector, value) {
      const input = element.querySelector(selector)
      await dom.input(input, value)
    },
    async submitTwice() {
      await act(async () => {
        for (let index = 0; index < 2; index += 1)
          element.querySelector('form').dispatchEvent(
            new dom.window.Event('submit', {
              bubbles: true,
              cancelable: true,
            }),
          )
      })
    },
    async advance(milliseconds) {
      now += milliseconds
      await act(async () => {
        for (const [id, timer] of [...timers])
          if (timer.due <= now) {
            timers.delete(id)
            timer.callback()
          }
      })
    },
    cleanup,
  }
}
