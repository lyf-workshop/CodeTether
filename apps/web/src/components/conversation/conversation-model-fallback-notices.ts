export interface ConversationModelFallbackNotice {
  readonly configuredModel: string
  readonly selectedModel: string
}

const pendingNotices = new Map<string, ConversationModelFallbackNotice>()

export const conversationModelFallbackNotices = {
  queue(conversationId: string, notice: ConversationModelFallbackNotice): void {
    pendingNotices.set(conversationId, notice)
  },
  take(conversationId: string): ConversationModelFallbackNotice | undefined {
    const notice = pendingNotices.get(conversationId)
    pendingNotices.delete(conversationId)
    return notice
  },
}
