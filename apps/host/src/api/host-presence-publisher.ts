import {
  signedSupervisorHostPresenceSchema,
  supervisorTransportLimits,
  type SignedSupervisorHostPresence,
} from '@codetether/supervisor-transport'
import {
  type HostPresenceDiagnosticSnapshot,
  type HostPresenceDiagnosticEvent,
  type HostPresenceDiagnosticFields,
  type HostPresenceErrorCategory,
} from './host-presence-diagnostics.js'

export class HostPresenceDiagnosticError extends Error {
  constructor(readonly category: HostPresenceErrorCategory) {
    super('Host presence operation failed')
  }
}

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
  readonly diagnosticFields?: HostPresenceDiagnosticFields
  readonly onDiagnostic?: (
    event: HostPresenceDiagnosticEvent,
    fields?: HostPresenceDiagnosticFields,
  ) => void
}

/** One coalesced Host-owned worker. No React, session, window, or provider state. */
export class HostPresencePublisher {
  readonly #abort = new AbortController()
  readonly #options: HostPresencePublisherOptions
  readonly #task: Promise<void>
  #wake: (() => void) | undefined
  #wakePending = false
  #lastPresence: SignedSupervisorHostPresence | undefined
  #publisherStartedAt = new Date().toISOString()
  #publisherTaskAlive = true
  #lastLoopIterationAt: string | null = null
  #lastPublishAttemptAt: string | null = null
  #lastPublishSuccessAt: string | null = null
  #lastPublishFailureAt: string | null = null
  #lastPublishFailureCategory: HostPresenceErrorCategory | null = null
  #lastHttpStatusClass: HostPresenceDiagnosticSnapshot['lastHttpStatusClass'] =
    null
  #nextScheduledAttemptAt: string | null = null
  #consecutiveFailures = 0
  #totalAttempts = 0
  #totalSuccesses = 0
  #totalFailures = 0
  #currentBackoffMs = 0
  #currentRequestInFlight = false

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
    this.#record('PRESENCE_PUBLISHER_CREATED')
    this.#record('PRESENCE_PUBLISHER_START')
    this.#task = this.#run()
    void this.#task.then(
      () => {
        this.#publisherTaskAlive = false
        this.#record('PRESENCE_PUBLISHER_EXIT', {
          exitReason: this.#abort.signal.aborted
            ? 'shutdown'
            : 'unexpected_return',
          shutdownExpected: this.#abort.signal.aborted,
        })
      },
      () => {
        this.#publisherTaskAlive = false
        this.#record('PRESENCE_PUBLISHER_EXIT', {
          exitReason: this.#abort.signal.aborted
            ? 'shutdown'
            : 'uncaught_error',
          shutdownExpected: this.#abort.signal.aborted,
        })
      },
    )
  }

  get lastPresence(): SignedSupervisorHostPresence | undefined {
    return this.#lastPresence
  }

  diagnosticSnapshot(): HostPresenceDiagnosticSnapshot {
    return {
      publisherStartedAt: this.#publisherStartedAt,
      publisherTaskAlive: this.#publisherTaskAlive,
      lastLoopIterationAt: this.#lastLoopIterationAt,
      lastPublishAttemptAt: this.#lastPublishAttemptAt,
      lastPublishSuccessAt: this.#lastPublishSuccessAt,
      lastPublishFailureAt: this.#lastPublishFailureAt,
      lastPublishFailureCategory: this.#lastPublishFailureCategory,
      lastHttpStatusClass: this.#lastHttpStatusClass,
      nextScheduledAttemptAt: this.#nextScheduledAttemptAt,
      consecutiveFailures: this.#consecutiveFailures,
      totalAttempts: this.#totalAttempts,
      totalSuccesses: this.#totalSuccesses,
      totalFailures: this.#totalFailures,
      currentBackoffMs: this.#currentBackoffMs,
      currentRequestInFlight: this.#currentRequestInFlight,
    }
  }

  requestRenewal(): void {
    this.#wakePending = true
    this.#wake?.()
  }

  async close(): Promise<void> {
    this.#record('PRESENCE_SHUTDOWN_REQUESTED', {
      exitReason: 'shutdown',
      shutdownExpected: true,
    })
    this.#abort.abort()
    this.#wake?.()
    await this.#task
    this.#record('PRESENCE_PUBLISHER_STOP')
  }

  async #run(): Promise<void> {
    const minimum = this.#options.retryMinimumMs ?? 1_000
    const maximum = this.#options.retryMaximumMs ?? 60_000
    const renewal =
      this.#options.renewalMs ??
      supervisorTransportLimits.descriptorLifetimeMs / 5
    let retry = minimum
    let initial = true
    while (!this.#abort.signal.aborted) {
      this.#lastLoopIterationAt = new Date().toISOString()
      this.#record('PRESENCE_LOOP_ITERATION')
      this.#wakePending = false
      let delay = renewal
      try {
        if (initial) {
          this.#record('PRESENCE_INITIAL_PUBLISH_START')
          initial = false
        }
        this.#totalAttempts++
        this.#lastPublishAttemptAt = new Date().toISOString()
        this.#currentRequestInFlight = true
        this.#record('PRESENCE_PUBLISH_ATTEMPT')
        const presence = await this.#options.createPresence(this.#abort.signal)
        if (this.#abort.signal.aborted) return
        if (presence === undefined) {
          this.#currentRequestInFlight = false
          this.#lastPresence = undefined
          this.#options.onState?.('disabled')
        } else {
          this.#lastPresence =
            signedSupervisorHostPresenceSchema.parse(presence)
          const onDiagnostic = (
            event: HostPresenceDiagnosticEvent,
            fields: HostPresenceDiagnosticFields = {},
          ) =>
            this.#record(event, {
              hostId: presence.payload.hostId,
              generation: presence.payload.hostIdentityGeneration,
              endpointOrigin: presence.payload.controlPlaneOrigin,
              authMode: 'host_es256_jws',
              ...fields,
            })
          if (this.#options.publish === undefined) {
            await publishHostPresence(
              presence,
              this.#abort.signal,
              onDiagnostic,
            )
          } else {
            await this.#options.publish(presence, this.#abort.signal)
          }
          this.#currentRequestInFlight = false
          if (this.#abort.signal.aborted) return
          retry = minimum
          this.#currentBackoffMs = 0
          this.#consecutiveFailures = 0
          this.#totalSuccesses++
          this.#lastPublishSuccessAt = new Date().toISOString()
          this.#record('PRESENCE_PUBLISH_SUCCESS')
          this.#options.onState?.('published')
          this.#nextScheduledAttemptAt = new Date(
            Date.now() + renewal,
          ).toISOString()
          this.#record('PRESENCE_RENEWAL_SCHEDULED', {
            retryDelayMs: renewal,
          })
        }
      } catch (error) {
        this.#currentRequestInFlight = false
        if (this.#abort.signal.aborted) return
        // Never print exception bodies, signed envelopes, rendezvous capabilities,
        // or HTTP headers. Temporary HTTP/key/Relay failures cannot kill the loop.
        const category =
          error instanceof HostPresenceDiagnosticError
            ? error.category
            : 'unknown'
        this.#consecutiveFailures++
        this.#totalFailures++
        this.#lastPublishFailureAt = new Date().toISOString()
        this.#lastPublishFailureCategory = category
        this.#currentBackoffMs = retry
        this.#record('PRESENCE_PUBLISH_FAILURE', {
          errorCategory: category,
        })
        this.#options.onState?.('retrying')
        delay = retry
        this.#record('PRESENCE_ERROR', {
          errorCategory:
            category,
        })
        this.#record('PRESENCE_RETRY_SCHEDULED', { retryDelayMs: delay })
        this.#nextScheduledAttemptAt = new Date(
          Date.now() + delay,
        ).toISOString()
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
        this.#nextScheduledAttemptAt = new Date(
          Date.now() + delay,
        ).toISOString()
        this.#wake = done
        this.#abort.signal.addEventListener('abort', done, { once: true })
        if (this.#abort.signal.aborted || this.#wakePending) done()
      })
    }
  }

  #record(
    event: HostPresenceDiagnosticEvent,
    fields: HostPresenceDiagnosticFields = {},
  ): void {
    if (fields.statusClass !== undefined)
      this.#lastHttpStatusClass = fields.statusClass
    try {
      this.#options.onDiagnostic?.(event, {
        ...this.#options.diagnosticFields,
        ...fields,
      })
    } catch {
      // Diagnostics are observational and must never terminate the publisher.
    }
  }
}

export async function publishHostPresence(
  presence: SignedSupervisorHostPresence,
  signal: AbortSignal,
  onDiagnostic?: (
    event: HostPresenceDiagnosticEvent,
    fields?: HostPresenceDiagnosticFields,
  ) => void,
): Promise<void> {
  const origin = new URL(presence.payload.controlPlaneOrigin)
  const fields: HostPresenceDiagnosticFields = {
    hostId: presence.payload.hostId,
    generation: presence.payload.hostIdentityGeneration,
    endpointOrigin: origin.origin,
    authMode: 'host_es256_jws',
  }
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
    throw new HostPresenceDiagnosticError('configuration_missing')
  }
  onDiagnostic?.('PRESENCE_HTTP_START', fields)
  let response: Response
  try {
    response = await fetch(
      `${origin.origin}/v1/hosts/${presence.payload.hostId}/supervisor-host-presence`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(presence),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      },
    )
  } catch (error) {
    const category: HostPresenceErrorCategory =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'network_timeout'
        : 'network_error'
    onDiagnostic?.('PRESENCE_HTTP_RESULT', {
      ...fields,
      errorCategory: category,
    })
    throw new HostPresenceDiagnosticError(category)
  }
  const statusClass = statusClassFor(response.status)
  onDiagnostic?.('PRESENCE_HTTP_RESULT', {
    ...fields,
    statusClass,
    ...(!response.ok ? { errorCategory: 'http_rejected' as const } : {}),
  })
  // Authentication is the Host JWS. No bearer, cookies or ProductDevice key.
  await response.body?.cancel()
  if (!response.ok) throw new HostPresenceDiagnosticError('http_rejected')
}

function statusClassFor(
  status: number,
): HostPresenceDiagnosticFields['statusClass'] {
  switch (Math.floor(status / 100)) {
    case 2:
      return '2xx'
    case 3:
      return '3xx'
    case 4:
      return '4xx'
    case 5:
      return '5xx'
    default:
      return 'other'
  }
}
