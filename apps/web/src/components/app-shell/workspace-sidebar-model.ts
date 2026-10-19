import type {
  ConversationStatus,
  ConversationSummary,
  MachineId,
  MachineSummary,
  ProjectId,
  ProjectLocation,
  ProjectRecord,
  ProviderId,
} from '@codetether/protocol'

export const workspaceSidebarRecentConversationLimit = 4

export interface WorkspaceProviderPresentation {
  readonly icon: 'bot' | 'sparkles'
  readonly label: 'Codex' | 'Claude Code'
  readonly tone: 'codex' | 'claude'
}

export function workspaceProviderPresentation(
  provider: ProviderId,
): WorkspaceProviderPresentation {
  return provider === 'codex'
    ? { icon: 'bot', label: 'Codex', tone: 'codex' }
    : { icon: 'sparkles', label: 'Claude Code', tone: 'claude' }
}

export function activeWorkspaceConversations(
  conversations: readonly ConversationSummary[],
): readonly ConversationSummary[] {
  return conversations.filter(
    (conversation) => conversation.archivedAt === undefined,
  )
}

export function visibleWorkspaceConversations(
  conversations: readonly ConversationSummary[],
  showAll: boolean,
): readonly ConversationSummary[] {
  const active = activeWorkspaceConversations(conversations)
  return showAll
    ? active
    : active.slice(0, workspaceSidebarRecentConversationLimit)
}

export function hasMoreWorkspaceConversations(
  conversations: readonly ConversationSummary[],
): boolean {
  return (
    activeWorkspaceConversations(conversations).length >
    workspaceSidebarRecentConversationLimit
  )
}

export function workspaceConversationStatusLabel(
  status: ConversationStatus,
): string | undefined {
  switch (status) {
    case 'running':
      return '运行中'
    case 'waiting':
      return '等待批准'
    case 'failed':
      return '失败'
    case 'idle':
    case 'completed':
      return undefined
  }
}

/** One UI entry for the exact durable Project/Machine association. */
export interface WorkspaceProjectEntry {
  readonly key: string
  readonly project: ProjectRecord
  readonly location: ProjectLocation
}

export interface WorkspaceDeviceGroup {
  readonly machine: MachineSummary
  readonly projects: readonly WorkspaceProjectEntry[]
}

export function workspaceProjectEntryKey(
  projectId: ProjectId,
  machineId: MachineId,
): string {
  return `${projectId}:${machineId}`
}

/** Derive presentation only; never manufacture a Machine or preferred Location. */
export function workspaceDeviceGroups(
  machines: readonly MachineSummary[],
  projects: readonly ProjectRecord[],
): readonly WorkspaceDeviceGroup[] {
  const sortedMachines = [...machines].sort(
    (left, right) =>
      Number(right.kind === 'local') - Number(left.kind === 'local'),
  )
  return sortedMachines.map((machine) => ({
    machine,
    projects: projects.flatMap((project) =>
      project.locations
        .filter(
          (location) =>
            location.machineId === machine.machineId &&
            location.projectId === project.projectId,
        )
        .map((location) => ({
          key: workspaceProjectEntryKey(project.projectId, machine.machineId),
          project,
          location,
        })),
    ),
  }))
}

export interface WorkspaceLocationConversations {
  readonly activeCount: number
  readonly hasMore: boolean
  readonly visible: readonly ConversationSummary[]
}

function compareWorkspaceConversations(
  left: ConversationSummary,
  right: ConversationSummary,
): number {
  const pinOrder = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '')
  if (pinOrder !== 0) return pinOrder
  const activityOrder = right.lastActivityAt.localeCompare(left.lastActivityAt)
  return (
    activityOrder || left.conversationId.localeCompare(right.conversationId)
  )
}

/** Four total, pins first, plus the exact current active/archived context. */
export function workspaceLocationConversations(
  conversations: readonly ConversationSummary[],
  projectId: ProjectId,
  machineId: MachineId,
  showAll: boolean,
  currentConversation?: ConversationSummary,
): WorkspaceLocationConversations {
  const belongs = (conversation: ConversationSummary) =>
    conversation.projectId === projectId && conversation.machineId === machineId
  const scoped = new Map(
    conversations
      .filter(belongs)
      .map((conversation) => [conversation.conversationId, conversation]),
  )
  const current =
    currentConversation !== undefined && belongs(currentConversation)
      ? currentConversation
      : undefined
  if (current !== undefined) scoped.set(current.conversationId, current)
  const active = activeWorkspaceConversations([...scoped.values()]).toSorted(
    compareWorkspaceConversations,
  )
  const visible = showAll
    ? [...active]
    : active.slice(0, workspaceSidebarRecentConversationLimit)
  if (
    current !== undefined &&
    !visible.some(
      (conversation) => conversation.conversationId === current.conversationId,
    )
  ) {
    visible.push(current)
  }
  return {
    activeCount: active.length,
    hasMore: active.length > workspaceSidebarRecentConversationLimit,
    visible,
  }
}

/** IDs only: all Devices start open, Projects open through user/navigation intent. */
export interface WorkspaceTreeExpansion {
  readonly collapsedMachineIds: ReadonlySet<MachineId>
  readonly expandedProjectKeys: ReadonlySet<string>
  readonly revealedContext?: string
}

export function emptyWorkspaceTreeExpansion(): WorkspaceTreeExpansion {
  return {
    collapsedMachineIds: new Set(),
    expandedProjectKeys: new Set(),
  }
}

/** Reveal only when navigation context changes, so a user may collapse it afterward. */
export function revealWorkspacePath(
  expansion: WorkspaceTreeExpansion,
  machineId?: MachineId,
  projectId?: ProjectId,
): WorkspaceTreeExpansion {
  const context = `${machineId ?? ''}:${projectId ?? ''}`
  if (expansion.revealedContext === context) return expansion
  const collapsedMachineIds = new Set(expansion.collapsedMachineIds)
  const expandedProjectKeys = new Set(expansion.expandedProjectKeys)
  if (machineId !== undefined) {
    collapsedMachineIds.delete(machineId)
    if (projectId !== undefined) {
      expandedProjectKeys.add(workspaceProjectEntryKey(projectId, machineId))
    }
  }
  return { collapsedMachineIds, expandedProjectKeys, revealedContext: context }
}

export function toggleWorkspaceMachine(
  expansion: WorkspaceTreeExpansion,
  machineId: MachineId,
): WorkspaceTreeExpansion {
  const collapsedMachineIds = new Set(expansion.collapsedMachineIds)
  if (collapsedMachineIds.has(machineId)) collapsedMachineIds.delete(machineId)
  else collapsedMachineIds.add(machineId)
  return { ...expansion, collapsedMachineIds }
}

export function toggleWorkspaceProject(
  expansion: WorkspaceTreeExpansion,
  entryKey: string,
): WorkspaceTreeExpansion {
  const expandedProjectKeys = new Set(expansion.expandedProjectKeys)
  if (expandedProjectKeys.has(entryKey)) expandedProjectKeys.delete(entryKey)
  else expandedProjectKeys.add(entryKey)
  return { ...expansion, expandedProjectKeys }
}
