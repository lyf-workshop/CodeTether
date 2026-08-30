import assert from 'node:assert/strict'
import test from 'node:test'

import { createToolPresentation } from '../.tmp/test-dist/components/conversation/tool-presentation.js'

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
    subtitle: 'Path not found',
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
    'Path not found',
  )

  assert.equal(
    createToolPresentation({
      command: 'pnpm test',
      status: 'failed',
      outputSummary: 'Process exited with code 2',
    }).subtitle,
    'Exited with code 2',
  )
})

function present(command) {
  return createToolPresentation({ command, status: 'completed' })
}
