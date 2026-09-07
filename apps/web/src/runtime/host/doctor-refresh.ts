import type { MachineId } from '@codetether/protocol'

const maximumDoctorMachines = 64
const defaultRefreshConcurrency = 2

/** One UI refresh owner prevents duplicate buttons/controllers from multiplying work. */
export class DoctorRefreshCoordinator {
  #attempt?: Promise<void>

  run(task: () => Promise<void>): Promise<void> {
    if (this.#attempt !== undefined) return this.#attempt
    const attempt = task().finally(() => {
      if (this.#attempt === attempt) this.#attempt = undefined
    })
    this.#attempt = attempt
    return attempt
  }
}

/** Refreshes a bounded, deduplicated Machine set with small fixed fanout. */
export async function refreshMachinesBounded(
  machineIds: readonly MachineId[],
  refresh: (machineId: MachineId) => Promise<unknown>,
  concurrency = defaultRefreshConcurrency,
): Promise<{
  readonly attempted: number
  readonly failedMachineIds: readonly MachineId[]
}> {
  const boundedConcurrency = Math.max(
    1,
    Math.min(defaultRefreshConcurrency, Math.floor(concurrency)),
  )
  const pending = [...new Set(machineIds)].slice(0, maximumDoctorMachines)
  const failedMachineIds: MachineId[] = []
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(boundedConcurrency, pending.length) },
    async () => {
      while (nextIndex < pending.length) {
        const machineId = pending[nextIndex++]
        if (machineId === undefined) return
        try {
          await refresh(machineId)
        } catch {
          // Doctor composes each resulting Machine observation. One unavailable
          // computer must not cancel checks for other computers.
          failedMachineIds.push(machineId)
        }
      }
    },
  )
  await Promise.all(workers)
  return { attempted: pending.length, failedMachineIds }
}
