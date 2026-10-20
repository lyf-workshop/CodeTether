import {
  ConversationSearchQueryTextSchema,
  ConversationStatusSchema,
  MachineIdSchema,
  ProviderIdSchema,
  type ConversationSearchResult,
  type ConversationStatus,
  type ConversationSummary,
  type MachineId,
  type ProjectRecord,
  type ProviderId,
} from '@codetether/protocol'

export interface ProjectWorkspaceSearch {
  machineId?: MachineId
  invalidMachineId?: true
  q?: string
  view?: 'archived'
  provider?: ProviderId
  status?: ConversationStatus
}

export function parseProjectWorkspaceSearch(
  search: Record<string, unknown>,
): ProjectWorkspaceSearch {
  const machine = MachineIdSchema.safeParse(search.machineId)
  const query = ConversationSearchQueryTextSchema.safeParse(search.q)
  const provider = ProviderIdSchema.safeParse(search.provider)
  const status = ConversationStatusSchema.safeParse(search.status)
  return {
    ...(machine.success
      ? { machineId: machine.data }
      : search.machineId === undefined && search.invalidMachineId !== true
        ? {}
        : { invalidMachineId: true as const }),
    ...(query.success ? { q: query.data } : {}),
    ...(search.view === 'archived' ? { view: 'archived' as const } : {}),
    ...(provider.success ? { provider: provider.data } : {}),
    ...(status.success ? { status: status.data } : {}),
  }
}

export type ProjectWorkspaceContext =
  | { kind: 'selected'; location: ProjectRecord['locations'][number] }
  | { kind: 'choose-device' }
  | { kind: 'invalid-device' }
  | { kind: 'missing-location' }

export function resolveProjectWorkspaceContext(
  project: Pick<ProjectRecord, 'locations'>,
  machineId?: MachineId,
  invalidMachineId = false,
): ProjectWorkspaceContext {
  if (invalidMachineId) return { kind: 'invalid-device' }
  if (machineId !== undefined) {
    const location = project.locations.find(
      (candidate) => candidate.machineId === machineId,
    )
    return location
      ? { kind: 'selected', location }
      : { kind: 'invalid-device' }
  }
  if (project.locations.length === 0) return { kind: 'missing-location' }
  if (project.locations.length !== 1) return { kind: 'choose-device' }
  return { kind: 'selected', location: project.locations[0]! }
}

export function filterProjectLocationConversations(
  conversations: readonly ConversationSummary[],
  machineId: MachineId,
) {
  return conversations.filter(
    (conversation) => conversation.machineId === machineId,
  )
}

export function filterProjectLocationSearchResults(
  results: readonly ConversationSearchResult[],
  machineId: MachineId,
) {
  return results.filter((result) => result.conversation.machineId === machineId)
}

export function projectRemovalPreflight(
  conversations: readonly Pick<ConversationSummary, 'archivedAt'>[] | undefined,
):
  | { kind: 'unknown' }
  | { kind: 'clear' }
  | { kind: 'blocked'; count: number; archivedCount: number; capped: boolean } {
  if (conversations === undefined) return { kind: 'unknown' }
  if (conversations.length === 0) return { kind: 'clear' }
  return {
    kind: 'blocked',
    count: conversations.length,
    archivedCount: conversations.filter(
      (conversation) => conversation.archivedAt !== undefined,
    ).length,
    capped: conversations.length >= 100,
  }
}
