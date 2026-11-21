import type {
  ApprovalDecision,
  AttentionId,
  AttentionItem,
  AttentionListResponse,
  ConversationId,
  TurnId,
} from '@codetether/protocol'
import type { InboxFilter } from './inbox-model.js'

export type ApprovalAttentionItem = Extract<AttentionItem, { type: 'approval' }>
export type CompletedAttentionItem = Extract<
  AttentionItem,
  { type: 'completed_review' }
>
export type FailedAttentionItem = Extract<AttentionItem, { type: 'failed' }>

export interface InboxActionClient {
  resolveApproval(
    approvalId: ApprovalAttentionItem['payload']['approvalId'],
    decision: ApprovalDecision,
  ): Promise<unknown>
  resolveAttention(attentionId: AttentionId): Promise<unknown>
}

/** Approval Attention can only operate on its exact bound Provider request. */
export async function resolveInboxApproval(
  client: InboxActionClient,
  item: ApprovalAttentionItem,
  decision: ApprovalDecision,
): Promise<void> {
  await client.resolveApproval(item.payload.approvalId, decision)
}

/** Attempt canonical resolution; reading the result must survive its failure. */
export async function reviewCompletedAttention(
  client: InboxActionClient,
  item: CompletedAttentionItem,
  navigate: (
    conversationId: ConversationId,
    turnId: TurnId | undefined,
    reviewFailed?: true,
  ) => void | Promise<void>,
): Promise<void> {
  let reviewFailed = false
  try {
    await client.resolveAttention(item.attentionId)
  } catch {
    reviewFailed = true
  }
  if (reviewFailed) await navigate(item.conversationId, item.turnId, true)
  else await navigate(item.conversationId, item.turnId)
}

/** Acknowledgement changes only Attention, never the Turn or an approval. */
export async function acknowledgeInboxAttention(
  client: InboxActionClient,
  item: FailedAttentionItem | CompletedAttentionItem,
): Promise<void> {
  if (item.type !== 'failed' && item.type !== 'completed_review') {
    throw new Error('Only completed or failed Attention can be acknowledged')
  }
  await client.resolveAttention(item.attentionId)
}

export interface BulkAcknowledgementProgress {
  readonly attempted: number
  readonly total: number
}

export interface BulkAcknowledgementResult extends BulkAcknowledgementProgress {
  readonly cleared: number
  readonly failed: number
}

export interface BulkAttentionClient extends InboxActionClient {
  listAttention(options: {
    readonly status: 'open'
    readonly type: 'failed' | 'completed_review'
    readonly limit: 100
  }): Promise<AttentionListResponse>
}

/** Uses the existing per-item action path, including its idempotent action IDs. */
export async function bulkAcknowledgeInboxAttention(
  client: BulkAttentionClient,
  filter: InboxFilter,
  summary: AttentionListResponse['summary'],
  onProgress: (progress: BulkAcknowledgementProgress) => void,
): Promise<BulkAcknowledgementResult> {
  const allTypes = [
    { type: 'failed' as const, count: summary.failedOpen },
    { type: 'completed_review' as const, count: summary.completedReviewOpen },
  ]
  const types = allTypes.filter(
    (entry) => filter === 'all' || entry.type === filter,
  )
  const total = types.reduce((count, entry) => count + entry.count, 0)
  let attempted = 0
  let cleared = 0
  onProgress({ attempted, total })

  for (const { type, count } of types) {
    const attemptedIds = new Set<string>()
    let attemptedForType = 0
    while (attemptedForType < count) {
      let page: AttentionListResponse
      try {
        page = await client.listAttention({ status: 'open', type, limit: 100 })
      } catch {
        break
      }
      const candidates = page.items.filter(
        (item): item is FailedAttentionItem | CompletedAttentionItem =>
          item.type === type && !attemptedIds.has(item.attentionId),
      )
      if (candidates.length === 0) break
      for (const item of candidates) {
        if (attemptedForType >= count) break
        attemptedIds.add(item.attentionId)
        attemptedForType += 1
        attempted += 1
        try {
          await acknowledgeInboxAttention(client, item)
          cleared += 1
        } catch {
          // Failed items stay open and are included in the final count.
        }
        onProgress({ attempted, total })
      }
    }
  }

  return { attempted, total, cleared, failed: total - cleared }
}
