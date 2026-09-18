import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

/** TEMPORARY REAL EVIDENCE INSTRUMENTATION. */
const evidencePathVariable = 'CODETETHER_CLAUDE_PROMPT_EVIDENCE_PATH'

export function recordTemporaryClaudePromptEvidence(input: {
  readonly stage: 'node_post_validation' | 'adapter_pre_encoding'
  readonly actionId?: string
  readonly conversationId?: string
  readonly turnId: string
  readonly prompt: string
  readonly resume?: boolean
}): void {
  const bytes = Buffer.from(input.prompt, 'utf8')
  record({
    evidence: 'claude_prompt_delivery',
    stage: input.stage,
    ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: input.conversationId }),
    turnId: input.turnId,
    ...(input.resume === undefined ? {} : { resume: input.resume }),
    utf8Length: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}

export function recordTemporaryClaudeEncodedEvidence(input: {
  readonly turnId: string
  readonly encoded: string
  readonly resume: boolean
}): void {
  const bytes = Buffer.from(input.encoded, 'utf8')
  record({
    evidence: 'claude_prompt_delivery',
    stage: 'encoded_jsonl',
    turnId: input.turnId,
    resume: input.resume,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}

export function recordTemporaryClaudeStdinEvidence(input: {
  readonly turnId: string
  readonly resume: boolean
  readonly result: 'success' | 'error'
}): void {
  record({
    evidence: 'claude_prompt_delivery',
    stage: 'stdin_callback',
    turnId: input.turnId,
    resume: input.resume,
    result: input.result,
    ...(input.result === 'error' ? { errorCategory: 'stdin_error' } : {}),
  })
}

function record(value: object): void {
  const path = process.env[evidencePathVariable]
  if (path === undefined || path.length === 0) return
  try {
    appendFileSync(path, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch {
    // Evidence must never change Provider execution behavior.
  }
}
