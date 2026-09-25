import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ChevronRight,
  FolderKanban,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Server,
} from 'lucide-react'

import { Badge, Button } from '@codetether/ui'
import type { RemoteConversationHistoryPage } from '@codetether/protocol'

import {
  currentRemoteSupervisorSession,
  reconnectRemoteSupervisor,
  readRemoteConversation,
  readRemoteConversationHistory,
  readRemoteConversationLive,
  readRemoteConversations,
  readRemoteMachine,
  readRemoteProject,
  readRemoteProjects,
  type RemoteConversationDirectoryItem,
} from '../../runtime/account/remote-supervisor.js'
import {
  applyRemoteConversationLiveEvents,
  flattenRemoteConversationHistory,
  mergeRemoteTranscriptEntries,
  type RemoteLiveTranscriptState,
  type RemoteTranscriptEntry,
} from '../../runtime/account/remote-conversation-read-model.js'

const DIRECTORY_PAGE_SIZE = 25
const HISTORY_PAGE_SIZE = 20

export function RemoteHostPage() {
  const { hostId } = useParams({ from: '/hosts/$hostId' })
  const session = currentRemoteSupervisorSession(hostId)
  const [selectedMachineId, setSelectedMachineId] = useState<string>()
  const [selectedProjectId, setSelectedProjectId] = useState<string>()
  const [selectedConversationId, setSelectedConversationId] = useState<string>()
  const machines = session === undefined ? [] : machineRows(session.machines)
  const validationMode =
    import.meta.env.VITE_CODETETHER_VALIDATE_REMOTE_DIRECTORY_HOST_ID === hostId
  const validationMachineId = import.meta.env
    .VITE_CODETETHER_VALIDATE_REMOTE_CONVERSATION_MACHINE_ID
  const validationProjectId = import.meta.env
    .VITE_CODETETHER_VALIDATE_REMOTE_CONVERSATION_PROJECT_ID
  const validationConversationId = import.meta.env
    .VITE_CODETETHER_VALIDATE_REMOTE_CONVERSATION_ID
  const activeMachineId =
    selectedMachineId ??
    (validationMode
      ? (validationMachineId ?? machines[0]?.machineId)
      : undefined)
  const detail = useQuery({
    queryKey: ['remote-supervisor', hostId, 'machine', activeMachineId],
    queryFn: async () =>
      await readRemoteMachine(hostId, activeMachineId as string),
    enabled: session !== undefined && activeMachineId !== undefined,
    retry: false,
  })
  const projects = useInfiniteQuery({
    queryKey: ['remote-supervisor', hostId, 'projects', activeMachineId],
    queryFn: async ({ pageParam }) =>
      await readRemoteProjects(hostId, activeMachineId as string, {
        limit: DIRECTORY_PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled:
      session !== undefined &&
      activeMachineId !== undefined &&
      detail.isSuccess,
    retry: false,
  })
  const projectRows =
    projects.data?.pages.flatMap((page) => page.projects) ?? []
  const activeProjectId =
    selectedProjectId ??
    (validationMode
      ? (validationProjectId ?? projectRows[0]?.projectId)
      : undefined)
  const projectDetail = useQuery({
    queryKey: [
      'remote-supervisor',
      hostId,
      'project',
      activeMachineId,
      activeProjectId,
    ],
    queryFn: async () =>
      await readRemoteProject(
        hostId,
        activeMachineId as string,
        activeProjectId as string,
      ),
    enabled:
      session !== undefined &&
      activeMachineId !== undefined &&
      activeProjectId !== undefined,
    retry: false,
  })
  const conversations = useInfiniteQuery({
    queryKey: [
      'remote-supervisor',
      hostId,
      'conversations',
      activeMachineId,
      activeProjectId,
    ],
    queryFn: async ({ pageParam }) =>
      await readRemoteConversations(
        hostId,
        activeMachineId as string,
        activeProjectId as string,
        {
          limit: DIRECTORY_PAGE_SIZE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: projectDetail.isSuccess,
    retry: false,
  })
  const conversationRows =
    conversations.data?.pages.flatMap((page) => page.conversations) ?? []
  const activeConversationId =
    selectedConversationId ??
    (validationMode
      ? (validationConversationId ?? conversationRows[0]?.conversationId)
      : undefined)
  const conversationDetail = useQuery({
    queryKey: [
      'remote-supervisor',
      hostId,
      'conversation',
      activeMachineId,
      activeProjectId,
      activeConversationId,
    ],
    queryFn: async () =>
      await readRemoteConversation(
        hostId,
        activeMachineId as string,
        activeProjectId as string,
        activeConversationId as string,
      ),
    enabled: projectDetail.isSuccess && activeConversationId !== undefined,
    retry: false,
  })
  const history = useInfiniteQuery({
    queryKey: [
      'remote-supervisor',
      hostId,
      'conversation-history',
      activeMachineId,
      activeProjectId,
      activeConversationId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      await readRemoteConversationHistory(
        hostId,
        activeMachineId as string,
        activeProjectId as string,
        activeConversationId as string,
        {
          limit: HISTORY_PAGE_SIZE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.beforeCursor,
    enabled: conversationDetail.isSuccess,
    retry: false,
  })

  const providers = detail.data === undefined ? [] : providerRows(detail.data)

  if (session === undefined) return <DisconnectedHost />

  return (
    <main className="px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Read-only remote Supervisor
          </p>
          <h1 className="mt-1 text-page font-semibold text-text-primary">
            Host {hostId.slice(-12)}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Exact Host identity verified over {session.transport} transport.
          </p>
        </div>
        <Badge variant="success">Online</Badge>
      </header>

      <section className="mt-8 grid gap-4 xl:grid-cols-3">
        <DirectoryPanel title="Machines">
          {machines.length === 0 ? (
            <EmptyText>No Machines are registered on this Host.</EmptyText>
          ) : (
            machines.map((machine) => (
              <DirectoryButton
                key={machine.machineId}
                selected={machine.machineId === activeMachineId}
                icon={<Monitor aria-hidden="true" />}
                title={machine.displayName}
                detail={`${machine.platform} · ${machine.architecture}`}
                onClick={() => {
                  setSelectedMachineId(machine.machineId)
                  setSelectedProjectId(undefined)
                  setSelectedConversationId(undefined)
                }}
              />
            ))
          )}
        </DirectoryPanel>

        <DirectoryPanel title="Projects">
          {activeMachineId === undefined ? (
            <EmptyText>Select a Machine to browse its Projects.</EmptyText>
          ) : detail.isPending || projects.isPending ? (
            <LoadingText label="Loading Projects…" />
          ) : detail.isError || projects.isError ? (
            <ErrorText label="Projects could not be read. Reconnect from My Hosts." />
          ) : projectRows.length === 0 ? (
            <EmptyText>This Machine has no registered Projects.</EmptyText>
          ) : (
            <>
              {projectRows.map((project) => (
                <DirectoryButton
                  key={project.projectId}
                  selected={project.projectId === activeProjectId}
                  icon={<FolderKanban aria-hidden="true" />}
                  title={project.name}
                  detail={`${String(project.conversationCount)} Conversations · ${formatActivity(project.updatedAt)}`}
                  onClick={() => {
                    setSelectedProjectId(project.projectId)
                    setSelectedConversationId(undefined)
                  }}
                />
              ))}
              {projects.hasNextPage ? (
                <Button
                  className="mt-2 w-full"
                  variant="secondary"
                  size="sm"
                  disabled={projects.isFetchingNextPage}
                  onClick={() => void projects.fetchNextPage()}
                >
                  {projects.isFetchingNextPage
                    ? 'Loading…'
                    : 'Load more Projects'}
                </Button>
              ) : null}
            </>
          )}
        </DirectoryPanel>

        <DirectoryPanel title="Conversations">
          {activeProjectId === undefined ? (
            <EmptyText>Select a Project to browse its Conversations.</EmptyText>
          ) : projectDetail.isPending || conversations.isPending ? (
            <LoadingText label="Loading Conversations…" />
          ) : projectDetail.isError || conversations.isError ? (
            <ErrorText label="Conversations could not be read. The Project may no longer exist." />
          ) : conversationRows.length === 0 ? (
            <EmptyText>
              This Project has no Conversations on this Machine.
            </EmptyText>
          ) : (
            <>
              {conversationRows.map((conversation) => (
                <DirectoryButton
                  key={conversation.conversationId}
                  selected={
                    conversation.conversationId === activeConversationId
                  }
                  icon={<MessageSquare aria-hidden="true" />}
                  title={conversation.title}
                  detail={`${providerLabel(conversation.provider)} · ${formatActivity(conversation.lastActivityAt)}`}
                  onClick={() =>
                    setSelectedConversationId(conversation.conversationId)
                  }
                />
              ))}
              {conversations.hasNextPage ? (
                <Button
                  className="mt-2 w-full"
                  variant="secondary"
                  size="sm"
                  disabled={conversations.isFetchingNextPage}
                  onClick={() => void conversations.fetchNextPage()}
                >
                  {conversations.isFetchingNextPage
                    ? 'Loading…'
                    : 'Load more Conversations'}
                </Button>
              ) : null}
            </>
          )}
        </DirectoryPanel>
      </section>

      {activeMachineId !== undefined && detail.isSuccess ? (
        <section className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">
            Provider availability
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {providers.map((provider) => (
              <div
                key={provider.provider}
                className="flex items-center justify-between rounded-md border border-border px-3 py-3"
              >
                <span className="text-sm font-medium text-text-primary">
                  {providerLabel(provider.provider)}
                </span>
                <span className="text-xs text-text-secondary">
                  {provider.availability}
                  {provider.version === undefined
                    ? ''
                    : ` · ${provider.version}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {conversationDetail.isPending ? (
        <LoadingText label="Loading Conversation metadata…" />
      ) : conversationDetail.isError ? (
        <ErrorText label="Conversation metadata is stale or unavailable." />
      ) : conversationDetail.data === undefined ? null : (
        <RemoteConversationReadView
          key={conversationDetail.data.conversationId}
          hostId={hostId}
          machineId={activeMachineId as string}
          projectId={activeProjectId as string}
          conversation={conversationDetail.data}
          history={history}
          validationMode={validationMode}
        />
      )}

      <p className="mt-5 inline-flex items-center gap-2 text-xs text-text-muted">
        <Server aria-hidden="true" /> Transcript reads do not start Providers,
        send messages, resume sessions, or expose write actions.
      </p>
    </main>
  )
}

function DisconnectedHost() {
  return (
    <main className="px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <h1 className="text-page font-semibold text-text-primary">
        Remote Host disconnected
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Return to My Hosts to establish a fresh authorized read session.
      </p>
      <Button asChild className="mt-5" size="sm">
        <Link to="/hosts">My Hosts</Link>
      </Button>
    </main>
  )
}

function DirectoryPanel({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold text-text-primary">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  )
}

function DirectoryButton({
  icon,
  title,
  detail,
  selected,
  onClick,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly detail: string
  readonly selected: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left hover:bg-surface-inset ${
        selected ? 'border-accent bg-surface-inset' : 'border-border'
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {title}
        </span>
        <span className="block truncate text-xs text-text-muted">{detail}</span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  )
}

function RemoteConversationReadView({
  hostId,
  machineId,
  projectId,
  conversation,
  history,
  validationMode,
}: {
  readonly hostId: string
  readonly machineId: string
  readonly projectId: string
  readonly conversation: RemoteConversationDirectoryItem
  readonly validationMode: boolean
  readonly history: {
    readonly data?: { readonly pages: readonly RemoteConversationHistoryPage[] }
    readonly isPending: boolean
    readonly isError: boolean
    readonly isFetchingNextPage: boolean
    readonly hasNextPage: boolean
    readonly fetchNextPage: () => Promise<unknown>
    readonly refetch: () => Promise<unknown>
  }
}) {
  const historyPages = history.data?.pages
  const historical = useMemo(
    () => flattenRemoteConversationHistory(historyPages),
    [historyPages],
  )
  const [live, setLive] = useState<RemoteLiveTranscriptState>({
    entries: [],
    eventIds: new Set(),
  })
  const [liveState, setLiveState] = useState<
    'idle' | 'connecting' | 'live' | 'disconnected'
  >(() =>
    conversation.status === 'running' || conversation.status === 'waiting'
      ? 'connecting'
      : 'idle',
  )
  const initialPage = historyPages?.[0]
  const initialLiveCursor = initialPage?.liveCursor
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchHistory,
  } = history

  useEffect(() => {
    if (!validationMode || !hasNextPage || isFetchingNextPage) {
      return
    }
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, validationMode])

  useEffect(() => {
    if (
      initialLiveCursor === undefined ||
      (conversation.status !== 'running' && conversation.status !== 'waiting')
    ) {
      return
    }
    const abort = new AbortController()
    let cursor = initialLiveCursor
    let active = true
    let reconnectAvailable = true
    const observe = async (): Promise<void> => {
      while (!abort.signal.aborted && active) {
        try {
          const page = await readRemoteConversationLive(
            hostId,
            machineId,
            projectId,
            conversation.conversationId,
            { cursor, waitMs: 10_000 },
            abort.signal,
          )
          if (page.resetRequired) {
            setLive({ entries: [], eventIds: new Set() })
            const refreshed = await readRemoteConversationHistory(
              hostId,
              machineId,
              projectId,
              conversation.conversationId,
              { limit: HISTORY_PAGE_SIZE },
              abort.signal,
            )
            cursor = refreshed.liveCursor
            await refetchHistory()
            continue
          }
          cursor = page.cursor
          if (page.events.length > 0) {
            setLive((current) =>
              applyRemoteConversationLiveEvents(current, page.events),
            )
          }
          setLiveState(page.active ? 'live' : 'idle')
          active = page.active
        } catch {
          if (abort.signal.aborted) {
            active = false
            continue
          }
          if (reconnectAvailable) {
            reconnectAvailable = false
            setLiveState('connecting')
            try {
              await reconnectRemoteSupervisor(hostId, abort.signal)
              const refreshed = await readRemoteConversationHistory(
                hostId,
                machineId,
                projectId,
                conversation.conversationId,
                { limit: HISTORY_PAGE_SIZE },
                abort.signal,
              )
              cursor = refreshed.liveCursor
              setLive({ entries: [], eventIds: new Set() })
              await refetchHistory()
              continue
            } catch {
              // The bounded fresh-authentication attempt failed below.
            }
          }
          setLiveState('disconnected')
          active = false
        }
      }
    }
    void observe()
    return () => abort.abort()
  }, [
    conversation.conversationId,
    conversation.status,
    hostId,
    initialLiveCursor,
    machineId,
    projectId,
    refetchHistory,
  ])

  const entries = useMemo(
    () => mergeRemoteTranscriptEntries(historical, live.entries),
    [historical, live.entries],
  )
  const lastPage = historyPages?.at(-1)
  const historyComplete =
    lastPage?.historyComplete === true && history.hasNextPage !== true

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Remote read-only Conversation
          </p>
          <h2 className="mt-1 font-semibold text-text-primary">
            {conversation.title}
          </h2>
        </div>
        <Badge variant="outline">{conversation.status}</Badge>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Metadata
          label="Provider"
          value={providerLabel(conversation.provider)}
        />
        <Metadata
          label="Last activity"
          value={formatActivity(conversation.lastActivityAt)}
        />
        <Metadata
          label="Native session"
          value={
            conversation.resumability === 'resumable'
              ? 'Resumable'
              : 'Unavailable'
          }
        />
      </dl>
      {history.isPending ? (
        <LoadingText label="Loading latest transcript…" />
      ) : history.isError ? (
        <ErrorText label="Transcript could not be read from the Host." />
      ) : (
        <RemoteTranscript
          entries={entries}
          historyComplete={historyComplete}
          partial={
            lastPage !== undefined &&
            !lastPage.historyComplete &&
            lastPage.beforeCursor === undefined
          }
          loadingEarlier={history.isFetchingNextPage}
          loadEarlier={
            history.hasNextPage
              ? async () => await history.fetchNextPage()
              : undefined
          }
          liveState={liveState}
        />
      )}
    </section>
  )
}

function RemoteTranscript({
  entries,
  historyComplete,
  partial,
  loadingEarlier,
  loadEarlier,
  liveState,
}: {
  readonly entries: readonly RemoteTranscriptEntry[]
  readonly historyComplete: boolean
  readonly partial: boolean
  readonly loadingEarlier: boolean
  readonly loadEarlier?: () => Promise<unknown>
  readonly liveState: 'idle' | 'connecting' | 'live' | 'disconnected'
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const prependingEarlier = useRef(false)
  const [newOutput, setNewOutput] = useState(false)
  const previousCount = useRef(0)

  useEffect(() => {
    const element = viewport.current
    if (element === null || entries.length <= previousCount.current) {
      previousCount.current = entries.length
      return
    }
    previousCount.current = entries.length
    if (prependingEarlier.current) return
    if (followsLatest.current) {
      element.scrollTop = element.scrollHeight
      setNewOutput(false)
    } else {
      setNewOutput(true)
    }
  }, [entries.length])

  const earlier = async (): Promise<void> => {
    const element = viewport.current
    const previousHeight = element?.scrollHeight ?? 0
    const previousTop = element?.scrollTop ?? 0
    prependingEarlier.current = true
    try {
      await loadEarlier?.()
    } finally {
      requestAnimationFrame(() => {
        if (element !== null) {
          element.scrollTop =
            previousTop + element.scrollHeight - previousHeight
        }
        prependingEarlier.current = false
      })
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-text-muted">
          {historyComplete
            ? 'Beginning of available history reached'
            : partial
              ? 'Available history is partial'
              : 'Earlier history is available'}
        </div>
        {loadEarlier === undefined ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={loadingEarlier}
            onClick={() => void earlier()}
          >
            {loadingEarlier ? 'Loading earlier…' : 'Load earlier'}
          </Button>
        )}
      </div>
      <div
        ref={viewport}
        className="max-h-[36rem] space-y-3 overflow-y-auto rounded-md bg-surface-inset p-3"
        onScroll={(event) => {
          const element = event.currentTarget
          followsLatest.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80
          if (followsLatest.current) setNewOutput(false)
        }}
      >
        {entries.length === 0 ? (
          <EmptyText>No supported transcript entries are available.</EmptyText>
        ) : (
          entries.map((entry) => (
            <TranscriptEntry key={entry.id} entry={entry} />
          ))
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-text-muted">
        <span>
          {liveState === 'live'
            ? 'Observing the active Turn'
            : liveState === 'connecting'
              ? 'Connecting to live output…'
              : liveState === 'disconnected'
                ? 'Live output disconnected. Return to My Hosts to retry.'
                : 'No active Turn'}
        </span>
        {newOutput ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const element = viewport.current
              if (element !== null) element.scrollTop = element.scrollHeight
              followsLatest.current = true
              setNewOutput(false)
            }}
          >
            New output
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function TranscriptEntry({ entry }: { readonly entry: RemoteTranscriptEntry }) {
  const label =
    entry.role === 'user'
      ? 'You'
      : entry.role === 'assistant'
        ? 'Agent'
        : entry.role === 'tool'
          ? entry.kind === 'change'
            ? 'Change'
            : 'Tool'
          : 'Status'
  return (
    <article
      className={`rounded-md border px-3 py-2 ${
        entry.role === 'user'
          ? 'border-accent/30 bg-accent/5'
          : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
        <span className="font-medium">{label}</span>
        <span>
          {entry.timestamp === undefined ? '' : formatActivity(entry.timestamp)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-primary">
        {entry.content}
      </p>
    </article>
  )
}

function Metadata({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-text-primary">{value}</dd>
    </div>
  )
}

function EmptyText({ children }: { readonly children: ReactNode }) {
  return <p className="text-sm text-text-secondary">{children}</p>
}

function LoadingText({ label }: { readonly label: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
      <LoaderCircle aria-hidden="true" className="animate-spin" /> {label}
    </p>
  )
}

function ErrorText({ label }: { readonly label: string }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {label}
    </p>
  )
}

function providerLabel(provider: string): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function formatActivity(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function machineRows(value: unknown): readonly {
  readonly machineId: string
  readonly displayName: string
  readonly platform: string
  readonly architecture: string
}[] {
  const record = asRecord(value)
  if (!Array.isArray(record.machines)) return []
  return record.machines.flatMap((candidate) => {
    const machine = asRecord(candidate)
    return typeof machine.machineId === 'string' &&
      typeof machine.displayName === 'string' &&
      typeof machine.platform === 'string' &&
      typeof machine.architecture === 'string'
      ? [
          {
            machineId: machine.machineId,
            displayName: machine.displayName,
            platform: machine.platform,
            architecture: machine.architecture,
          },
        ]
      : []
  })
}

function providerRows(value: unknown): readonly {
  readonly provider: string
  readonly availability: string
  readonly version?: string
}[] {
  const record = asRecord(value)
  if (!Array.isArray(record.providers)) return []
  return record.providers.flatMap((candidate) => {
    const provider = asRecord(candidate)
    return typeof provider.provider === 'string' &&
      typeof provider.availability === 'string'
      ? [
          {
            provider: provider.provider,
            availability: provider.availability,
            ...(typeof provider.version === 'string'
              ? { version: provider.version }
              : {}),
          },
        ]
      : []
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
