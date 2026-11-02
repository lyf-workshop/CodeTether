import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type {
  ConversationId,
  DiscoverProviderSessionsResponse,
  DiscoveryCandidateId,
  MachineId,
  ProjectId,
} from '@codetether/protocol'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  reconcilePreviousConversationSelection,
  setPreviousConversationSelection,
} from './previous-conversations-selection'
import {
  providerOrder,
  maximumImportSelection,
  mergeCandidates,
  isAbortError,
  isCandidateExpired,
  type CandidateActivity,
} from './previous-conversations-presentation'
import { usePreviousConversationsSelection } from './use-previous-conversations-selection'

export interface PreviousConversationsStepProps {
  readonly machineId: MachineId
  readonly projectId: ProjectId
  readonly onFinished: (
    disposition: 'reviewed' | 'skipped',
  ) => Promise<void> | void
  readonly presentation?: 'dialog' | 'page' | 'embedded'
}

export function usePreviousConversations({
  machineId,
  projectId,
  onFinished,
  presentation = 'dialog',
}: PreviousConversationsStepProps) {
  const runtime = useHostRuntime()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => ['host', 'provider-session-discovery', projectId, machineId] as const,
    [machineId, projectId],
  )
  const selectionScope = JSON.stringify([projectId, machineId])
  const [activity, setActivity] = useState<
    ReadonlyMap<DiscoveryCandidateId, CandidateActivity>
  >(new Map())
  const [manualScanState, setManualScanState] = useState<
    'idle' | 'scanning' | 'failed'
  >('idle')
  const [importedCount, setImportedCount] = useState(0)
  const [importing, setImporting] = useState(false)
  const [scanNotice, setScanNotice] = useState('')
  const stepRef = useRef<HTMLDivElement>(null)
  const selectionId = useId()
  const scanGenerationRef = useRef(0)
  const lifecycleGenerationRef = useRef(0)
  const scanAbortRef = useRef<AbortController | undefined>(undefined)
  const scanInFlightRef = useRef(false)
  const importInFlightRef = useRef(false)
  const discoveryQuery = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) =>
      await runtime.discoverProviderSessions(projectId, machineId, {
        limit: 50,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        signal,
      }),
    initialPageParam:
      undefined as DiscoverProviderSessionsResponse['nextCursor'],
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const candidates = useMemo(
    () =>
      mergeCandidates(
        [],
        discoveryQuery.data?.pages.flatMap((page) => page.candidates) ?? [],
      ),
    [discoveryQuery.data],
  )
  const providers = discoveryQuery.data?.pages.at(-1)?.providers ?? []
  const nextCursor = discoveryQuery.data?.pages.at(-1)?.nextCursor
  const {
    currentSelection,
    selected,
    selectable,
    selectionBatchFull,
    updateSelection,
    toggleCandidate,
    toggleAllVisible,
  } = usePreviousConversationsSelection(
    selectionScope,
    candidates,
    activity,
    importInFlightRef,
  )
  const scanState: 'scanning' | 'loading-more' | 'ready' | 'failed' =
    manualScanState === 'scanning' || discoveryQuery.isPending
      ? 'scanning'
      : discoveryQuery.isFetchingNextPage
        ? 'loading-more'
        : manualScanState === 'failed' || discoveryQuery.isError
          ? 'failed'
          : 'ready'

  const runScan = useCallback(
    async (options: {
      readonly append: boolean
      readonly rescan: boolean
      readonly afterExpiry?: boolean
    }) => {
      if (
        scanInFlightRef.current ||
        (importInFlightRef.current && !options.afterExpiry)
      )
        return
      scanInFlightRef.current = true
      const generation = ++scanGenerationRef.current
      scanAbortRef.current?.abort()
      const abort = new AbortController()
      scanAbortRef.current = abort
      // Capture UI intent before Query replaces IDs or appends another page.
      updateSelection((current) =>
        reconcilePreviousConversationSelection(
          current,
          candidates,
          maximumImportSelection,
        ),
      )
      setScanNotice('')
      if (!options.append) {
        setManualScanState('scanning')
        setActivity(new Map())
      }

      try {
        if (options.append) {
          const result = await discoveryQuery.fetchNextPage({
            cancelRefetch: false,
          })
          if (result.isError) throw result.error
        } else {
          await queryClient.cancelQueries({ queryKey, exact: true })
          if (abort.signal.aborted || generation !== scanGenerationRef.current)
            return
          const response = await runtime.discoverProviderSessions(
            projectId,
            machineId,
            {
              limit: 50,
              ...(options.rescan ? { rescan: true } : {}),
              signal: abort.signal,
            },
          )
          if (abort.signal.aborted || generation !== scanGenerationRef.current)
            return
          queryClient.setQueryData<
            InfiniteData<
              DiscoverProviderSessionsResponse,
              DiscoverProviderSessionsResponse['nextCursor']
            >
          >(queryKey, { pages: [response], pageParams: [undefined] })
        }
        if (abort.signal.aborted || generation !== scanGenerationRef.current)
          return
        setManualScanState('idle')
        if (options.afterExpiry) {
          setScanNotice('列表已更新，请检查所选会话后再导入。')
        }
        if (options.rescan) {
          globalThis.setTimeout(() => {
            if (generation === scanGenerationRef.current)
              stepRef.current?.focus()
          }, 0)
        }
      } catch (error) {
        if (abort.signal.aborted || isAbortError(error)) return
        if (generation !== scanGenerationRef.current) return
        setManualScanState('failed')
      } finally {
        if (scanAbortRef.current === abort) {
          scanAbortRef.current = undefined
          scanInFlightRef.current = false
        }
      }
    },
    [
      candidates,
      discoveryQuery,
      machineId,
      projectId,
      queryClient,
      queryKey,
      runtime,
      updateSelection,
    ],
  )

  useEffect(() => {
    const start =
      presentation === 'embedded'
        ? undefined
        : globalThis.setTimeout(() => stepRef.current?.focus(), 0)
    return () => {
      if (start !== undefined) globalThis.clearTimeout(start)
      lifecycleGenerationRef.current += 1
      scanGenerationRef.current += 1
      scanAbortRef.current?.abort()
    }
  }, [machineId, projectId, presentation])

  async function importSelected() {
    if (
      importInFlightRef.current ||
      scanInFlightRef.current ||
      discoveryQuery.isFetching ||
      scanState !== 'ready' ||
      selected.size === 0 ||
      selected.size > maximumImportSelection
    ) {
      return
    }
    importInFlightRef.current = true
    setImporting(true)
    const generation = scanGenerationRef.current
    const lifecycleGeneration = lifecycleGenerationRef.current
    updateSelection(() => currentSelection)
    let refreshExpired = false
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
          if (generation !== scanGenerationRef.current) return
          updateSelection((current) =>
            setPreviousConversationSelection(
              current,
              candidates,
              [candidate.discoveryCandidateId],
              false,
              maximumImportSelection,
            ),
          )
          queryClient.setQueryData<
            InfiniteData<
              DiscoverProviderSessionsResponse,
              DiscoverProviderSessionsResponse['nextCursor']
            >
          >(queryKey, (current) =>
            current === undefined
              ? undefined
              : {
                  ...current,
                  pages: current.pages.map((page) => ({
                    ...page,
                    candidates: page.candidates.map((entry) =>
                      entry.discoveryCandidateId ===
                      candidate.discoveryCandidateId
                        ? {
                            ...entry,
                            alreadyAdopted: true,
                            conversationId:
                              response.data.conversation.conversationId,
                          }
                        : entry,
                    ),
                  })),
                },
          )
          setCandidateActivity(candidate.discoveryCandidateId, 'idle')
          completed += 1
        } catch (error) {
          if (generation !== scanGenerationRef.current) return
          const expired = isCandidateExpired(error)
          setCandidateActivity(
            candidate.discoveryCandidateId,
            expired ? 'expired' : 'failed',
          )
          if (expired) {
            // Keep UI intent and stop this stale batch. One metadata-only read
            // follows; importing again always needs another explicit action.
            refreshExpired = true
            break
          }
          updateSelection((current) =>
            setPreviousConversationSelection(
              current,
              candidates,
              [candidate.discoveryCandidateId],
              false,
              maximumImportSelection,
            ),
          )
        }
      }
      if (completed > 0) setImportedCount((current) => current + completed)
      if (refreshExpired && generation === scanGenerationRef.current) {
        await runScan({ append: false, rescan: true, afterExpiry: true })
      }
    } finally {
      importInFlightRef.current = false
      if (lifecycleGeneration === lifecycleGenerationRef.current) {
        setImporting(false)
        globalThis.setTimeout(() => {
          if (lifecycleGeneration === lifecycleGenerationRef.current)
            stepRef.current?.focus()
        }, 0)
      }
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
    if (importInFlightRef.current) return
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

  return {
    stepRef,
    scanState,
    importing,
    presentation,
    candidates,
    importedCount,
    hasSupportedProvider,
    scanNotice,
    runScan,
    providerProblems,
    grouped,
    selectable,
    selectionBatchFull,
    toggleAllVisible,
    selectionId,
    activity,
    selected,
    toggleCandidate,
    openConversation,
    nextCursor,
    importSelected,
    onFinished,
  }
}
