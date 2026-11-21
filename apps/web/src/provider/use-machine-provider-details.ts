import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import type { GetMachineResponse, MachineId } from '@codetether/protocol'
import { useHostRuntime } from '../runtime/host/host-runtime-hooks'
import { machineDetailQueryOptions } from '../runtime/host/machine-query'

export type MachineProviderRead = Pick<
  UseQueryResult<GetMachineResponse>,
  'data' | 'isError'
>

/** Doctor omits descriptor availability. Use the same cached machine read as Devices. */
export function useMachineProviderDetails(
  machineIds: readonly MachineId[],
): ReadonlyMap<MachineId, MachineProviderRead> {
  const runtime = useHostRuntime()
  const results = useQueries({
    queries: machineIds.map((id) => machineDetailQueryOptions(runtime, id)),
  })
  return new Map(machineIds.map((id, index) => [id, results[index]!] as const))
}
