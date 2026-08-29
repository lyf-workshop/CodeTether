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

/** A completed review is durably resolved before real Conversation navigation. */
export async function reviewCompletedAttention(
  client: InboxActionClient,
  item: CompletedAttentionItem,
  navigate: (
    conversationId: ConversationId,
    turnId: TurnId | undefined,
  ) => void | Promise<void>,
): Promise<void> {
  await client.resolveAttention(item.attentionId)
  await navigate(item.conversationId, item.turnId)
}

/** A failed acknowledgement changes only Attention, never the Turn outcome. */
export async function acknowledgeFailedAttention(
  client: InboxActionClient,
  item: FailedAttentionItem,
): Promise<void> {
  await client.resolveAttention(item.attentionId)
}
