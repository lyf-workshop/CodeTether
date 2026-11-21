import type { AttentionListResponse } from '@codetether/protocol'

type AttentionSummary = AttentionListResponse['summary']

export function devicesAttentionBanner(
  summary: AttentionSummary | undefined,
): { title: string; detail: string } | undefined {
  if (summary === undefined || summary.totalOpen === 0) return undefined
  const counts = [
    summary.approvalOpen > 0 ? `${summary.approvalOpen} 件等待批准` : undefined,
    summary.completedReviewOpen > 0
      ? `${summary.completedReviewOpen} 件待查看`
      : undefined,
    summary.failedOpen > 0 ? `${summary.failedOpen} 件失败` : undefined,
  ].filter((value): value is string => value !== undefined)
  return {
    title: `${summary.totalOpen} 件事需要你处理`,
    detail: counts.join(' · '),
  }
}
