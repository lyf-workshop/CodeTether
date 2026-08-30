import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { AgentEvent, ToolKind } from '@codetether/agent-core'

import {
  ClaudeCodeError,
  ClaudeCodeProtocolError,
  ClaudeCodeSessionLostError,
  ClaudeCodeVersionUnsupportedError,
} from './errors.js'
import {
  CLAUDE_CODE_PROVIDER,
  isClaudeCodeTestedVersion,
  type CanonicalClaudeToolName,
  type ClaudeCodeTurnResult,
} from './types.js'

export const MAX_CLAUDE_MESSAGE_BYTES = 256 * 1024
export const MAX_CLAUDE_DELTA_BYTES = 32 * 1024
export const MAX_CLAUDE_TOOL_OUTPUT_BYTES = 64 * 1024
export const MAX_CLAUDE_TOOL_COMMAND_BYTES = 32 * 1024
export const MAX_CLAUDE_TOOL_SUMMARY_BYTES = 4 * 1024

export interface ClaudeStreamNormalizerOptions {
  readonly sessionId: string
  readonly turnId: string
  readonly cwd: string
  readonly testedVersion?: string
  readonly platform?: NodeJS.Platform
  readonly now?: () => string
}

interface NormalizedTool {
  readonly name: CanonicalClaudeToolName
  readonly kind: ToolKind
  readonly summary: string
  readonly command?: string
}

interface ToolState extends NormalizedTool {
  readonly itemId: string
  readonly providerName: string
  started: boolean
  completed: boolean
}

export class ClaudeStreamNormalizer {
  readonly #sessionId: string
  readonly #turnId: string
  readonly #cwd: string
  readonly #testedVersion?: string
  readonly #platform: NodeJS.Platform
  readonly #now: () => string
  readonly #tools = new Map<string, ToolState>()
  readonly #completedMessages = new Set<string>()
  #initialized = false
  #terminal = false
  #itemCounter = 0
  #currentMessageItemId?: string
  #currentProviderMessageId?: string
  #finalMessage?: string
  #assistantError?: string
  #result?: ClaudeCodeTurnResult
  #failure?: ClaudeCodeError

  constructor(options: ClaudeStreamNormalizerOptions) {
    this.#sessionId = options.sessionId
    this.#turnId = options.turnId
    this.#cwd = options.cwd
    this.#testedVersion = options.testedVersion
    this.#platform = options.platform ?? process.platform
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  get initialized(): boolean {
    return this.#initialized
  }

  get terminal(): boolean {
    return this.#terminal
  }

  get result(): ClaudeCodeTurnResult | undefined {
    return this.#result
  }

  get failure(): ClaudeCodeError | undefined {
    return this.#failure
  }

  consume(message: Record<string, unknown>): AgentEvent[] {
    if (this.#terminal) return []
    const type = readString(message, 'type')

    if (type === 'system' && readString(message, 'subtype') === 'init') {
      return this.#consumeInit(message)
    }
    if (!this.#initialized) throw new ClaudeCodeProtocolError()

    switch (type) {
      case 'stream_event':
        return this.#consumeStreamEvent(message)
      case 'assistant':
        return this.#consumeAssistant(message)
      case 'user':
        return this.#consumeUser(message)
      case 'result':
        return this.#consumeResult(message)
      default:
        return []
    }
  }

  fail(error: ClaudeCodeError): AgentEvent[] {
    if (this.#terminal) return []
    this.#terminal = true
    this.#failure = error
    return [this.#turnFailed(error)]
  }

  interrupt(): AgentEvent[] {
    if (this.#terminal) return []
    this.#terminal = true
    return [
      {
        type: 'turn.interrupted',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
      },
    ]
  }

  #consumeInit(message: Record<string, unknown>): AgentEvent[] {
    this.#validateSession(message)
    if (this.#initialized) return []

    const version = readString(message, 'claude_code_version')
    if (
      version === undefined ||
      (this.#testedVersion === undefined
        ? !isClaudeCodeTestedVersion(version)
        : version !== this.#testedVersion)
    ) {
      throw new ClaudeCodeVersionUnsupportedError(version ?? 'unknown')
    }
    const cwd = readString(message, 'cwd')
    if (cwd === undefined || !samePath(cwd, this.#cwd, this.#platform)) {
      throw new ClaudeCodeProtocolError()
    }

    this.#initialized = true
    return [
      {
        type: 'conversation.started',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        cwd: this.#cwd,
      },
      {
        type: 'turn.started',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
      },
    ]
  }

  #consumeStreamEvent(message: Record<string, unknown>): AgentEvent[] {
    this.#validateSession(message)
    const event = readRecord(message, 'event')
    if (event === undefined) throw new ClaudeCodeProtocolError()
    const eventType = readString(event, 'type')

    if (eventType === 'message_start') {
      const providerMessageId = readString(readRecord(event, 'message'), 'id')
      this.#startMessage(providerMessageId)
      return []
    }

    if (eventType === 'content_block_start') {
      const block = readRecord(event, 'content_block')
      if (readString(block, 'type') !== 'tool_use') return []
      const providerToolId = readString(block, 'id')
      const providerToolName = readString(block, 'name')
      if (providerToolId === undefined || providerToolName === undefined) {
        throw new ClaudeCodeProtocolError()
      }
      const input = readRecord(block, 'input')
      if (input !== undefined && Object.keys(input).length > 0) {
        return this.#ensureToolStarted(providerToolId, providerToolName, input)
      }
      this.#registerTool(providerToolId, providerToolName)
      return []
    }

    if (eventType !== 'content_block_delta') return []
    const delta = readRecord(event, 'delta')
    if (readString(delta, 'type') !== 'text_delta') return []
    const text = readString(delta, 'text')
    if (text === undefined || text.length === 0) return []

    return [
      {
        type: 'message.delta',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
        itemId: this.#ensureMessageItem(),
        delta: boundUtf8(text, MAX_CLAUDE_DELTA_BYTES),
      },
    ]
  }

  #consumeAssistant(message: Record<string, unknown>): AgentEvent[] {
    this.#validateSession(message)
    const providerError = readString(message, 'error')
    if (providerError !== undefined) {
      this.#assistantError = providerError
      // Error-bearing assistant envelopes contain provider diagnostics, not
      // canonical Agent output. The terminal result below supplies the only
      // presentation-safe failure event.
      return []
    }

    const assistantMessage = readRecord(message, 'message')
    if (assistantMessage === undefined) throw new ClaudeCodeProtocolError()
    const providerMessageId =
      readString(assistantMessage, 'id') ?? readString(message, 'uuid')
    if (
      providerMessageId !== undefined &&
      providerMessageId !== this.#currentProviderMessageId
    ) {
      this.#startMessage(providerMessageId)
    }
    const messageKey =
      providerMessageId ?? this.#currentProviderMessageId ?? this.#nextItemId()
    if (this.#completedMessages.has(messageKey)) return []

    const content = readArray(assistantMessage, 'content')
    if (content === undefined) throw new ClaudeCodeProtocolError()
    const events: AgentEvent[] = []
    let hasCanonicalContent = false
    const text = content
      .map((block) =>
        isRecord(block) && readString(block, 'type') === 'text'
          ? (readString(block, 'text') ?? '')
          : '',
      )
      .join('')
    if (text.length > 0) {
      hasCanonicalContent = true
      const bounded = boundUtf8(text, MAX_CLAUDE_MESSAGE_BYTES)
      this.#finalMessage = bounded
      events.push({
        type: 'message.completed',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
        itemId: this.#ensureMessageItem(),
        message: bounded,
      })
    }

    for (const block of content) {
      if (!isRecord(block) || readString(block, 'type') !== 'tool_use') continue
      const providerToolId = readString(block, 'id')
      const providerToolName = readString(block, 'name')
      if (providerToolId === undefined || providerToolName === undefined) {
        throw new ClaudeCodeProtocolError()
      }
      hasCanonicalContent = true
      events.push(
        ...this.#ensureToolStarted(
          providerToolId,
          providerToolName,
          readRecord(block, 'input'),
        ),
      )
    }

    // Claude may emit a thinking-only assistant snapshot and later emit the
    // public text snapshot under the same Provider message ID. Only a snapshot
    // with canonical public content can complete the message identity.
    if (hasCanonicalContent) this.#completedMessages.add(messageKey)
    return events
  }

  #consumeUser(message: Record<string, unknown>): AgentEvent[] {
    this.#validateOptionalSession(message)
    const userMessage = readRecord(message, 'message')
    const content = readArray(userMessage, 'content')
    if (content === undefined) return []
    const events: AgentEvent[] = []

    for (const block of content) {
      if (!isRecord(block) || readString(block, 'type') !== 'tool_result') {
        continue
      }
      const providerToolId = readString(block, 'tool_use_id')
      if (providerToolId === undefined) throw new ClaudeCodeProtocolError()
      let tool = this.#tools.get(providerToolId)
      if (tool === undefined) {
        events.push(...this.#ensureToolStarted(providerToolId, 'unknown'))
        tool = this.#tools.get(providerToolId)
      } else if (!tool.started) {
        events.push(
          ...this.#ensureToolStarted(providerToolId, tool.providerName),
        )
        tool = this.#tools.get(providerToolId)
      }
      if (tool === undefined || tool.completed) continue

      const output = extractToolResultText(block.content)
      if (output.length > 0 && !isUnavailableShellTool(tool.providerName)) {
        events.push({
          type: 'tool.output',
          provider: CLAUDE_CODE_PROVIDER,
          timestamp: this.#timestamp(),
          threadId: this.#sessionId,
          turnId: this.#turnId,
          itemId: tool.itemId,
          output: boundUtf8(output, MAX_CLAUDE_TOOL_OUTPUT_BYTES),
          stream: 'combined',
        })
      }
      const success = block.is_error !== true
      tool.completed = true
      events.push({
        type: 'tool.completed',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
        itemId: tool.itemId,
        kind: tool.kind,
        name: tool.name,
        ...(tool.command === undefined ? {} : { command: tool.command }),
        success,
        summary: success
          ? tool.summary
          : boundUtf8(`${tool.summary} failed`, MAX_CLAUDE_TOOL_SUMMARY_BYTES),
      })
    }
    return events
  }

  #consumeResult(message: Record<string, unknown>): AgentEvent[] {
    this.#validateSession(message)
    const subtype = readString(message, 'subtype')
    const isError = message.is_error === true
    if (subtype === 'success' && !isError) {
      this.#terminal = true
      this.#result = {
        sessionId: this.#sessionId,
        turnId: this.#turnId,
        ...(this.#finalMessage === undefined
          ? {}
          : { finalMessage: this.#finalMessage }),
      }
      return [
        {
          type: 'turn.completed',
          provider: CLAUDE_CODE_PROVIDER,
          timestamp: this.#timestamp(),
          threadId: this.#sessionId,
          turnId: this.#turnId,
          ...(this.#finalMessage === undefined
            ? {}
            : { finalMessage: this.#finalMessage }),
        },
      ]
    }

    const failure = providerFailure(this.#assistantError, subtype)
    this.#terminal = true
    this.#failure = failure
    return [this.#turnFailed(failure)]
  }

  #ensureToolStarted(
    providerToolId: string,
    providerToolName: string,
    input?: Record<string, unknown>,
  ): AgentEvent[] {
    const state = this.#registerTool(providerToolId, providerToolName, input)
    if (state.started) return []
    state.started = true
    return [
      {
        type: 'tool.started',
        provider: CLAUDE_CODE_PROVIDER,
        timestamp: this.#timestamp(),
        threadId: this.#sessionId,
        turnId: this.#turnId,
        itemId: state.itemId,
        kind: state.kind,
        name: state.name,
        ...(state.command === undefined ? {} : { command: state.command }),
        summary: state.summary,
      },
    ]
  }

  #registerTool(
    providerToolId: string,
    providerToolName: string,
    input?: Record<string, unknown>,
  ): ToolState {
    const existing = this.#tools.get(providerToolId)
    if (existing !== undefined) {
      if (existing.providerName !== providerToolName) {
        throw new ClaudeCodeProtocolError()
      }
      if (!existing.started && input !== undefined) {
        const normalized = normalizeClaudeTool(
          providerToolName,
          input,
          this.#cwd,
        )
        Object.assign(existing, normalized)
      }
      return existing
    }
    const normalized = normalizeClaudeTool(providerToolName, input, this.#cwd)
    const state: ToolState = {
      ...normalized,
      itemId: this.#nextItemId(),
      providerName: providerToolName,
      started: false,
      completed: false,
    }
    this.#tools.set(providerToolId, state)
    return state
  }

  #startMessage(providerMessageId?: string): void {
    this.#currentProviderMessageId = providerMessageId
    this.#currentMessageItemId = this.#nextItemId()
  }

  #ensureMessageItem(): string {
    this.#currentMessageItemId ??= this.#nextItemId()
    return this.#currentMessageItemId
  }

  #nextItemId(): string {
    this.#itemCounter += 1
    return `${this.#turnId}_claude_item_${String(this.#itemCounter)}`
  }

  #validateSession(message: Record<string, unknown>): void {
    if (readString(message, 'session_id') !== this.#sessionId) {
      throw new ClaudeCodeSessionLostError()
    }
  }

  #validateOptionalSession(message: Record<string, unknown>): void {
    const sessionId = readString(message, 'session_id')
    if (sessionId !== undefined && sessionId !== this.#sessionId) {
      throw new ClaudeCodeSessionLostError()
    }
  }

  #turnFailed(error: ClaudeCodeError): AgentEvent {
    return {
      type: 'turn.failed',
      provider: CLAUDE_CODE_PROVIDER,
      timestamp: this.#timestamp(),
      threadId: this.#sessionId,
      turnId: this.#turnId,
      error: { code: error.code, message: error.message },
    }
  }

  #timestamp(): string {
    return this.#now()
  }
}

export function normalizeClaudeTool(
  providerName: string,
  input?: Record<string, unknown>,
  cwd?: string,
): NormalizedTool {
  switch (providerName) {
    case 'Read':
      return withSafePath(
        { name: 'Read', kind: 'read', summary: 'Read file' },
        'Read',
        readString(input, 'file_path'),
        cwd,
      )
    case 'Edit':
    case 'Write':
      return withSafePath(
        { name: 'Edit', kind: 'edit', summary: 'Edit file' },
        providerName,
        readString(input, 'file_path'),
        cwd,
      )
    case 'Bash':
    case 'PowerShell':
      return {
        name: 'Generic Tool',
        kind: 'generic',
        summary: 'Run unavailable tool',
      }
    case 'Glob':
      return normalizeSearchTool(
        'Glob',
        readString(input, 'pattern'),
        readString(input, 'path'),
        cwd,
      )
    case 'Grep':
      return normalizeSearchTool(
        'Grep',
        readString(input, 'pattern'),
        readString(input, 'path'),
        cwd,
      )
    default:
      return {
        name: 'Generic Tool',
        kind: 'generic',
        summary: 'Run tool',
      }
  }
}

function isUnavailableShellTool(providerName: string): boolean {
  return providerName === 'Bash' || providerName === 'PowerShell'
}

function normalizeSearchTool(
  providerName: 'Glob' | 'Grep',
  rawPattern: string | undefined,
  rawPath: string | undefined,
  cwd: string | undefined,
): NormalizedTool {
  const pattern = boundedInputText(rawPattern)
  const path = safeProjectRelativePath(rawPath, cwd)
  const parts = [
    providerName,
    pattern,
    path === undefined ? undefined : `in ${path}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ')
  return {
    name: 'Search',
    kind: 'search',
    summary: 'Search workspace',
    ...(parts === providerName
      ? {}
      : { command: boundUtf8(parts, MAX_CLAUDE_TOOL_COMMAND_BYTES) }),
  }
}

function withSafePath(
  fallback: NormalizedTool,
  providerName: 'Read' | 'Edit' | 'Write',
  rawPath: string | undefined,
  cwd: string | undefined,
): NormalizedTool {
  const path = safeProjectRelativePath(rawPath, cwd)
  if (path === undefined) return fallback
  const command = boundUtf8(
    `${providerName} ${path}`,
    MAX_CLAUDE_TOOL_COMMAND_BYTES,
  )
  return {
    ...fallback,
    command,
    summary: boundUtf8(command, MAX_CLAUDE_TOOL_SUMMARY_BYTES),
  }
}

function safeProjectRelativePath(
  rawPath: string | undefined,
  cwd: string | undefined,
): string | undefined {
  const path = boundedInputText(rawPath)
  if (path === undefined || cwd === undefined) return undefined
  const root = resolve(cwd)
  const target = resolve(root, path)
  const relation = relative(root, target)
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    return undefined
  }
  return relation.length === 0 ? '.' : relation.split(sep).join('/')
}

function boundedInputText(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0 || value.includes('\0')) {
    return undefined
  }
  return boundUtf8(value, MAX_CLAUDE_TOOL_COMMAND_BYTES)
}

export function boundUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const suffix = '...'
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const contentLimit = Math.max(0, maxBytes - suffixBytes)
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > contentLimit) break
    result += character
    bytes += characterBytes
  }
  return result + (maxBytes >= suffixBytes ? suffix : '')
}

function providerFailure(
  assistantError: string | undefined,
  resultSubtype: string | undefined,
): ClaudeCodeError {
  switch (assistantError) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return new ClaudeCodeError(
        'provider_unavailable',
        'Claude Code authentication is unavailable.',
      )
    case 'billing_error':
      return new ClaudeCodeError(
        'provider_unavailable',
        'Claude Code billing is unavailable for this account.',
      )
    case 'model_not_found':
      return new ClaudeCodeError(
        'provider_unavailable',
        'The Claude Code model is unavailable for this account.',
      )
    case 'rate_limit':
      return new ClaudeCodeError(
        'provider_unavailable',
        'Claude Code is temporarily rate limited.',
      )
    default:
      return new ClaudeCodeError(
        'provider_unavailable',
        resultSubtype === 'error_max_budget_usd'
          ? 'Claude Code reached the configured turn budget.'
          : 'Claude Code could not complete this turn.',
      )
  }
}

function extractToolResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((entry) => {
      if (!isRecord(entry) || readString(entry, 'type') !== 'text') return ''
      return readString(entry, 'text') ?? ''
    })
    .filter((entry) => entry.length > 0)
    .join('\n')
}

function samePath(
  left: string,
  right: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function readRecord(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key]
  return isRecord(value) ? value : undefined
}

function readArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = record?.[key]
  return Array.isArray(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
