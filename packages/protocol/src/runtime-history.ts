import { z } from 'zod'

import {
  FileChangeKindSchema,
  ToolCommandSchema,
  ToolKindSchema,
  ToolOutputStreamSchema,
} from './events.js'
import {
  ConversationIdSchema,
  ItemIdSchema,
  TimestampSchema,
  TurnIdSchema,
} from './ids.js'
import { TurnRecordSchema } from './records.js'

/** Protocol safety ceilings; the Host may retain substantially less. */
export const conversationRuntimeWireLimits = {
  turns: 64,
  messages: 2048,
  tools: 2048,
  changes: 2048,
  terminalBytes: 128 * 1024,
} as const

export const RuntimeItemOrderSchema = z.number().int().nonnegative().safe()
export type RuntimeItemOrder = z.infer<typeof RuntimeItemOrderSchema>

export const RuntimeMessageStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type RuntimeMessageStatus = z.infer<typeof RuntimeMessageStatusSchema>

export const ConversationMessageRecordSchema = z
  .object({
    turnId: TurnIdSchema,
    itemId: ItemIdSchema,
    text: z.string().max(1024 * 1024),
    status: RuntimeMessageStatusSchema,
    timestamp: TimestampSchema,
    order: RuntimeItemOrderSchema,
  })
  .strict()
export type ConversationMessageRecord = z.infer<
  typeof ConversationMessageRecordSchema
>

export const RuntimeToolStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type RuntimeToolStatus = z.infer<typeof RuntimeToolStatusSchema>

export const ConversationToolRecordSchema = z
  .object({
    turnId: TurnIdSchema,
    itemId: ItemIdSchema,
    name: z.string().trim().min(1).max(240),
    /** Optional so durable snapshots written before Provider foundation remain valid. */
    kind: ToolKindSchema.optional(),
    command: ToolCommandSchema.optional(),
    summary: z.string().max(4096).optional(),
    status: RuntimeToolStatusSchema,
    success: z.boolean().optional(),
    outputSummary: z.string().max(4096).optional(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    order: RuntimeItemOrderSchema,
  })
  .strict()
  .superRefine((tool, context) => {
    if (tool.status === 'running') {
      if (tool.completedAt !== undefined) {
        addIssue(
          context,
          ['completedAt'],
          'A running Tool cannot have completedAt',
        )
      }
      if (tool.success !== undefined) {
        addIssue(
          context,
          ['success'],
          'A running Tool cannot have a success result',
        )
      }
    } else {
      if (tool.completedAt === undefined) {
        addIssue(
          context,
          ['completedAt'],
          'A terminal Tool requires completedAt',
        )
      }
      if (tool.status === 'completed' && tool.success === false) {
        addIssue(
          context,
          ['success'],
          'An unsuccessful Tool must use failed status',
        )
      }
      if (tool.status === 'failed' && tool.success === true) {
        addIssue(
          context,
          ['success'],
          'A failed Tool cannot have a successful result',
        )
      }
      if (tool.status === 'interrupted' && tool.success !== undefined) {
        addIssue(
          context,
          ['success'],
          'An interrupted Tool cannot have a success result',
        )
      }
    }
  })
export type ConversationToolRecord = z.infer<
  typeof ConversationToolRecordSchema
>

export const ConversationFileChangeRecordSchema = z
  .object({
    turnId: TurnIdSchema,
    itemId: ItemIdSchema.optional(),
    path: z.string().trim().min(1).max(4096),
    kind: FileChangeKindSchema,
    diff: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
    additions: z.number().int().nonnegative().safe().optional(),
    deletions: z.number().int().nonnegative().safe().optional(),
    timestamp: TimestampSchema,
    order: RuntimeItemOrderSchema,
  })
  .strict()
export type ConversationFileChangeRecord = z.infer<
  typeof ConversationFileChangeRecordSchema
>

export const ConversationTerminalRecordSchema = z
  .object({
    turnId: TurnIdSchema.optional(),
    itemId: ItemIdSchema.optional(),
    command: z
      .string()
      .max(32 * 1024)
      .optional(),
    text: utf8BoundedString(conversationRuntimeWireLimits.terminalBytes),
    stream: ToolOutputStreamSchema.optional(),
    truncated: z.boolean(),
    updatedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((terminal, context) => {
    if (terminal.itemId !== undefined && terminal.turnId === undefined) {
      addIssue(
        context,
        ['turnId'],
        'A Terminal Item identity requires its Turn identity',
      )
    }
    if (
      terminal.text.length > 0 &&
      (terminal.turnId === undefined || terminal.updatedAt === undefined)
    ) {
      addIssue(
        context,
        ['text'],
        'Terminal output requires Turn identity and updatedAt',
      )
    }
  })
export type ConversationTerminalRecord = z.infer<
  typeof ConversationTerminalRecordSchema
>

export const ConversationRuntimeHistoryMetadataSchema = z
  .object({
    evictedTurns: z.number().int().nonnegative().safe(),
    evictedMessages: z.number().int().nonnegative().safe(),
    evictedTools: z.number().int().nonnegative().safe(),
    evictedChanges: z.number().int().nonnegative().safe(),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((history, context) => {
    const hasKnownEviction =
      history.evictedTurns > 0 ||
      history.evictedMessages > 0 ||
      history.evictedTools > 0 ||
      history.evictedChanges > 0
    if (hasKnownEviction && !history.truncated) {
      addIssue(
        context,
        ['truncated'],
        'Runtime history with evicted records must be marked truncated',
      )
    }
  })
export type ConversationRuntimeHistoryMetadata = z.infer<
  typeof ConversationRuntimeHistoryMetadataSchema
>

export const ConversationRuntimeSnapshotSchema = z
  .object({
    conversationId: ConversationIdSchema,
    turns: z.array(TurnRecordSchema).max(conversationRuntimeWireLimits.turns),
    messages: z
      .array(ConversationMessageRecordSchema)
      .max(conversationRuntimeWireLimits.messages),
    tools: z
      .array(ConversationToolRecordSchema)
      .max(conversationRuntimeWireLimits.tools),
    changes: z
      .array(ConversationFileChangeRecordSchema)
      .max(conversationRuntimeWireLimits.changes),
    terminal: ConversationTerminalRecordSchema,
    history: ConversationRuntimeHistoryMetadataSchema,
  })
  .strict()
  .superRefine(validateConversationRuntime)
export type ConversationRuntimeSnapshot = z.infer<
  typeof ConversationRuntimeSnapshotSchema
>

function validateConversationRuntime(
  runtime: ConversationRuntimeValue,
  context: z.RefinementCtx,
): void {
  const turns = new Map(
    runtime.turns.map((turn) => [String(turn.turnId), turn]),
  )
  if (turns.size !== runtime.turns.length) {
    addIssue(context, ['turns'], 'Retained Turn IDs must be unique')
  }
  for (const [index, turn] of runtime.turns.entries()) {
    if (turn.conversationId !== runtime.conversationId) {
      addIssue(
        context,
        ['turns', index, 'conversationId'],
        'Retained Turn must belong to its runtime Conversation',
      )
    }
    if (turn.input === undefined) {
      addIssue(
        context,
        ['turns', index, 'input'],
        'A retained runtime Turn requires its canonical User input',
      )
    }
  }

  const itemKeys = new Set<string>()
  validateItems(runtime.messages, 'messages', turns, itemKeys, context)
  validateItems(runtime.tools, 'tools', turns, itemKeys, context)

  const changeKeys = new Set<string>()
  for (const [index, change] of runtime.changes.entries()) {
    validateTurnOwnership(change.turnId, 'changes', index, turns, context)
    const key = `${String(change.turnId)}:${String(change.itemId ?? 'no-item')}:${change.path}`
    if (changeKeys.has(key)) {
      addIssue(
        context,
        ['changes', index],
        'Retained File Change identity must be unique within a Turn',
      )
    }
    changeKeys.add(key)
  }

  validateOrders(runtime, context)
  validateTerminal(runtime, turns, context)
  if (runtime.terminal.truncated && !runtime.history.truncated) {
    addIssue(
      context,
      ['history', 'truncated'],
      'Truncated Terminal output must mark runtime history truncated',
    )
  }
}

interface ConversationRuntimeValue {
  readonly conversationId: z.infer<typeof ConversationIdSchema>
  readonly turns: ReadonlyArray<z.infer<typeof TurnRecordSchema>>
  readonly messages: ReadonlyArray<
    z.infer<typeof ConversationMessageRecordSchema>
  >
  readonly tools: ReadonlyArray<z.infer<typeof ConversationToolRecordSchema>>
  readonly changes: ReadonlyArray<
    z.infer<typeof ConversationFileChangeRecordSchema>
  >
  readonly terminal: z.infer<typeof ConversationTerminalRecordSchema>
  readonly history: z.infer<typeof ConversationRuntimeHistoryMetadataSchema>
}

function validateItems(
  items: ReadonlyArray<{ readonly turnId: string; readonly itemId: string }>,
  field: 'messages' | 'tools',
  turns: ReadonlyMap<string, unknown>,
  itemKeys: Set<string>,
  context: z.RefinementCtx,
): void {
  for (const [index, item] of items.entries()) {
    validateTurnOwnership(item.turnId, field, index, turns, context)
    const key = `${String(item.turnId)}:${String(item.itemId)}`
    if (itemKeys.has(key)) {
      addIssue(
        context,
        [field, index, 'itemId'],
        'Retained message and Tool Item identities must be unique',
      )
    }
    itemKeys.add(key)
  }
}

function validateTurnOwnership(
  turnId: string,
  field: 'messages' | 'tools' | 'changes',
  index: number,
  turns: ReadonlyMap<string, unknown>,
  context: z.RefinementCtx,
): void {
  if (!turns.has(String(turnId))) {
    addIssue(
      context,
      [field, index, 'turnId'],
      'Runtime Item must belong to a retained Turn',
    )
  }
}

function validateOrders(
  runtime: ConversationRuntimeValue,
  context: z.RefinementCtx,
): void {
  const orders = new Set<number>()
  for (const field of ['messages', 'tools', 'changes'] as const) {
    for (const [index, item] of runtime[field].entries()) {
      if (orders.has(item.order)) {
        addIssue(
          context,
          [field, index, 'order'],
          'Runtime presentation order must be unique within a Conversation',
        )
      }
      orders.add(item.order)
    }
  }
}

function validateTerminal(
  runtime: ConversationRuntimeValue,
  turns: ReadonlyMap<string, unknown>,
  context: z.RefinementCtx,
): void {
  const terminal = runtime.terminal
  if (terminal.turnId !== undefined && !turns.has(String(terminal.turnId))) {
    addIssue(
      context,
      ['terminal', 'turnId'],
      'Terminal output must belong to a retained Turn',
    )
  }
  if (terminal.turnId === undefined || terminal.itemId === undefined) return
  const toolExists = runtime.tools.some(
    (tool) =>
      tool.turnId === terminal.turnId && tool.itemId === terminal.itemId,
  )
  if (!toolExists) {
    addIssue(
      context,
      ['terminal', 'itemId'],
      'Terminal Item identity must reference a retained Tool',
    )
  }
}

function utf8BoundedString(maxBytes: number): z.ZodString {
  return z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= maxBytes,
      `String must not exceed ${String(maxBytes)} UTF-8 bytes`,
    )
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', message, path })
}
