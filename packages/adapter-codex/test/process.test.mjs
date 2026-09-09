import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { CodexOwnedProcessCleanupError } from '../dist/errors.js'
import {
  codexAppServerArguments,
  remoteCodexAppServerArguments,
  sanitizeCodexChildEnvironment,
  sanitizeRemoteCodexChildEnvironment,
  spawnRemoteCodexAppServer,
  stopCodexAppServer,
  stopRemoteCodexAppServer,
} from '../dist/process.js'

test('local App Server argv remains unchanged', () => {
  assert.deepEqual(codexAppServerArguments(), [
    'app-server',
    '--listen',
    'stdio://',
  ])
  assert.deepEqual(codexAppServerArguments({ disableHooks: true }), [
    'app-server',
    '--listen',
    'stdio://',
    '--disable',
    'hooks',
  ])
})

test('remote App Server argv is fixed and disables executable capabilities', () => {
  assert.deepEqual(remoteCodexAppServerArguments(), [
    '--disable',
    'apply_patch_freeform',
    '--disable',
    'apply_patch_preserve_line_endings',
    '--disable',
    'apply_patch_streaming_events',
    '--disable',
    'hooks',
    '--disable',
    'plugins',
    '--disable',
    'plugin_hooks',
    '--disable',
    'plugin_sharing',
    '--disable',
    'apps',
    '--disable',
    'enable_mcp_apps',
    '--disable',
    'mcp_2026_07_28',
    '--disable',
    'non_prefixed_mcp_tool_names',
    '--disable',
    'remote_plugin',
    '--disable',
    'recommended_plugins',
    '--disable',
    'browser_use',
    '--disable',
    'browser_use_external',
    '--disable',
    'browser_use_full_cdp_access',
    '--disable',
    'computer_use',
    '--disable',
    'image_generation',
    '--disable',
    'in_app_browser',
    '--disable',
    'artifact',
    '--disable',
    'view_image',
    '--disable',
    'code_mode',
    '--disable',
    'code_mode_host',
    '--disable',
    'code_mode_interrupt',
    '--disable',
    'code_mode_only',
    '--disable',
    'js_repl',
    '--disable',
    'js_repl_tools_only',
    '--disable',
    'request_permissions_tool',
    '--disable',
    'request_rule',
    '--disable',
    'exec_permission_approvals',
    '--disable',
    'guardian_approval',
    '--disable',
    'guardianv2',
    '--disable',
    'shell_tool',
    '--disable',
    'unified_exec',
    '--disable',
    'shell_zsh_fork',
    '--disable',
    'unified_exec_zsh_fork',
    '--disable',
    'shell_snapshot',
    '--disable',
    'network_proxy',
    '--disable',
    'multi_agent',
    '--disable',
    'multi_agent_v2',
    '--disable',
    'collaboration_modes',
    '--disable',
    'goals',
    '--disable',
    'token_budget',
    '--disable',
    'current_time_reminder',
    '--disable',
    'default_mode_request_user_input',
    '--disable',
    'deferred_executor',
    '--disable',
    'deferred_tool_world_state',
    '--disable',
    'executor_capability_discovery',
    '--disable',
    'external_agent_memory_import',
    '--disable',
    'memories',
    '--disable',
    'tool_suggest',
    '--disable',
    'tool_search',
    '--disable',
    'search_tool',
    '--disable',
    'unavailable_dummy_tools',
    '--disable',
    'skill_search',
    '--disable',
    'skill_mcp_dependency_install',
    '--disable',
    'tool_call_mcp_elicitation',
    '--disable',
    'auth_elicitation',
    '--disable',
    'psp',
    '--disable',
    'standalone_web_search',
    '--disable',
    'web_search_cached',
    '--disable',
    'web_search_request',
    '--disable',
    'workspace_dependencies',
    '-c',
    'web_search="disabled"',
    '-c',
    'tools.update_plan.enabled=false',
    '-c',
    'tools.experimental_request_user_input.enabled=false',
    '-c',
    'orchestrator.skills.enabled=false',
    '-c',
    'orchestrator.mcp.enabled=false',
    'app-server',
    '--listen',
    'stdio://',
    '--strict-config',
  ])
})

test('configuration observation tolerates unknown settings without weakening remote execution strictness', () => {
  const observationArguments = remoteCodexAppServerArguments({
    strictConfig: false,
  })

  assert.equal(observationArguments.includes('--strict-config'), false)
  assert.deepEqual(observationArguments.slice(-3), [
    'app-server',
    '--listen',
    'stdio://',
  ])
  assert.equal(
    remoteCodexAppServerArguments().includes('--strict-config'),
    true,
  )
})

test('remote App Server receives only Node-local runtime and auth variables', () => {
  const codexHome = resolve('isolated-remote-codex-home')
  assert.deepEqual(
    sanitizeRemoteCodexChildEnvironment(
      {
        PATH: 'runtime-path',
        HOME: 'owner-home',
        NODE_OPTIONS: '--inspect',
        CODEX_HOME: 'owner-codex-home',
        CODEX_ACCESS_TOKEN: 'parent-access-token',
        CODEX_SESSION_ID: 'parent-session',
        CODEX_API_KEY: 'node-codex-api-key',
        OPENAI_API_KEY: 'node-openai-api-key',
        OPENAI_BASE_URL: 'https://node-api.example.test',
        OPENAI_ORGANIZATION: 'node-org',
        OPENAI_PROJECT: 'node-project',
      },
      codexHome,
    ),
    {
      PATH: 'runtime-path',
      CODEX_API_KEY: 'node-codex-api-key',
      OPENAI_API_KEY: 'node-openai-api-key',
      OPENAI_BASE_URL: 'https://node-api.example.test',
      OPENAI_ORGANIZATION: 'node-org',
      OPENAI_PROJECT: 'node-project',
      CODEX_HOME: codexHome,
    },
  )
})

test('remote App Server rejects a relative Codex home', () => {
  assert.throws(
    () => sanitizeRemoteCodexChildEnvironment({}, 'relative/codex-home'),
    /Remote Codex home must be an absolute path/,
  )
})

test('local App Server stop failure preserves exact ownership uncertainty', async () => {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => true

  await assert.rejects(
    stopCodexAppServer(child, 1),
    (error) =>
      error instanceof CodexOwnedProcessCleanupError &&
      error.failureReason === 'execution_ownership_uncertain',
  )
})

test(
  'remote POSIX shutdown removes the exact parent and descendant process group',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codetether-codex-group-'))
    const executable = join(directory, 'fake-codex')
    await writeFile(
      executable,
      `#!${process.execPath}
const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
process.stdout.write(String(child.pid) + '\\n')
process.stdin.resume()
setInterval(() => {}, 1000)
`,
      'utf8',
    )
    await chmod(executable, 0o755)
    const unrelated = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ])
    const remote = spawnRemoteCodexAppServer({
      executable,
      codexHome: directory,
      environment: process.env,
    })
    try {
      const descendantPid = await readPidLine(remote.stdout)
      assert.equal(pidExists(remote.pid), true)
      assert.equal(pidExists(descendantPid), true)
      assert.equal(pidExists(unrelated.pid), true)

      await stopRemoteCodexAppServer(remote, 100)

      assert.equal(await waitForPidExit(remote.pid), true)
      assert.equal(await waitForPidExit(descendantPid), true)
      assert.equal(pidExists(unrelated.pid), true)
    } finally {
      unrelated.kill('SIGKILL')
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('child App Server does not inherit a parent Codex control context', () => {
  const environment = sanitizeCodexChildEnvironment({
    PATH: 'runtime-path',
    CODEX_HOME: 'runtime-home',
    CODEX_ACCESS_TOKEN: 'preserved-auth-value',
    CODEX_CI: '1',
    CODEX_PERMISSION_PROFILE: 'parent-permissions',
    CODEX_SESSION_ID: 'parent-session',
    CODEX_THREAD_ID: 'parent-thread',
  })

  assert.deepEqual(environment, {
    PATH: 'runtime-path',
    CODEX_HOME: 'runtime-home',
    CODEX_ACCESS_TOKEN: 'preserved-auth-value',
  })
})

test('control variable matching is case-insensitive on Windows-style input', () => {
  assert.deepEqual(
    sanitizeCodexChildEnvironment({
      Path: 'runtime-path',
      codex_session_id: 'parent-session',
    }),
    { Path: 'runtime-path' },
  )
})

async function readPidLine(stream) {
  let text = ''
  for await (const chunk of stream) {
    text += chunk.toString('utf8')
    const newline = text.indexOf('\n')
    if (newline >= 0) return Number(text.slice(0, newline))
  }
  throw new Error('Remote process did not report its descendant PID')
}

function pidExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitForPidExit(pid) {
  const deadline = Date.now() + 2_000
  while (pidExists(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}
