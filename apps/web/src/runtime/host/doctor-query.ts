import { queryOptions } from '@tanstack/react-query'
import type {
  GetDoctorQuery,
  GetDoctorResponse,
  ProjectId,
} from '@codetether/protocol'

export interface DoctorReadClient {
  getDoctor(options?: {
    readonly projectId?: GetDoctorQuery['projectId']
    readonly check?: boolean
    readonly signal?: AbortSignal
  }): Promise<GetDoctorResponse>
}

export const doctorQueryKeys = {
  all: ['host', 'doctor'] as const,
  report: (projectId?: ProjectId) =>
    ['host', 'doctor', 'report', projectId ?? 'global'] as const,
}

export function doctorQueryOptions(
  client: DoctorReadClient,
  projectId?: ProjectId,
) {
  return queryOptions({
    queryKey: doctorQueryKeys.report(projectId),
    queryFn: async ({ signal }) =>
      (
        await client.getDoctor({
          ...(projectId === undefined ? {} : { projectId }),
          signal,
        })
      ).doctor,
    retry: false,
    staleTime: 0,
  })
}
