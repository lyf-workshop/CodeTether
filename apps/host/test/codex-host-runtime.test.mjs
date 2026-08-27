import assert from 'node:assert/strict'
import test from 'node:test'

import { JsonRpcRemoteError } from '@codetether/adapter-codex'

import { ProviderConversationUnavailableError } from '../dist/api/agent-runtime.js'
import { resumeCodexConversation } from '../dist/api/codex-host-runtime.js'

test('resumes the exact durable Codex thread in its authorized workspace', async () => {
  const calls = []
  const result = await resumeCodexConversation(
    {
      async resumeThread(options) {
        calls.push(options)
        return {
          thread: { id: options.threadId },
          model: 'gpt-5.2-codex',
          modelProvider: 'openai',
          cwd: options.cwd,
        }
      },
    },
    {
      providerThreadId: 'thread-durable-a',
      cwd: 'C:/authorized/workspace',
    },
  )

  assert.deepEqual(calls, [
    {
      threadId: 'thread-durable-a',
      cwd: 'C:/authorized/workspace',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    },
  ])
  assert.deepEqual(result, {
    providerThreadId: 'thread-durable-a',
    model: 'gpt-5.2-codex',
  })
})

test('classifies a provider-rejected thread resume as unavailable', async () => {
  const remote = new JsonRpcRemoteError(
    'thread/resume',
    -32_602,
    'thread not found',
  )

  await assert.rejects(
    resumeCodexConversation(
      {
        async resumeThread() {
          throw remote
        },
      },
      {
        providerThreadId: 'thread-missing',
        cwd: 'C:/authorized/workspace',
      },
    ),
    (error) => {
      assert.ok(error instanceof ProviderConversationUnavailableError)
      assert.equal(error.code, 'provider_conversation_unavailable')
      assert.equal(error.provider, 'codex')
      assert.equal(error.providerThreadId, 'thread-missing')
      assert.equal(error.cause, remote)
      assert.doesNotMatch(error.message, /thread not found/)
      return true
    },
  )
})

test('does not misclassify runtime failures as a missing provider conversation', async () => {
  const runtimeFailure = new Error('Codex App Server exited')

  await assert.rejects(
    resumeCodexConversation(
      {
        async resumeThread() {
          throw runtimeFailure
        },
      },
      {
        providerThreadId: 'thread-a',
        cwd: 'C:/authorized/workspace',
      },
    ),
    (error) => error === runtimeFailure,
  )
})
