import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTimelineToolPresentation,
  createToolPresentation,
} from '../.tmp/test-dist/components/conversation/tool-presentation.js'

test('classifies direct and safely unwrapped PowerShell commands', () => {
  assert.deepEqual(present('git status --short'), {
    kind: 'git-status',
    title: 'Git 状态',
    rawCommand: 'git status --short',
  })

  assert.deepEqual(
    present(
      'powershell -NoProfile -Command "Get-Content -LiteralPath \'src/example.ts\'"',
    ),
    {
      kind: 'read-file',
      title: '读取文件',
      subtitle: 'src/example.ts',
      rawCommand:
        'powershell -NoProfile -Command "Get-Content -LiteralPath \'src/example.ts\'"',
    },
  )

  assert.equal(present("pwsh.exe -Command '& { pnpm test }'").kind, 'test')
  assert.equal(present('cat -- README.md').title, '读取文件')
  assert.equal(present('cargo test --workspace').title, '运行测试')
  assert.equal(present('pnpm exec vitest run').title, '运行测试')
  assert.equal(present('npm run test:unit').title, '运行测试')
  assert.equal(present('node --test test/*.test.mjs').title, '运行测试')
  assert.equal(present('node scripts/check.mjs').title, '执行命令')
})

test('does not classify quoted text or encoded PowerShell payloads as commands', () => {
  assert.equal(present('Write-Output "git status"').kind, 'command')
  assert.equal(
    present('powershell -EncodedCommand Z2l0IHN0YXR1cw==').kind,
    'command',
  )
  assert.equal(
    present('powershell -Command "Write-Output \'Get-Content README.md\'"')
      .kind,
    'command',
  )
  assert.equal(
    present('powershell -Command "git status; Remove-Item -Recurse workspace"')
      .kind,
    'command',
  )
  assert.equal(
    present('powershell -Command \'git status "$(Remove-Item workspace)"\'')
      .kind,
    'command',
  )
})

test('canonical Provider Tool kinds take precedence over command heuristics', () => {
  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'read',
      status: 'completed',
    }).title,
    '读取文件',
  )
  assert.equal(
    createToolPresentation({
      command: 'cat README.md',
      kind: 'shell',
      status: 'completed',
    }).kind,
    'command',
  )
  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'edit',
      status: 'completed',
    }).kind,
    'edit-file',
  )
  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'search',
      status: 'completed',
    }).kind,
    'search',
  )
  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'generic',
      status: 'completed',
    }).title,
    '使用工具',
  )
})

test('canonical Claude Read and Search commands expose only their safe subject', () => {
  const read = createToolPresentation({
    command: 'Read fixtures/known text.txt',
    kind: 'read',
    status: 'completed',
  })
  assert.equal(read.kind, 'read-file')
  assert.equal(read.subtitle, 'fixtures/known text.txt')
  assert.equal(read.rawCommand, 'Read fixtures/known text.txt')

  const grep = createToolPresentation({
    command: 'Grep reconnect marker in fixtures',
    kind: 'search',
    status: 'completed',
  })
  assert.equal(grep.kind, 'search')
  assert.equal(grep.subtitle, 'reconnect marker in fixtures')

  const glob = createToolPresentation({
    command: 'Glob **/*.md',
    kind: 'search',
    status: 'completed',
  })
  assert.equal(glob.kind, 'search')
  assert.equal(glob.subtitle, '**/*.md')

  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'read',
      status: 'completed',
    }).subtitle,
    undefined,
  )
  assert.equal(
    createToolPresentation({
      command: 'opaque provider input',
      kind: 'search',
      status: 'completed',
    }).subtitle,
    undefined,
  )
})

test('keeps raw commands and reduces failure output to a stable short subtitle', () => {
  const command = "Get-Content -LiteralPath 'missing.txt'"
  const presentation = createToolPresentation({
    command,
    status: 'failed',
    outputSummary:
      "Get-Content: Cannot find path 'C:\\workspace\\missing.txt' because it does not exist.\nAt line:1 char:1\n+ CategoryInfo: ObjectNotFound",
  })

  assert.deepEqual(presentation, {
    kind: 'read-file',
    title: '读取文件',
    subtitle: '找不到路径',
    rawCommand: command,
  })
  assert.equal(presentation.subtitle?.includes('CategoryInfo'), false)

  assert.equal(
    createToolPresentation({
      command,
      status: 'failed',
      outputSummary:
        'FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand',
    }).subtitle,
    '找不到路径',
  )

  assert.equal(
    createToolPresentation({
      command: 'pnpm test',
      status: 'failed',
      outputSummary: 'Process exited with code 2',
    }).subtitle,
    '命令已退出，退出码 2',
  )
})

test('distinguishes the exact Windows sandbox launch diagnostic from other failed commands', () => {
  const failure = {
    command: 'node --test',
    kind: 'shell',
    status: 'failed',
  }
  const launcherError =
    'Failed to create unified exec process: registered Core process has no package identity'

  assert.deepEqual(
    createToolPresentation({ ...failure, outputSummary: launcherError }),
    {
      kind: 'command',
      title: '执行命令',
      subtitle: 'Windows 沙箱无法启动命令',
      rawCommand: 'node --test',
    },
  )
  assert.equal(
    createToolPresentation({
      ...failure,
      outputSummary: 'registered Core process has no package identity',
    }).subtitle,
    '命令执行失败',
  )
  assert.equal(
    createToolPresentation({
      ...failure,
      outputSummary: `AssertionError: ${launcherError}`,
    }).subtitle,
    '命令执行失败',
  )
  assert.equal(
    createToolPresentation({
      ...failure,
      outputSummary: 'Process exited with code 1',
    }).subtitle,
    '命令已退出，退出码 1',
  )
})

test('timeline previews plain, wrapped, and compound commands lexically', () => {
  const subject = (command) =>
    createTimelineToolPresentation({
      command,
      kind: 'shell',
      status: 'running',
    })

  assert.equal(
    subject('node --test test/check.mjs').subject,
    'node --test test/check.mjs',
  )
  const wrapped = subject(
    'powershell.exe -NoProfile -Command "& { git status --short; Write-Output \'a;b\'; pnpm test }"',
  )
  assert.equal(
    wrapped.displayCommand,
    "git status --short; Write-Output 'a;b'; pnpm test",
  )
  assert.equal(wrapped.subject, 'git status --short 等 3 条')
  assert.equal(
    subject(
      "Write-Output $(Get-Content 'fixtures.txt' | Select-Object -First 1)\nnode --test",
    ).subject,
    "Write-Output $(Get-Content 'fixtures.txt' | Select-Object -First 1) 等 2 条",
  )
  assert.equal(
    subject("& 'C:\\Program Files\\node.exe' --test && git status").subject,
    "& 'C:\\Program Files\\node.exe' --test 等 2 条",
  )
})

test('timeline keeps canonical tool subjects and renders only verified metadata', () => {
  assert.equal(
    createTimelineToolPresentation({
      command: 'Read a.txt',
      kind: 'read',
      status: 'completed',
    }).subject,
    'a.txt',
  )
  assert.equal(
    createTimelineToolPresentation({
      command: 'Edit a.txt',
      kind: 'edit',
      status: 'completed',
    }).subject,
    'a.txt',
  )
  assert.equal(
    createTimelineToolPresentation({
      command: 'Grep sample in fixtures',
      kind: 'search',
      status: 'completed',
    }).subject,
    'sample in fixtures',
  )
  const attempted = createTimelineToolPresentation({
    command: 'node --test',
    kind: 'shell',
    status: 'failed',
    outputSummary: 'Process exited with code 9',
  })
  assert.equal(attempted.subject, 'node --test')
  assert.equal(attempted.failureSummary, '命令执行失败')
  assert.equal(
    createTimelineToolPresentation({
      command: 'node --test',
      kind: 'shell',
      status: 'failed',
      outputSummary:
        'Failed to create unified exec process: registered Core process has no package identity',
    }).failureSummary,
    'Windows 沙箱无法启动命令',
  )
})

function present(command) {
  return createToolPresentation({ command, status: 'completed' })
}
