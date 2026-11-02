import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const { CommandCopyTask, COMMAND_COPY_TIMEOUT_MS } = loadUiComponent(
  'components/product/command-copy-task.ts',
)
const { CommandBlock } = loadUiComponent('components/product/command-block.tsx')
const { NodeSetupInstructions } = loadWebComponent(
  'components/machines/node-setup-instructions.tsx',
)
const { nodePairingCommands } = loadWebComponent(
  'components/machines/node-pairing-model.ts',
)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

test('copy task is cold until explicit action and reports exact successful command only after fulfillment', async () => {
  const task = new CommandCopyTask()
  const write = deferred()
  const commands = []
  assert.equal(task.getSnapshot(), 'idle')
  const pending = task.copy(
    'safe-command --flag "folder with spaces"',
    (text) => {
      commands.push(text)
      return write.promise
    },
  )
  assert.equal(task.getSnapshot(), 'pending')
  assert.deepEqual(commands, ['safe-command --flag "folder with spaces"'])
  write.resolve()
  await pending
  assert.equal(task.getSnapshot(), 'copied')
  task.dispose()
})

test('synchronous duplicate clicks produce exactly one clipboard request', async () => {
  const task = new CommandCopyTask()
  const write = deferred()
  let requests = 0
  const writer = () => {
    requests += 1
    return write.promise
  }
  const first = task.copy('test-owned command', writer)
  await task.copy('must not replace pending command', writer)
  assert.equal(requests, 1)
  assert.equal(task.getSnapshot(), 'pending')
  write.resolve()
  await first
  assert.equal(task.getSnapshot(), 'copied')
  task.dispose()
})

test('rejection never reports copied and retry requires a new explicit action', async () => {
  const task = new CommandCopyTask()
  let requests = 0
  await task.copy('test-owned command', async () => {
    requests += 1
    throw new Error('synthetic clipboard rejection')
  })
  assert.equal(requests, 1)
  assert.equal(task.getSnapshot(), 'failed')
  await Promise.resolve()
  assert.equal(requests, 1)
  await task.copy('test-owned command', async () => {
    requests += 1
  })
  assert.equal(requests, 2)
  assert.equal(task.getSnapshot(), 'copied')
  task.dispose()
})

test('missing clipboard has truthful manual-copy state and no attempted request', async () => {
  const task = new CommandCopyTask()
  await task.copy('test-owned command', undefined)
  assert.equal(task.getSnapshot(), 'unavailable')
  task.dispose()
})

test('a synchronous clipboard exception is a failure, not a successful copy', async () => {
  const task = new CommandCopyTask()
  await task.copy('test-owned command', () => {
    throw new Error('synthetic exception')
  })
  assert.equal(task.getSnapshot(), 'failed')
  task.dispose()
})

test('pending wait is bounded; late success cannot overwrite timeout or a newer action', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const task = new CommandCopyTask()
  const oldWrite = deferred()
  const pending = task.copy('first test command', () => oldWrite.promise)
  context.mock.timers.tick(COMMAND_COPY_TIMEOUT_MS)
  await pending
  assert.equal(task.getSnapshot(), 'failed')
  const currentWrite = deferred()
  const current = task.copy('second test command', () => currentWrite.promise)
  oldWrite.resolve()
  await Promise.resolve()
  assert.equal(task.getSnapshot(), 'pending')
  currentWrite.resolve()
  await current
  assert.equal(task.getSnapshot(), 'copied')
  task.dispose()
})

test('dispose settles owned wait and prevents late clipboard completion from notifying removed UI', async () => {
  const task = new CommandCopyTask()
  const write = deferred()
  const observations = []
  task.subscribe(() => observations.push(task.getSnapshot()))
  const pending = task.copy('test-owned command', () => write.promise)
  task.dispose()
  await pending
  write.resolve()
  await Promise.resolve()
  let requestsAfterDispose = 0
  await task.copy('ignored after unmount', async () => {
    requestsAfterDispose += 1
  })
  assert.equal(requestsAfterDispose, 0)
  assert.deepEqual(observations, ['pending'])
})

test('simultaneous component instances cannot overwrite each other or clear another busy guard', async () => {
  const first = new CommandCopyTask()
  const second = new CommandCopyTask()
  const one = deferred()
  const two = deferred()
  const pendingOne = first.copy('command one', () => one.promise)
  const pendingTwo = second.copy('command two', () => two.promise)
  one.resolve()
  await pendingOne
  assert.equal(first.getSnapshot(), 'copied')
  assert.equal(second.getSnapshot(), 'pending')
  two.reject(new Error('synthetic rejection'))
  await pendingTwo
  assert.equal(first.getSnapshot(), 'copied')
  assert.equal(second.getSnapshot(), 'failed')
  first.dispose()
  second.dispose()
})

test('synchronous unmount on pending notification prevents starting a clipboard request', async () => {
  const task = new CommandCopyTask()
  task.subscribe(() => {
    if (task.getSnapshot() === 'pending') task.dispose()
  })
  let requests = 0
  await task.copy('not copied after dispose', async () => {
    requests += 1
  })
  assert.equal(requests, 0)
})

test('actual shared command block renders selectable exact code, copy action and live feedback without execution', () => {
  const html = renderToStaticMarkup(
    h(CommandBlock, {
      code: 'test-owned command\nsecond test command',
      label: '一次性配对命令',
    }),
  )
  assert.match(html, /data-slot="command-block"/u)
  assert.match(html, /data-copy-state="idle"/u)
  assert.match(html, /<pre[^>]*tabindex="0"/u)
  assert.match(html, /aria-label="一次性配对命令，命令内容"/u)
  assert.match(html, /test-owned command/u)
  assert.match(html, /second test command/u)
  assert.match(html, /<button[^>]*aria-label="复制一次性配对命令"/u)
  assert.match(html, /type="button"/u)
  assert.match(html, /role="status"/u)
  assert.match(html, /aria-live="polite"/u)
  assert.doesNotMatch(html, /已复制|正在复制|<form|onclick=|onClick=/u)
})

for (const platform of ['linux', 'macos']) {
  test(
    'Node instructions render actual copy controls without changing the exact ' +
      platform +
      ' commands',
    () => {
      const html = renderToStaticMarkup(h(NodeSetupInstructions, { platform }))
      const commands = nodePairingCommands(platform)
      const displayedCommands = []
      const collect = (node) => {
        if (Array.isArray(node)) return node.forEach(collect)
        if (
          node === null ||
          typeof node !== 'object' ||
          node.props === undefined
        )
          return
        if (node.type === CommandBlock) displayedCommands.push(node.props.code)
        collect(node.props.children)
      }
      collect(NodeSetupInstructions({ platform }))
      assert.deepEqual(displayedCommands, [
        './install.sh',
        commands.stop + '\n' + commands.pair,
        commands.start,
      ])
      const decode = (text) =>
        text.replaceAll('&quot;', '"').replaceAll('&#x27;', "'")
      const decoded = decode(html)
      for (const command of [
        './install.sh',
        commands.stop,
        commands.pair,
        commands.start,
      ])
        assert.ok(decoded.includes(command), command)
      assert.equal((html.match(/data-slot="command-block"/gu) ?? []).length, 3)
      assert.match(html, /aria-label="复制安装命令"/u)
      assert.match(html, /aria-label="复制一次性配对命令"/u)
      assert.match(html, /aria-label="复制恢复后台服务命令"/u)
      assert.match(html, /原服务实际使用的同一目录/u)
      assert.match(html, /Windows 暂时不能作为配对设备/u)
      assert.doesNotMatch(
        html,
        /service install|\.bashrc|\.zshrc|--bind 0\.0\.0\.0/u,
      )
    },
  )
}
