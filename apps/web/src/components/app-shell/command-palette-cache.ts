import type { QueryClient } from '@tanstack/react-query'
import type {
  ConversationSummary,
  GetConversationResponse,
  GetMachineResponse,
  MachineSummary,
  ProjectRecord,
} from '@codetether/protocol'
import { conversationDetailQueryKeys } from '../../runtime/host/conversation-detail-query.js'
import { conversationListQueryKeys } from '../../runtime/host/conversation-list-query.js'
import { machineQueryKeys } from '../../runtime/host/machine-query.js'
import { projectQueryKeys } from '../../runtime/host/project-query.js'
import type { PaletteSnapshot } from './command-palette-model.js'

/** Read only known, validated cache shapes. This module never fetches or installs cache records. */
export function readCommandPaletteCache(client: QueryClient): PaletteSnapshot {
  const cache = client.getQueryCache()
  const machines = new Map(
    (
      client.getQueryData<readonly MachineSummary[]>(machineQueryKeys.list) ??
      []
    ).map((machine) => [machine.machineId, machine]),
  )
  for (const query of cache.findAll({
    queryKey: [...machineQueryKeys.all, 'detail'],
  })) {
    const data = query.state.data as GetMachineResponse | undefined
    if (data !== undefined && !machines.has(data.machine.machineId))
      machines.set(data.machine.machineId, data.machine)
  }
  const projects = new Map(
    (
      client.getQueryData<readonly ProjectRecord[]>(projectQueryKeys.list) ?? []
    ).map((project) => [project.projectId, project]),
  )
  for (const query of cache.findAll({
    queryKey: [...machineQueryKeys.all, 'detail'],
  })) {
    const data = query.state.data as GetMachineResponse | undefined
    for (const project of data?.projects ?? [])
      if (!projects.has(project.projectId))
        projects.set(project.projectId, project)
  }
  for (const query of cache.findAll({
    queryKey: [...projectQueryKeys.all, 'detail'],
  })) {
    const project = query.state.data as ProjectRecord | undefined
    if (project !== undefined && !projects.has(project.projectId))
      projects.set(project.projectId, project)
  }
  const conversations = cache
    .findAll({ queryKey: conversationListQueryKeys.all })
    .flatMap((query) =>
      query.state.data === undefined
        ? []
        : [
            {
              records: query.state.data as readonly ConversationSummary[],
              observedAt: query.state.dataUpdatedAt,
            },
          ],
    )
  for (const query of cache.findAll({
    queryKey: conversationDetailQueryKeys.all,
  })) {
    const data = query.state.data as GetConversationResponse | undefined
    if (data !== undefined)
      conversations.push({
        records: [data.conversation],
        observedAt: query.state.dataUpdatedAt,
      })
  }
  return {
    machines: [...machines.values()],
    projects: [...projects.values()],
    conversations,
  }
}

/** Stable scalar snapshots also detect changes between render and subscription. */
export function commandPaletteCacheSubscription(client: QueryClient) {
  const metadataKey = (key: readonly unknown[]) =>
    key[0] === 'host' &&
    [
      'machines',
      'projects',
      'project-conversations',
      'conversation-detail',
    ].includes(String(key[1]))
  return {
    getSnapshot: () =>
      client
        .getQueryCache()
        .getAll()
        .filter((query) => metadataKey(query.queryKey))
        .map(
          (query) =>
            query.queryHash +
            ':' +
            query.state.dataUpdateCount +
            ':' +
            query.state.dataUpdatedAt,
        )
        .join('|'),
    subscribe: (listener: () => void) => {
      let active = true
      let pending = false
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (
          metadataKey(event.query.queryKey) &&
          (event.type === 'added' ||
            event.type === 'removed' ||
            event.type === 'updated')
        ) {
          // Query creation can occur during another component's render.
          // Defer and coalesce presentation notifications, not cache writes.
          if (pending) return
          pending = true
          queueMicrotask(() => {
            pending = false
            if (active) listener()
          })
        }
      })
      return () => {
        active = false
        unsubscribe()
      }
    },
  }
}
