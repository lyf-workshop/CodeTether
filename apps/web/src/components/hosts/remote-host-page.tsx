import { useState, type ReactNode } from 'react'
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

import {
  currentRemoteSupervisorSession,
  readRemoteConversation,
  readRemoteConversations,
  readRemoteMachine,
  readRemoteProject,
  readRemoteProjects,
  type RemoteConversationDirectoryItem,
} from '../../runtime/account/remote-supervisor.js'

const DIRECTORY_PAGE_SIZE = 25

export function RemoteHostPage() {
  const { hostId } = useParams({ from: '/hosts/$hostId' })
  const session = currentRemoteSupervisorSession(hostId)
  const [selectedMachineId, setSelectedMachineId] = useState<string>()
  const [selectedProjectId, setSelectedProjectId] = useState<string>()
  const [selectedConversationId, setSelectedConversationId] = useState<string>()
  const machines = session === undefined ? [] : machineRows(session.machines)
  const validationMode =
    import.meta.env.VITE_CODETETHER_VALIDATE_REMOTE_DIRECTORY_HOST_ID === hostId
  const activeMachineId =
    selectedMachineId ?? (validationMode ? machines[0]?.machineId : undefined)
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
    (validationMode ? projectRows[0]?.projectId : undefined)
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
    (validationMode ? conversationRows[0]?.conversationId : undefined)
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
        <ConversationMetadata conversation={conversationDetail.data} />
      )}

      <p className="mt-5 inline-flex items-center gap-2 text-xs text-text-muted">
        <Server aria-hidden="true" /> Directory reads do not load transcripts,
        start Providers, send messages, resume sessions, or expose filesystem
        actions.
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

function ConversationMetadata({
  conversation,
}: {
  readonly conversation: RemoteConversationDirectoryItem
}) {
  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Conversation metadata
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
      <p className="mt-4 text-xs text-text-muted">
        Transcript and live Provider hydration are intentionally unavailable in
        this read-only phase.
      </p>
    </section>
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
