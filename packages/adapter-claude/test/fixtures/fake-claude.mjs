import { spawn } from 'node:child_process'
import { appendFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rawArguments = process.argv.slice(2)
const fixtureOptions = Object.fromEntries(
  rawArguments
    .filter((argument) => argument.startsWith('--fixture-'))
    .map((argument) => {
      const separator = argument.indexOf('=')
      return separator < 0
        ? [argument.slice('--fixture-'.length), '']
        : [
            argument.slice('--fixture-'.length, separator),
            argument.slice(separator + 1),
          ]
    }),
)
const arguments_ = rawArguments.filter(
  (argument) => !argument.startsWith('--fixture-'),
)
const scenario =
  fixtureOptions.scenario ?? process.env.FAKE_CLAUDE_SCENARIO ?? 'happy'
const version = process.env.FAKE_CLAUDE_VERSION ?? '2.1.251'

if (arguments_.includes('--version')) {
  if (process.env.FAKE_CLAUDE_COUNT_PATH) {
    await appendFile(process.env.FAKE_CLAUDE_COUNT_PATH, 'version\n', 'utf8')
  }
  if (scenario === 'version-failure') {
    process.stderr.write('private diagnostic\n')
    process.exitCode = 2
  } else if (scenario === 'version-invalid') {
    process.stdout.write('not a Claude version\n')
  } else {
    process.stdout.write(`${version} (Claude Code)\n`)
  }
} else if (
  arguments_[0] === 'auth' &&
  arguments_[1] === 'status' &&
  arguments_[2] === '--json'
) {
  if (process.env.FAKE_CLAUDE_COUNT_PATH) {
    await appendFile(process.env.FAKE_CLAUDE_COUNT_PATH, 'auth\n', 'utf8')
  }
  const authPidPath =
    fixtureOptions['auth-pid'] ?? process.env.FAKE_CLAUDE_AUTH_PID_PATH
  if (authPidPath) {
    await writeFile(authPidPath, String(process.pid), 'utf8')
  }
  const authStatus =
    fixtureOptions['auth-status'] ??
    process.env.FAKE_CLAUDE_AUTH_STATUS ??
    'logged-in'
  const childPidPath =
    fixtureOptions['auth-child-pid'] ??
    process.env.FAKE_CLAUDE_AUTH_CHILD_PID_PATH
  if (childPidPath) {
    const descendant = spawn(
      process.execPath,
      [
        '--eval',
        "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 60000)",
        childPidPath,
      ],
      { stdio: 'ignore' },
    )
    // Model a CLI-owned background descendant that outlives the successful
    // probe parent. A referenced ChildProcess would instead keep this fixture
    // parent alive forever, turning the success case into a probe timeout
    // before the adapter can exercise its post-close process-group cleanup.
    descendant.unref()
  }
  if (authStatus === 'failure') {
    process.stderr.write('private auth diagnostic\n')
    process.exitCode = 2
  } else if (authStatus === 'malformed') {
    process.stdout.write('{private malformed auth response\n')
  } else if (authStatus === 'hang') {
    setInterval(() => undefined, 60_000)
  } else {
    process.stdout.write(
      `${JSON.stringify({ loggedIn: authStatus !== 'logged-out' })}\n`,
    )
  }
} else {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  const sessionFlag = arguments_.includes('--resume')
    ? '--resume'
    : '--session-id'
  const sessionIndex = arguments_.indexOf(sessionFlag)
  const sessionId = arguments_[sessionIndex + 1]
  if (!sessionId) throw new Error('missing fixture session ID')

  const capturePath =
    fixtureOptions.capture === undefined
      ? process.env.FAKE_CLAUDE_CAPTURE_PATH
      : resolve(process.cwd(), fixtureOptions.capture)
  if (capturePath) {
    await appendFile(
      capturePath,
      `${JSON.stringify({
        arguments: arguments_,
        cwd: process.cwd(),
        input,
        inheritedControl: Boolean(
          process.env.CLAUDECODE || process.env.CLAUDE_CODE_SESSION_ID,
        ),
        preservedAuth:
          process.env.ANTHROPIC_API_KEY === 'fixture-auth' ||
          process.env.ANTHROPIC_AUTH_TOKEN === 'fixture-auth-token',
      })}\n`,
      'utf8',
    )
  }

  const emittedSessionId =
    scenario === 'session-mismatch'
      ? '10000000-0000-4000-8000-000000000000'
      : sessionId
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  emit({
    type: 'system',
    subtype: 'init',
    uuid: 'init-uuid',
    session_id: emittedSessionId,
    claude_code_version: version,
    cwd: process.cwd(),
    tools: ['Read', 'Glob', 'Grep'],
    model: 'fixture-model',
    permissionMode: 'dontAsk',
    mcp_servers: [],
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
  })

  if (scenario === 'hang') {
    setInterval(() => undefined, 60_000)
  } else if (scenario === 'malformed') {
    process.stdout.write('{malformed json\n')
  } else if (scenario === 'auth-error') {
    emit({
      type: 'assistant',
      uuid: 'assistant-auth',
      session_id: emittedSessionId,
      error: 'authentication_failed',
      message: {
        id: 'message-auth',
        content: [
          {
            type: 'text',
            text: 'OAuth token expired: private provider diagnostic',
          },
        ],
      },
    })
    emit({
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'result-auth',
      session_id: emittedSessionId,
      is_error: true,
      errors: ['private provider diagnostic'],
    })
  } else {
    emit({
      type: 'stream_event',
      uuid: 'stream-start',
      session_id: emittedSessionId,
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'message-1' } },
    })
    emit({
      type: 'stream_event',
      uuid: 'stream-delta',
      session_id: emittedSessionId,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'HELLO' },
      },
    })
    emit({
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: emittedSessionId,
      parent_tool_use_id: null,
      message: {
        id: 'message-1',
        content: [{ type: 'text', text: 'HELLO' }],
      },
    })
    emit({
      type: 'result',
      subtype: 'success',
      uuid: 'result-1',
      session_id: emittedSessionId,
      is_error: false,
      result: 'HELLO',
      permission_denials: [],
    })
  }
}
