import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTimelineToolPresentation,
  createToolPresentation,
  displayToolCommand,
} from '../.tmp/test-dist/components/conversation/tool-presentation.js'
import { inspectorToolEntries } from '../.tmp/test-dist/components/conversation/inspector-tool-output.js'
import { createPendingActionDockModel } from '../.tmp/test-dist/components/conversation/pending-action-dock-model.js'
import { createInboxItemPresentation } from '../.tmp/test-dist/components/inbox/inbox-model.js'

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
    "& { git status --short; Write-Output 'a;b'; pnpm test }",
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

test('PowerShell command display removes transport quoting without changing raw input', () => {
  const escapedLauncher =
    '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'node --test\''
  assert.equal(displayToolCommand(escapedLauncher), 'node --test')

  const doubledQuotes =
    'powershell -Command "Get-Location; rg --files -g ""!node_modules"" -g ""!vendor"""'
  const presentation = createTimelineToolPresentation({
    command: doubledQuotes,
    kind: 'shell',
    status: 'completed',
  })
  assert.equal(
    presentation.displayCommand,
    'Get-Location; rg --files -g "!node_modules" -g "!vendor"',
  )
  assert.equal(presentation.subject, 'Get-Location 等 2 条')
  assert.equal(presentation.rawCommand, doubledQuotes)

  const quotedCodexCommand = '"rg --files -g ""!node_modules"" -g ""!vendor"""'
  const codexPresentation = createTimelineToolPresentation({
    command: quotedCodexCommand,
    kind: 'shell',
    status: 'completed',
  })
  assert.equal(
    codexPresentation.displayCommand,
    'rg --files -g "!node_modules" -g "!vendor"',
  )
  assert.equal(codexPresentation.subject, codexPresentation.displayCommand)
  assert.equal(codexPresentation.rawCommand, quotedCodexCommand)
})

test('real Codex Windows launcher quoting stays raw but reads like typed commands', () => {
  const commands = [
    {
      raw: '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "rg --files --hidden -g \'"\'!.git\'"\'"',
      display: "rg --files --hidden -g '!.git'",
      timeline: "rg --files --hidden -g '!.git'",
    },
    {
      raw: '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "Get-Location; rg --files --hidden -g \'"\'!.git\'"\' -g \'"\'!node_modules\'"\'"',
      display:
        "Get-Location; rg --files --hidden -g '!.git' -g '!node_modules'",
      timeline: 'Get-Location 等 2 条',
    },
  ]
  for (const [index, command] of commands.entries()) {
    const presentation = createTimelineToolPresentation({
      command: command.raw,
      kind: 'shell',
      status: 'completed',
    })
    assert.equal(presentation.rawCommand, command.raw)
    assert.equal(presentation.displayCommand, command.display)
    assert.equal(presentation.subject, command.timeline)
    const entries = inspectorToolEntries({
      dayLabel: '今天',
      blocks: [
        {
          kind: 'agent-run',
          id: 'run',
          turnId: 'turn_one',
          time: '12:00',
          status: 'completed',
          executions: [
            {
              kind: 'tool',
              id: 'tool-' + index,
              tool: {
                id: 'tool-' + index,
                presentationKind: presentation.kind,
                title: presentation.title,
                subject: presentation.subject,
                displayCommand: presentation.displayCommand,
                status: 'completed',
                rawCommand: presentation.rawCommand,
              },
            },
          ],
        },
      ],
    })
    assert.equal(entries[0]?.title, command.display)
    const dock = createPendingActionDockModel([
      {
        id: 'approval-' + index,
        kind: 'command',
        title: '执行命令',
        summary: command.raw,
        requestedAt: '12:00',
      },
    ])[0]
    assert.equal(dock?.subtitle, command.display)
    assert.equal(dock?.detail, command.raw)
    const inbox = createInboxItemPresentation({
      type: 'approval',
      createdAt: '2026-11-21T12:00:00.000Z',
      payload: {
        kind: 'command',
        actionTitle: '执行命令',
        actionSubtitle: command.raw,
      },
    })
    assert.equal(inbox.description, command.display)
  }
})

test('Codex shlex PowerShell launchers round-trip scripts across command surfaces', () => {
  const launcher =
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const tick = String.fromCharCode(96)
  const cases = [
    {
      script: "rg --files --hidden -g '!.git'",
      subject: "rg --files --hidden -g '!.git'",
    },
    {
      script: "Get-Location; rg --files --hidden -g '!.git' -g '!node_modules'",
      subject: 'Get-Location 等 2 条',
    },
    {
      script: "Get-Content -LiteralPath '.git\\HEAD'",
      subject: "Get-Content -LiteralPath '.git\\HEAD'",
    },
    {
      script: "Select-String -Path src\\app.ts -Pattern '$x'",
      subject: "Select-String -Path src\\app.ts -Pattern '$x'",
    },
    {
      script: 'git commit -m "fix: one"',
      subject: 'git commit -m "fix: one"',
    },
    {
      script: 'Write-Output "a!b"',
      subject: 'Write-Output "a!b"',
    },
    {
      script: 'Get-ChildItem -Force | Select-Object Name',
      subject: 'Get-ChildItem -Force 等 2 条',
    },
    {
      script: "Get-Location; rg --files -g '!.git'",
      subject: 'Get-Location 等 2 条',
    },
    {
      script: 'Write-Output \'say "hello"\'',
      subject: 'Write-Output \'say "hello"\'',
    },
    {
      script: 'Write-Output ' + tick + '"quoted' + tick + '"',
      subject: 'Write-Output ' + tick + '"quoted' + tick + '"',
    },
    {
      executable: 'C:\\Tools\\pwsh.exe',
      flags: ['-NoProfile'],
      script: "Write-Output 'NoProfile'; rg --files -g '!.git'",
      subject: "Write-Output 'NoProfile' 等 2 条",
    },
  ]

  for (const [index, entry] of cases.entries()) {
    const raw = codexShlexJoin([
      entry.executable ?? launcher,
      ...(entry.flags ?? []),
      '-Command',
      entry.script,
    ])
    assert.equal(displayToolCommand(raw), entry.script, raw)
    const timeline = createTimelineToolPresentation({
      command: raw,
      kind: 'shell',
      status: 'completed',
    })
    assert.equal(timeline.displayCommand, entry.script, raw)
    assert.equal(timeline.rawCommand, raw)
    assert.equal(timeline.subject, entry.subject, raw)

    const entries = inspectorToolEntries({
      dayLabel: '今天',
      blocks: [
        {
          kind: 'agent-run',
          id: 'run',
          turnId: 'turn_one',
          time: '12:00',
          status: 'completed',
          executions: [
            {
              kind: 'tool',
              id: 'tool-' + index,
              tool: {
                id: 'tool-' + index,
                presentationKind: timeline.kind,
                title: timeline.title,
                subject: timeline.subject,
                displayCommand: timeline.displayCommand,
                status: 'completed',
                rawCommand: timeline.rawCommand,
              },
            },
          ],
        },
      ],
    })
    assert.equal(entries[0]?.title, compactCommand(entry.script), raw)

    const dock = createPendingActionDockModel([
      {
        id: 'approval-' + index,
        kind: 'command',
        title: '执行命令',
        summary: raw,
        requestedAt: '12:00',
      },
    ])[0]
    assert.equal(dock?.subtitle, compactCommand(entry.script), raw)
    assert.equal(dock?.detail, raw)

    const inbox = createInboxItemPresentation({
      type: 'approval',
      createdAt: '2026-11-21T12:00:00.000Z',
      payload: {
        kind: 'command',
        actionTitle: '执行命令',
        actionSubtitle: raw,
      },
    })
    assert.equal(inbox.description, compactCommand(entry.script), raw)
  }
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

function compactCommand(value) {
  const normalized = value.trim()
  return normalized.length <= 80 ? normalized : normalized.slice(0, 79) + '…'
}

// Independent fixture generator using the shlex 2.x quote strategy in the review probe.
function codexShlexJoin(words) {
  return words.map(codexShlexQuote).join(' ')
}

function codexShlexQuote(value) {
  if (value.length === 0) return "''"
  let result = ''
  let rest = value
  while (rest.length > 0) {
    let allowed = rest[0] === '^' ? 2 : 7
    let length = rest[0] === '^' ? 1 : 0
    for (; length < rest.length; length += 1) {
      const character = rest[length]
      let current = allowed
      if (character.charCodeAt(0) >= 0x80) {
        current &= ~1
      } else {
        if (!/[+\-./:@\]_0-9A-Za-z]/u.test(character)) current &= ~1
        if (character === "'" || character === '^' || character === '\\')
          current &= ~2
        if (/[\x60$!^]/u.test(character)) current &= ~4
      }
      if (current === 0) break
      allowed = current
    }
    const part = rest.slice(0, length)
    if (length === rest.length && (allowed & 1) !== 0 && result.length === 0)
      return value
    result +=
      (allowed & 1) !== 0
        ? part
        : (allowed & 2) !== 0
          ? "'" + part + "'"
          : '"' +
            part.replace(/[$\x60"\\]/gu, (character) => '\\' + character) +
            '"'
    rest = rest.slice(length)
  }
  return result
}
