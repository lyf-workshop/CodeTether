import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { OnboardingWelcome, OnboardingCompletion, OnboardingProgress } =
  loadWebComponent('components/onboarding/onboarding-step-layout.tsx')

test('actual Welcome uses approved mark, left-aligned headline and three true product features', () => {
  const html = renderToStaticMarkup(
    h(OnboardingWelcome, {}, h('button', { type: 'button' }, '开始设置')),
  )
  assert.match(html, /data-slot="onboarding-welcome"/u)
  assert.match(html, /data-slot="code-tether-mark"/u)
  assert.match(html, /你的 AI 编程助手，<br\/>在你的每台设备上都能接着用/u)
  for (const label of [
    '在这台电脑上工作',
    '你的所有设备在一处',
    '需要你的时候提醒你',
  ])
    assert.ok(html.includes(label))
  assert.equal((html.match(/data-slot="onboarding-feature"/gu) ?? []).length, 3)
  assert.match(html, /在这台电脑上使用不需要账号/u)
  assert.match(html, /开始设置/u)
  assert.doesNotMatch(
    html,
    /text-center|bg-primary|大约 1 分钟|data-slot="card"/u,
  )
})

test('actual six-line progress retains current step and accessible labels without numbered circles', () => {
  const html = renderToStaticMarkup(h(OnboardingProgress, { current: 1 }))
  assert.match(html, /aria-label="设置进度"/u)
  assert.equal((html.match(/<li/gu) ?? []).length, 6)
  assert.equal((html.match(/aria-current="step"/gu) ?? []).length, 1)
  assert.equal((html.match(/data-complete="true"/gu) ?? []).length, 2)
  assert.match(html, /检查 AI 工具/u)
  assert.doesNotMatch(html, /rounded-full|size-7/u)
})

for (const ready of [true, false]) {
  test(
    'completion layout preserves actual readiness and owned status/action children: ' +
      ready,
    () => {
      const html = renderToStaticMarkup(
        h(
          OnboardingCompletion,
          {
            ready,
            description: ready
              ? '你可以打开项目并开始工作。'
              : '项目和历史记录可以使用；AI 工具就绪后才能开始新一轮工作。',
          },
          h('p', { role: 'status' }, '真实上下文状态'),
          h('button', { type: 'button' }, '打开 CodeTether'),
        ),
      )
      assert.match(html, /真实上下文状态/u)
      assert.match(html, /打开 CodeTether/u)
      assert.equal(
        (html.match(/data-slot="onboarding-feature"/gu) ?? []).length,
        3,
      )
      assert.match(html, /设备 › 项目 › 会话/u)
      assert.match(html, /已加载的会话标题、项目和设备/u)
      if (ready) {
        assert.match(html, /一切就绪/u)
        assert.match(html, /data-execution-ready="true"/u)
      } else {
        assert.match(html, /CodeTether 设置完成/u)
        assert.match(html, /AI 工具就绪后才能开始新一轮工作/u)
        assert.doesNotMatch(html, /一切就绪|data-execution-ready="true"/u)
      }
    },
  )
}
