import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bot,
  Check,
  ExternalLink,
  History,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'

import { Button, DialogHeader, DialogTitle } from '@codetether/ui'
import { CodeTetherResponseError } from '@codetether/client'
import {
  providerSessionDiscoveryLimits,
  type ConversationId,
  type DiscoverProviderSessionsResponse,
  type DiscoveryCandidateId,
  type MachineId,
  type ProjectId,
  type ProviderId,
  type ProviderSessionDiscoveryCandidate,
  type ProviderSessionDiscoveryProviderResult,
} from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'

interface PreviousConversationsStepProps {
  readonly machineId: MachineId
  readonly projectId: ProjectId
  readonly onFinished: (
    disposition: 'reviewed' | 'skipped',
  ) => Promise<void> | void
  readonly presentation?: 'dialog' | 'page'
}

type CandidateActivity =
  | { readonly state: 'idle' }
  | { readonly state: 'importing' }
  | { readonly state: 'expired' }
  | { readonly state: 'failed' }

const providerOrder: readonly ProviderId[] = ['codex', 'claude-code']
const maximumImportSelection = providerSessionDiscoveryLimits.maximumPageSize
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function PreviousConversationsStep({
  machineId,
  projectId,
  onFinished,
  presentation = 'dialog',
}: PreviousConversationsStepProps) {
  const runtime = useHostRuntime()
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<
    readonly ProviderSessionDiscoveryCandidate[]
  >([])
  const [providers, setProviders] = useState<
    readonly ProviderSessionDiscoveryProviderResult[]
  >([])
  const [nextCursor, setNextCursor] =
    useState<DiscoverProviderSessionsResponse['nextCursor']>()
  const [selected, setSelected] = useState<ReadonlySet<DiscoveryCandidateId>>(
    new Set(),
  )
  const [activity, setActivity] = useState<
    ReadonlyMap<DiscoveryCandidateId, CandidateActivity>
  >(new Map())
  const [scanState, setScanState] = useState<
    'scanning' | 'loading-more' | 'ready' | 'failed'
  >('scanning')
  const [importedCount, setImportedCount] = useState(0)
  const stepRef = useRef<HTMLDivElement>(null)
  const scanGenerationRef = useRef(0)
  const scanAbortRef = useRef<AbortController | undefined>(undefined)
  const importInFlightRef = useRef(false)

  const runScan = useCallback(
    async (options: { readonly append: boolean; readonly rescan: boolean }) => {
      const generation = ++scanGenerationRef.current
      scanAbortRef.current?.abort()
      const abort = new AbortController()
      scanAbortRef.current = abort
      setScanState(options.append ? 'loading-more' : 'scanning')
      if (!options.append) {
        setSelected(new Set())
        setActivity(new Map())
      }

      try {
        const response = await runtime.discoverProviderSessions(
          projectId,
          machineId,
          {
            limit: 50,
            ...(options.append && nextCursor !== undefined
              ? { cursor: nextCursor }
              : {}),
            ...(options.rescan ? { rescan: true } : {}),
            signal: abort.signal,
          },
        )
        if (generation !== scanGenerationRef.current) return
        setCandidates((current) =>
          options.append
            ? mergeCandidates(current, response.candidates)
            : response.candidates,
        )
        setProviders(response.providers)
        setNextCursor(response.nextCursor)
        setScanState('ready')
        if (options.rescan) {
          globalThis.setTimeout(() => stepRef.current?.focus(), 0)
        }
      } catch (error) {
        if (abort.signal.aborted || isAbortError(error)) return
        if (generation !== scanGenerationRef.current) return
        setScanState('failed')
        if (options.rescan) {
          globalThis.setTimeout(() => stepRef.current?.focus(), 0)
        }
      } finally {
        if (scanAbortRef.current === abort) scanAbortRef.current = undefined
      }
    },
    [machineId, nextCursor, projectId, runtime],
  )

  useEffect(() => {
    const start = globalThis.setTimeout(() => {
      stepRef.current?.focus()
      void runScan({ append: false, rescan: false })
    }, 0)
    return () => {
      globalThis.clearTimeout(start)
      scanGenerationRef.current += 1
      scanAbortRef.current?.abort()
    }
    // A new ProjectLocation mounts a new step; pagination state must not make
    // the initial request repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, projectId, runtime])

  const selectable = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          !candidate.alreadyAdopted &&
          candidate.resumeStatus === 'supported' &&
          activity.get(candidate.discoveryCandidateId)?.state !== 'expired' &&
          activity.get(candidate.discoveryCandidateId)?.state !== 'failed',
      ),
    [activity, candidates],
  )
  const allVisibleSelected =
    selectable.length > 0 &&
    selectable.every((candidate) =>
      selected.has(candidate.discoveryCandidateId),
    )
  const selectionBatchFull =
    selected.size > 0 &&
    (allVisibleSelected || selected.size >= maximumImportSelection)
  const importing = [...activity.values()].some(
    (entry) => entry.state === 'importing',
  )

  function toggleCandidate(candidateId: DiscoveryCandidateId) {
    if (importing) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) next.delete(candidateId)
      else if (next.size < maximumImportSelection) next.add(candidateId)
      return next
    })
  }

  function toggleAllVisible() {
    if (importing) return
    setSelected((current) => {
      const next = new Set(current)
      if (selectionBatchFull) {
        for (const candidate of selectable) {
          next.delete(candidate.discoveryCandidateId)
        }
      } else {
        for (const candidate of selectable) {
          if (next.size >= maximumImportSelection) break
          next.add(candidate.discoveryCandidateId)
        }
      }
      return next
    })
  }

  async function importSelected() {
    if (
      importInFlightRef.current ||
      selected.size === 0 ||
      selected.size > maximumImportSelection
    ) {
      return
    }
    importInFlightRef.current = true
    try {
      let completed = 0
      for (const candidate of candidates) {
        if (!selected.has(candidate.discoveryCandidateId)) continue
        setCandidateActivity(candidate.discoveryCandidateId, 'importing')
        try {
          const response = await runtime.adoptProviderSession(
            projectId,
            machineId,
            candidate.discoveryCandidateId,
          )
          setCandidates((current) =>
            current.map((entry) =>
              entry.discoveryCandidateId === candidate.discoveryCandidateId
                ? {
                    ...entry,
                    alreadyAdopted: true,
                    conversationId: response.data.conversation.conversationId,
                  }
                : entry,
            ),
          )
          setCandidateActivity(candidate.discoveryCandidateId, 'idle')
          completed += 1
        } catch (error) {
          setCandidateActivity(
            candidate.discoveryCandidateId,
            isCandidateExpired(error) ? 'expired' : 'failed',
          )
        } finally {
          setSelected((current) => {
            const next = new Set(current)
            next.delete(candidate.discoveryCandidateId)
            return next
          })
        }
      }
      if (completed > 0) setImportedCount((current) => current + completed)
    } finally {
      importInFlightRef.current = false
      globalThis.setTimeout(() => stepRef.current?.focus(), 0)
    }
  }

  function setCandidateActivity(
    candidateId: DiscoveryCandidateId,
    state: CandidateActivity['state'],
  ) {
    setActivity((current) => {
      const next = new Map(current)
      next.set(candidateId, { state })
      return next
    })
  }

  async function openConversation(conversationId: ConversationId) {
    await onFinished('reviewed')
    await navigate({
      to: '/conversations/$conversationId',
      params: { conversationId },
    })
  }

  const grouped = providerOrder
    .map((provider) => ({
      provider,
      candidates: candidates.filter(
        (candidate) => candidate.provider === provider,
      ),
    }))
    .filter((group) => group.candidates.length > 0)
  const providerProblems = providers.filter(
    (provider) => provider.status !== 'supported',
  )
  const hasSupportedProvider = providers.some(
    (provider) => provider.status === 'supported',
  )

  return (
    <div
      ref={stepRef}
      tabIndex={-1}
      className="min-w-0 outline-none"
      aria-busy={
        scanState === 'scanning' || scanState === 'loading-more' || importing
      }
    >
      {presentation === 'dialog' ? (
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
          >
            <History className="size-5" />
          </span>
          <DialogTitle>以前的会话</DialogTitle>
          <p className="text-base leading-normal text-text-secondary">
            可选择此工作区中已有的 Codex 或 Claude Code 会话添加到 CodeTether。
            导入不会启动智能体。
          </p>
        </DialogHeader>
      ) : (
        <div>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
          >
            <History className="size-5" />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">
            以前的会话
          </h2>
          <p className="mt-2 text-base leading-normal text-text-secondary">
            可选择此工作区中已有的 Codex 或 Claude Code 会话添加到 CodeTether。
            导入不会启动智能体，也不会发送任何提示词。
          </p>
        </div>
      )}

      <div className="mt-5 min-w-0 space-y-4">
        <p className="sr-only" role="status" aria-live="polite">
          {scanStatusText(
            scanState,
            candidates.length,
            importedCount,
            hasSupportedProvider,
          )}
        </p>

        {scanState === 'scanning' ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-5 text-sm text-text-secondary"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            正在查找以前的会话…
          </div>
        ) : null}

        {scanState === 'failed' ? (
          <div
            role="alert"
            className="rounded-md border border-warning/30 bg-warning-muted/35 px-4 py-3 text-sm text-text-secondary"
          >
            <p>暂时无法检查以前的会话。项目已成功添加。</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => void runScan({ append: false, rescan: true })}
            >
              <RefreshCw aria-hidden="true" />
              重试
            </Button>
          </div>
        ) : null}

        {scanState !== 'scanning' && providerProblems.length > 0 ? (
          <div className="space-y-2" aria-label="部分提供商不可用">
            {providerProblems.map((provider) => (
              <p
                key={provider.provider}
                role="status"
                className="rounded-sm border border-warning/30 bg-warning-muted/35 px-3 py-2 text-sm text-text-secondary"
              >
                {providerProblemText(provider)}
              </p>
            ))}
          </div>
        ) : null}

        {scanState === 'ready' &&
        candidates.length === 0 &&
        hasSupportedProvider ? (
          <div
            role="status"
            className="rounded-md border border-border bg-surface-muted px-4 py-5 text-center"
          >
            <p className="text-sm font-medium text-text-primary">
              未找到以前的会话
            </p>
            <p className="mt-1 text-xs text-text-muted">
              你仍可立即打开项目并创建新会话。
            </p>
          </div>
        ) : null}

        {scanState !== 'scanning' && grouped.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-text-muted">
                已找到 {candidates.length} 个会话
              </p>
              {selectable.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={importing}
                  onClick={toggleAllVisible}
                >
                  {selectionBatchFull
                    ? '取消当前选择'
                    : selectable.length > maximumImportSelection
                      ? `最多选择 ${maximumImportSelection} 项`
                      : '选择当前结果'}
                </Button>
              ) : null}
            </div>

            <div className="max-h-[min(42vh,22rem)] space-y-4 overflow-y-auto pr-1">
              {grouped.map((group) => (
                <section
                  key={group.provider}
                  aria-labelledby={`previous-${group.provider}`}
                >
                  <h3
                    id={`previous-${group.provider}`}
                    className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary"
                  >
                    <Bot aria-hidden="true" className="size-4 text-primary" />
                    {providerLabel(group.provider)}
                    <span className="font-normal text-text-muted">
                      {group.candidates.length}
                    </span>
                  </h3>
                  <div className="overflow-hidden rounded-md border border-border">
                    {group.candidates.map((candidate, index) => {
                      const candidateActivity = activity.get(
                        candidate.discoveryCandidateId,
                      )?.state
                      const selectableCandidate =
                        !candidate.alreadyAdopted &&
                        candidate.resumeStatus === 'supported' &&
                        candidateActivity !== 'expired' &&
                        candidateActivity !== 'failed'
                      return (
                        <div
                          key={candidate.discoveryCandidateId}
                          className={`flex min-w-0 items-center gap-3 px-3 py-2.5 ${
                            index === 0 ? '' : 'border-t border-border'
                          }`}
                        >
                          {selectableCandidate ? (
                            <input
                              type="checkbox"
                              className="size-4 shrink-0 accent-[var(--color-primary-action)]"
                              checked={selected.has(
                                candidate.discoveryCandidateId,
                              )}
                              disabled={
                                importing ||
                                (selected.size >= maximumImportSelection &&
                                  !selected.has(candidate.discoveryCandidateId))
                              }
                              aria-label={`选择 ${candidate.title}`}
                              onChange={() =>
                                toggleCandidate(candidate.discoveryCandidateId)
                              }
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid size-4 shrink-0 place-items-center"
                            >
                              {candidate.alreadyAdopted ? (
                                <Check className="size-4 text-success" />
                              ) : null}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-text-primary">
                              {candidate.title}
                            </span>
                            <span
                              className="mt-0.5 block text-xs text-text-muted"
                              role={
                                candidateActivity === 'expired' ||
                                candidateActivity === 'failed'
                                  ? 'alert'
                                  : undefined
                              }
                            >
                              {candidateActivity === 'expired'
                                ? '会话已发生变化，请重新扫描'
                                : candidateActivity === 'failed'
                                  ? '无法导入此会话，请重新扫描后重试'
                                  : candidate.alreadyAdopted
                                    ? '已在 CodeTether 中'
                                    : candidate.resumeStatus === 'supported'
                                      ? formatCandidateTime(candidate)
                                      : '当前只能查看，无法继续'}
                            </span>
                          </span>
                          {candidateActivity === 'importing' ? (
                            <LoaderCircle
                              aria-label="正在导入"
                              className="size-4 animate-spin text-primary motion-reduce:animate-none"
                            />
                          ) : null}
                          {candidate.alreadyAdopted &&
                          candidate.conversationId !== undefined ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void openConversation(candidate.conversationId!)
                              }
                            >
                              打开
                              <ExternalLink aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {nextCursor !== undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={scanState === 'loading-more' || importing}
                  onClick={() => void runScan({ append: true, rescan: false })}
                >
                  {scanState === 'loading-more' ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  加载更多
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={scanState === 'loading-more' || importing}
                onClick={() => void runScan({ append: false, rescan: true })}
              >
                <RefreshCw aria-hidden="true" />
                重新扫描
              </Button>
            </div>
            {selectable.length > maximumImportSelection ? (
              <p className="text-xs text-text-muted">
                为保持导入操作有界，每次最多选择 {maximumImportSelection}{' '}
                个会话。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={
          presentation === 'dialog'
            ? 'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
            : 'mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4'
        }
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={importing}
          onClick={() =>
            void onFinished(importedCount > 0 ? 'reviewed' : 'skipped')
          }
        >
          {importedCount > 0 ? '完成' : '跳过'}
        </Button>
        {selected.size > 0 ? (
          <Button
            size="sm"
            disabled={importing}
            onClick={() => void importSelected()}
          >
            {importing ? '正在导入…' : `导入所选（${selected.size}）`}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function mergeCandidates(
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

function providerLabel(provider: ProviderId): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function providerProblemText(
  provider: ProviderSessionDiscoveryProviderResult,
): string {
  const label = providerLabel(provider.provider)
  if (provider.failureReason === 'machine_offline') {
    return `${label}：此电脑离线，暂时无法查看以前的会话。`
  }
  if (
    provider.status === 'unsupported' ||
    provider.failureReason === 'provider_session_format_unsupported'
  ) {
    return `${label}：当前版本不支持查找以前的会话。`
  }
  if (provider.failureReason === 'provider_session_store_unreadable') {
    return `${label}：无法读取以前的会话。不会更改提供商文件。`
  }
  return `${label}：以前的会话暂时不可用。`
}

function formatCandidateTime(
  candidate: ProviderSessionDiscoveryCandidate,
): string {
  const timestamp = candidate.lastActiveAt ?? candidate.createdAt
  if (timestamp === undefined) return '可继续'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '可继续'
  return `${dateFormatter.format(date)} · 可继续`
}

function scanStatusText(
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isCandidateExpired(error: unknown): boolean {
  return (
    error instanceof CodeTetherResponseError &&
    error.envelope.code === 'provider_session_candidate_expired'
  )
}
