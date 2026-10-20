import type {
  ApprovalDecision,
  AttentionId,
  AttentionItem,
  ConversationId,
  TurnId,
} from '@codetether/protocol'

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
