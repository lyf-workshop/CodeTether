import { CodeTetherResponseError } from '@codetether/client'
import {
  providerSessionDiscoveryLimits,
  type ProviderId,
  type ProviderSessionDiscoveryCandidate,
  type ProviderSessionDiscoveryProviderResult,
} from '@codetether/protocol'

export type CandidateActivity =
  | { readonly state: 'idle' }
  | { readonly state: 'importing' }
  | { readonly state: 'expired' }
  | { readonly state: 'failed' }

export const providerOrder: readonly ProviderId[] = ['codex', 'claude-code']
export const maximumImportSelection =
  providerSessionDiscoveryLimits.maximumPageSize
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function mergeCandidates(
  current: readonly ProviderSessionDiscoveryCandidate[],
  incoming: readonly ProviderSessionDiscoveryCandidate[],
): readonly ProviderSessionDiscoveryCandidate[] {
  const merged = new Map(
    current.map((candidate) => [candidate.discoveryCandidateId, candidate]),
  )
  for (const candidate of incoming) {
    merged.set(candidate.discoveryCandidateId, candidate)
  }
  return [...merged.values()]
}

export function providerLabel(provider: ProviderId): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

export function providerProblemText(
  provider: ProviderSessionDiscoveryProviderResult,
): string {
  const label = providerLabel(provider.provider)
  if (provider.failureReason === 'machine_offline') {
    return `${label}：这台电脑离线，暂时无法查看以前的会话。`
  }
  if (
    provider.status === 'unsupported' ||
    provider.failureReason === 'provider_session_format_unsupported'
  ) {
    return `${label}：当前版本不支持查找以前的会话。`
  }
  if (provider.failureReason === 'provider_session_store_unreadable') {
    return `${label}：无法读取以前的会话。不会更改 AI 工具的文件。`
  }
  return `${label}：以前的会话暂时不可用。`
}

export function formatCandidateTime(
  candidate: ProviderSessionDiscoveryCandidate,
): string {
  const timestamp = candidate.lastActiveAt ?? candidate.createdAt
  if (timestamp === undefined) return '可继续'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '可继续'
  return `${dateFormatter.format(date)} · 可继续`
}

export function scanStatusText(
  state: 'scanning' | 'loading-more' | 'ready' | 'failed',
  candidateCount: number,
  importedCount: number,
  hasSupportedProvider: boolean,
): string {
  if (state === 'scanning') return '正在查找以前的会话。'
  if (state === 'loading-more') return '正在加载更多以前的会话。'
  if (state === 'failed') return '无法检查以前的会话。'
  if (importedCount > 0) return `已导入 ${importedCount} 个会话。`
  if (!hasSupportedProvider) return '以前的会话当前不可用。'
  return candidateCount === 0
    ? '未找到以前的会话。'
    : `已找到 ${candidateCount} 个以前的会话。`
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function isCandidateExpired(error: unknown): boolean {
  return (
    error instanceof CodeTetherResponseError &&
    error.envelope.code === 'provider_session_candidate_expired'
  )
}
