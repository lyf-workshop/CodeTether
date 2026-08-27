import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type {
  GetProjectResponse,
  ListProjectsResponse,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

export interface ProjectReadClient {
  listProjects(options?: {
    readonly signal?: AbortSignal
  }): Promise<ListProjectsResponse>
  getProject(
    projectId: ProjectId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetProjectResponse>
}

export const projectQueryKeys = {
  all: ['host', 'projects'] as const,
  list: ['host', 'projects', 'list'] as const,
  detail: (projectId: ProjectId) =>
    ['host', 'projects', 'detail', projectId] as const,
}

export function projectListQueryOptions(client: ProjectReadClient) {
  return queryOptions({
    queryKey: projectQueryKeys.list,
    queryFn: async ({ signal }) =>
      (await client.listProjects({ signal })).projects,
    retry: false,
    staleTime: 0,
  })
}

export function projectDetailQueryOptions(
  client: ProjectReadClient,
  projectId: ProjectId,
) {
  return queryOptions({
    queryKey: projectQueryKeys.detail(projectId),
    queryFn: async ({ signal }) =>
      (await client.getProject(projectId, { signal })).project,
    retry: false,
    staleTime: 0,
  })
}

/** Installs one authoritative mutation response without duplicating a Project. */
export function upsertProjectCache(
  queryClient: QueryClient,
  project: ProjectRecord,
): void {
  queryClient.setQueryData<readonly ProjectRecord[]>(
    projectQueryKeys.list,
    (current) => {
      if (current === undefined) return [project]
      const index = current.findIndex(
        (candidate) => candidate.projectId === project.projectId,
      )
      if (index === -1) return [project, ...current]
      return current.map((candidate, candidateIndex) =>
        candidateIndex === index ? project : candidate,
      )
    },
  )
  queryClient.setQueryData(projectQueryKeys.detail(project.projectId), project)
}

/** Removes only client cache records after the Host confirms registration removal. */
export function removeProjectCache(
  queryClient: QueryClient,
  projectId: ProjectId,
): void {
  queryClient.setQueryData<readonly ProjectRecord[]>(
    projectQueryKeys.list,
    (current) => current?.filter((project) => project.projectId !== projectId),
  )
  queryClient.removeQueries({
    queryKey: projectQueryKeys.detail(projectId),
    exact: true,
  })
}

export async function invalidateProjectQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all })
}
