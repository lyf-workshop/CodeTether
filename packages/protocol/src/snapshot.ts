import { z } from 'zod'

import {
  EpochIdSchema,
  ProtocolVersionSchema,
  SnapshotSequenceSchema,
} from './ids.js'
import {
  ApprovalRecordSchema,
  ConversationRecordSchema,
  TurnRecordSchema,
  type TurnRecord,
} from './records.js'
import {
  ConversationRuntimeSnapshotSchema,
  type ConversationRuntimeSnapshot,
} from './runtime-history.js'

/**
 * Protocol v1 Snapshot. `conversationRuntimes` is an additive extension: a
 * Phase 2B Snapshot without it remains valid, while a Host that supplies it
 * must supply one complete runtime projection for every Conversation.
 */
export const HostSnapshotSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    epoch: EpochIdSchema,
    currentSeq: SnapshotSequenceSchema,
    conversations: z.array(ConversationRecordSchema),
    activeTurns: z.array(
      TurnRecordSchema.refine((turn) => turn.status === 'running', {
        message: 'activeTurns may only contain running turns',
      }),
    ),
    pendingApprovals: z.array(
      ApprovalRecordSchema.refine((approval) => approval.status === 'pending', {
        message: 'pendingApprovals may only contain pending approvals',
      }),
    ),
    conversationRuntimes: z.array(ConversationRuntimeSnapshotSchema).optional(),
  })
  .strict()
  .superRefine(validateSnapshot)
export type HostSnapshot = z.infer<typeof HostSnapshotSchema>

function validateSnapshot(
  snapshot: HostSnapshotValue,
  context: z.RefinementCtx,
): void {
  const conversations = new Map(
    snapshot.conversations.map((conversation) => [
      String(conversation.conversationId),
      conversation,
    ]),
  )
  if (conversations.size !== snapshot.conversations.length) {
    addSnapshotIssue(
      context,
      ['conversations'],
      'Conversation IDs must be unique',
    )
  }

  const turns = new Map(
    snapshot.activeTurns.map((turn) => [String(turn.turnId), turn]),
  )
  if (turns.size !== snapshot.activeTurns.length) {
    addSnapshotIssue(context, ['activeTurns'], 'Turn IDs must be unique')
  }
  for (const [index, turn] of snapshot.activeTurns.entries()) {
    const conversation = conversations.get(String(turn.conversationId))
    if (conversation?.activeTurnId !== turn.turnId) {
      addSnapshotIssue(
        context,
        ['activeTurns', index],
        'Active Turn must match its Conversation activeTurnId',
      )
    }
  }
  for (const [index, conversation] of snapshot.conversations.entries()) {
    if (
      conversation.activeTurnId !== undefined &&
      !turns.has(String(conversation.activeTurnId))
    ) {
      addSnapshotIssue(
        context,
        ['conversations', index, 'activeTurnId'],
        'Conversation activeTurnId must exist in activeTurns',
      )
    }
  }

  const approvalIds = new Set(
    snapshot.pendingApprovals.map((approval) => String(approval.approvalId)),
  )
  if (approvalIds.size !== snapshot.pendingApprovals.length) {
    addSnapshotIssue(
      context,
      ['pendingApprovals'],
      'Approval IDs must be unique',
    )
  }
  for (const [index, approval] of snapshot.pendingApprovals.entries()) {
    const conversation = conversations.get(String(approval.conversationId))
    const turn = turns.get(String(approval.turnId))
    if (
      conversation?.status !== 'waiting' ||
      conversation.activeTurnId !== approval.turnId ||
      turn?.conversationId !== approval.conversationId
    ) {
      addSnapshotIssue(
        context,
        ['pendingApprovals', index],
        'Pending Approval must belong to an active waiting Turn',
      )
    }
  }

  if (snapshot.conversationRuntimes !== undefined) {
    validateConversationRuntimes(snapshot, conversations, turns, context)
  }
}

interface HostSnapshotValue {
  readonly protocolVersion: z.infer<typeof ProtocolVersionSchema>
  readonly epoch: z.infer<typeof EpochIdSchema>
  readonly currentSeq: z.infer<typeof SnapshotSequenceSchema>
  readonly conversations: ReadonlyArray<
    z.infer<typeof ConversationRecordSchema>
  >
  readonly activeTurns: readonly TurnRecord[]
  readonly pendingApprovals: ReadonlyArray<z.infer<typeof ApprovalRecordSchema>>
  readonly conversationRuntimes?: readonly ConversationRuntimeSnapshot[]
}

function validateConversationRuntimes(
  snapshot: HostSnapshotValue,
  conversations: ReadonlyMap<string, z.infer<typeof ConversationRecordSchema>>,
  activeTurns: ReadonlyMap<string, TurnRecord>,
  context: z.RefinementCtx,
): void {
  const runtimes = snapshot.conversationRuntimes
  if (runtimes === undefined) return

  const runtimeByConversation = new Map(
    runtimes.map((runtime) => [String(runtime.conversationId), runtime]),
  )
  if (runtimeByConversation.size !== runtimes.length) {
    addSnapshotIssue(
      context,
      ['conversationRuntimes'],
      'Conversation runtime IDs must be unique',
    )
  }
  if (runtimeByConversation.size !== conversations.size) {
    addSnapshotIssue(
      context,
      ['conversationRuntimes'],
      'Conversation runtime history must be supplied for every Conversation',
    )
  }

  const retainedTurnOwners = new Map<string, string>()
  for (const [runtimeIndex, runtime] of runtimes.entries()) {
    const runtimeConversationId = String(runtime.conversationId)
    if (!conversations.has(runtimeConversationId)) {
      addSnapshotIssue(
        context,
        ['conversationRuntimes', runtimeIndex, 'conversationId'],
        'Conversation runtime must reference a Snapshot Conversation',
      )
    }
    for (const [turnIndex, turn] of runtime.turns.entries()) {
      const id = String(turn.turnId)
      const previousOwner = retainedTurnOwners.get(id)
      if (previousOwner !== undefined) {
        addSnapshotIssue(
          context,
          ['conversationRuntimes', runtimeIndex, 'turns', turnIndex, 'turnId'],
          'Retained Turn IDs must be unique across Conversations',
        )
      } else {
        retainedTurnOwners.set(id, runtimeConversationId)
      }
    }
  }

  for (const [conversationId, conversation] of conversations) {
    const runtime = runtimeByConversation.get(conversationId)
    if (runtime === undefined) continue
    if (conversation.activeTurnId !== undefined) {
      const activeTurn = activeTurns.get(String(conversation.activeTurnId))
      const retained = runtime.turns.find(
        (turn) => turn.turnId === conversation.activeTurnId,
      )
      if (retained === undefined) {
        addSnapshotIssue(
          context,
          ['conversationRuntimes'],
          'Active Turn must be retained in its Conversation runtime',
        )
      } else if (
        activeTurn !== undefined &&
        !sameTurnRecord(activeTurn, retained)
      ) {
        addSnapshotIssue(
          context,
          ['conversationRuntimes'],
          'Active Turn records must agree across Snapshot views',
        )
      }
    }
  }

  for (const [approvalIndex, approval] of snapshot.pendingApprovals.entries()) {
    const runtime = runtimeByConversation.get(String(approval.conversationId))
    const retainedTurn = runtime?.turns.find(
      (turn) => turn.turnId === approval.turnId,
    )
    if (retainedTurn === undefined) {
      addSnapshotIssue(
        context,
        ['pendingApprovals', approvalIndex, 'turnId'],
        'Pending Approval Turn must be retained in runtime history',
      )
    }
  }
}

function sameTurnRecord(left: TurnRecord, right: TurnRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function addSnapshotIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', message, path })
}
