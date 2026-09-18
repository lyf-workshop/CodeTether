import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

/** TEMPORARY REAL EVIDENCE INSTRUMENTATION. */
const evidencePathVariable = 'CODETETHER_CLAUDE_PROMPT_EVIDENCE_PATH'

export function recordTemporaryClaudePromptEvidence(input: {
  readonly actionId: string
  readonly conversationId: string
  readonly turnId: string
  readonly prompt: string
}): void {
  const path = process.env[evidencePathVariable]
  if (path === undefined || path.length === 0) return
  const bytes = Buffer.from(input.prompt, 'utf8')
  try {
    appendFileSync(
      path,
      `${JSON.stringify({
        evidence: 'claude_prompt_delivery',
        stage: 'host_pre_serialization',
        actionId: input.actionId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        utf8Length: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch {
    // Evidence must never change Machine transport behavior.
  }
}
