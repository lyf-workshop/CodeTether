import {
  signedSupervisorHostPresenceSchema,
  supervisorTransportLimits,
  type SignedSupervisorHostPresence,
} from '@codetether/supervisor-transport'

export interface HostPresencePublisherOptions {
  readonly createPresence: (
    signal: AbortSignal,
  ) => Promise<SignedSupervisorHostPresence | undefined>
  readonly publish?: (
    presence: SignedSupervisorHostPresence,
    signal: AbortSignal,
  ) => Promise<void>
  readonly renewalMs?: number
  readonly retryMinimumMs?: number
  readonly retryMaximumMs?: number
  readonly onState?: (state: 'published' | 'retrying' | 'disabled') => void
}

/** One coalesced Host-owned worker. No React, session, window, or provider state. */
export class HostPresencePublisher {
  readonly #abort = new AbortController()
  readonly #options: HostPresencePublisherOptions
  readonly #task: Promise<void>
  #wake: (() => void) | undefined
  #wakePending = false
  #lastPresence: SignedSupervisorHostPresence | undefined

  constructor(options: HostPresencePublisherOptions) {
    const minimum = options.retryMinimumMs ?? 1_000
    const maximum = options.retryMaximumMs ?? 60_000
    const renewal =
      options.renewalMs ?? supervisorTransportLimits.descriptorLifetimeMs / 5
    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      !Number.isFinite(renewal) ||
      minimum <= 0 ||
      maximum < minimum ||
      renewal <= 0 ||
      renewal >= supervisorTransportLimits.descriptorLifetimeMs
    ) {
      throw new Error('Invalid Host presence scheduler bounds')
    }
    this.#options = options
    this.#task = this.#run()
  }

  get lastPresence(): SignedSupervisorHostPresence | undefined {
    return this.#lastPresence
  }

  requestRenewal(): void {
    this.#wakePending = true
    this.#wake?.()
  }

  async close(): Promise<void> {
    this.#abort.abort()
    this.#wake?.()
    await this.#task
  }

  async #run(): Promise<void> {
    const minimum = this.#options.retryMinimumMs ?? 1_000
    const maximum = this.#options.retryMaximumMs ?? 60_000
    const renewal =
      this.#options.renewalMs ??
      supervisorTransportLimits.descriptorLifetimeMs / 5
    let retry = minimum
    while (!this.#abort.signal.aborted) {
      this.#wakePending = false
      let delay = renewal
      try {
        const presence = await this.#options.createPresence(this.#abort.signal)
        if (this.#abort.signal.aborted) return
        if (presence === undefined) {
          this.#lastPresence = undefined
          this.#options.onState?.('disabled')
        } else {
          this.#lastPresence =
            signedSupervisorHostPresenceSchema.parse(presence)
          await (this.#options.publish ?? publishHostPresence)(
            presence,
            this.#abort.signal,
          )
          if (this.#abort.signal.aborted) return
          retry = minimum
          this.#options.onState?.('published')
        }
      } catch {
        if (this.#abort.signal.aborted) return
        // Never print exception bodies, signed envelopes, rendezvous capabilities,
        // or HTTP headers. Temporary HTTP/key/Relay failures cannot kill the loop.
        this.#options.onState?.('retrying')
        delay = retry
        retry = Math.min(maximum, retry * 2)
      }
      if (this.#wakePending) continue
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          this.#abort.signal.removeEventListener('abort', done)
          this.#wake = undefined
          resolve()
        }
        const timer = setTimeout(done, delay)
        this.#wake = done
        this.#abort.signal.addEventListener('abort', done, { once: true })
        if (this.#abort.signal.aborted || this.#wakePending) done()
      })
    }
  }
}

export async function publishHostPresence(
  presence: SignedSupervisorHostPresence,
  signal: AbortSignal,
): Promise<void> {
  const origin = new URL(presence.payload.controlPlaneOrigin)
  // Public HTTPS only in production. Loopback HTTP is reserved for local tests/dev.
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
      ))
  ) {
    throw new Error('Invalid Host Control Plane origin')
  }
  const response = await fetch(
    `${origin.origin}/v1/hosts/${presence.payload.hostId}/supervisor-host-presence`,
    {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(presence),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    },
  )
  // Authentication is the Host JWS. No bearer, cookies or ProductDevice key.
  await response.body?.cancel()
  if (!response.ok) throw new Error('Host presence publication rejected')
}
