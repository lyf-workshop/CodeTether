import { performance } from 'node:perf_hooks'

export type HostStartupPhase =
  | 'PROCESS_START'
  | 'LOCAL_STATE_OPEN'
  | 'PRODUCTDEVICE_RESTORED'
  | 'HOST_IDENTITY_RESTORED'
  | 'SUPERVISOR_4318_LISTENING'
  | 'PRODUCT_API_4317_LISTENING'
  | 'PROVIDER_DISCOVERY_START'
  | 'PROVIDER_DISCOVERY_DONE'
  | 'RELAY_START'
  | 'PRESENCE_PUBLISHER_START'
  | 'LOCAL_READY'

/** Safe monotonic phase timings only. Never account/key/config payloads. */
export class HostStartupTimeline {
  readonly #started = performance.now()
  readonly #seen = new Set<HostStartupPhase>()
  constructor(
    readonly observe?: (phase: HostStartupPhase, elapsedMs: number) => void,
  ) {}
  mark(phase: HostStartupPhase): void {
    if (this.#seen.has(phase)) return
    this.#seen.add(phase)
    try {
      this.observe?.(
        phase,
        Math.round((performance.now() - this.#started) * 100) / 100,
      )
    } catch {
      /* Diagnostics cannot become a readiness dependency. */
    }
  }
}
