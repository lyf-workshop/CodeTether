import { queryOptions } from '@tanstack/react-query'
import type {
  GetMachineResponse,
  ListMachinesResponse,
  MachineId,
} from '@codetether/protocol'

export interface MachineReadClient {
  listMachines(options?: {
    readonly signal?: AbortSignal
  }): Promise<ListMachinesResponse>
  getMachine(
    machineId: MachineId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetMachineResponse>
}

export const machineQueryKeys = {
  all: ['host', 'machines'] as const,
  list: ['host', 'machines', 'list'] as const,
  detail: (machineId: MachineId) =>
    ['host', 'machines', 'detail', machineId] as const,
}

export function machineListQueryOptions(client: MachineReadClient) {
  return queryOptions({
    queryKey: machineQueryKeys.list,
    queryFn: async ({ signal }) =>
      (await client.listMachines({ signal })).machines,
    retry: false,
    staleTime: 0,
  })
}

export function machineDetailQueryOptions(
  client: MachineReadClient,
  machineId: MachineId,
) {
  return queryOptions({
    queryKey: machineQueryKeys.detail(machineId),
    queryFn: ({ signal }) => client.getMachine(machineId, { signal }),
    retry: false,
    staleTime: 0,
  })
}
