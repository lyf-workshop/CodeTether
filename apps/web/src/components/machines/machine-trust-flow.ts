import type { HostRuntime } from '../../runtime/host/host-runtime.js'

type PairingRuntime = Pick<
  HostRuntime,
  | 'beginRemoteMachinePairing'
  | 'confirmRemoteMachinePairing'
  | 'cancelRemoteMachinePairing'
>
type PairingAttemptId = Parameters<
  PairingRuntime['confirmRemoteMachinePairing']
>[0]
export interface MachineTrustLeaseToken {
  readonly kind: 'pairing' | 'unpair'
  readonly owner: symbol
}

class MachineTrustLease {
  #token: MachineTrustLeaseToken | undefined
  #listeners = new Set<() => void>()
  getSnapshot = (): MachineTrustLeaseToken | undefined => this.#token
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  acquire(
    kind: MachineTrustLeaseToken['kind'],
    owner = Symbol('trust-flow'),
  ): MachineTrustLeaseToken {
    if (this.#token !== undefined) throw new MachineTrustFlowBusyError()
    const token = Object.freeze({ kind, owner })
    this.#token = token
    this.#emit()
    return token
  }
  release(token: MachineTrustLeaseToken): void {
    if (this.#token !== token) return
    this.#token = undefined
    this.#emit()
  }
  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

// A frontend-only, process-local coordination lease. It never grants trust,
// persists credentials, queues requests, or replaces the Host's final checks.
const leases = new WeakMap<object, MachineTrustLease>()
export function getMachineTrustLease(runtime: object): MachineTrustLease {
  let lease = leases.get(runtime)
  if (lease === undefined) {
    lease = new MachineTrustLease()
    leases.set(runtime, lease)
  }
  return lease
}
export class MachineTrustFlowBusyError extends Error {
  constructor() {
    super('A Machine trust flow is already active')
    this.name = 'MachineTrustFlowBusyError'
  }
}
export class MachinePairingDisposedError extends Error {
  constructor() {
    super('Machine pairing flow is disposed')
    this.name = 'MachinePairingDisposedError'
  }
}
export async function runMachineTrustMutation<T>(
  runtime: object,
  request: () => Promise<T>,
): Promise<T> {
  const lease = getMachineTrustLease(runtime)
  const token = lease.acquire('unpair')
  try {
    return await request()
  } finally {
    lease.release(token)
  }
}

/** Owns only the transient attempt identifier, never a second Machine record. */
export class MachinePairingFlow {
  #runtime: PairingRuntime
  #lease: MachineTrustLease
  #token: MachineTrustLeaseToken | undefined
  #attemptId:
    Parameters<PairingRuntime['confirmRemoteMachinePairing']>[0] | undefined
  #pending: Promise<unknown> | undefined
  #disposal: Promise<void> | undefined
  #disposed = false
  #owner: symbol
  constructor(runtime: PairingRuntime, owner = Symbol('pairing-flow')) {
    this.#runtime = runtime
    this.#lease = getMachineTrustLease(runtime)
    this.#owner = owner
  }
  get ownsLease(): boolean {
    return (
      this.#token !== undefined && this.#lease.getSnapshot() === this.#token
    )
  }
  begin(
    ...args: Parameters<PairingRuntime['beginRemoteMachinePairing']>
  ): ReturnType<PairingRuntime['beginRemoteMachinePairing']> {
    if (this.#disposed) return Promise.reject(new MachinePairingDisposedError())
    if (this.#pending !== undefined || this.#token !== undefined)
      return Promise.reject(new MachineTrustFlowBusyError())
    try {
      this.#token = this.#lease.acquire('pairing', this.#owner)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#run(async () => {
      try {
        const response = await this.#runtime.beginRemoteMachinePairing(...args)
        this.#attemptId = response.data.candidate.pairingAttemptId
        if (this.#disposed) {
          await this.#cleanup()
          throw new MachinePairingDisposedError()
        }
        return response
      } catch (error) {
        if (this.#attemptId === undefined) this.#release()
        throw error
      }
    })
  }
  confirm(
    attemptId: Parameters<PairingRuntime['confirmRemoteMachinePairing']>[0],
  ): ReturnType<PairingRuntime['confirmRemoteMachinePairing']> {
    return this.#withAttempt(attemptId, async () => {
      try {
        const response =
          await this.#runtime.confirmRemoteMachinePairing(attemptId)
        this.#attemptId = undefined
        this.#release()
        return response
      } catch (error) {
        if (this.#disposed) await this.#cleanup()
        throw error
      }
    })
  }
  cancel(
    attemptId: Parameters<PairingRuntime['cancelRemoteMachinePairing']>[0],
  ): ReturnType<PairingRuntime['cancelRemoteMachinePairing']> {
    return this.#withAttempt(attemptId, async () => {
      try {
        const response =
          await this.#runtime.cancelRemoteMachinePairing(attemptId)
        this.#attemptId = undefined
        this.#release()
        return response
      } catch (error) {
        // A failed visible cancel retains its real attempt; leaving the view
        // releases the UI lease, while the Host's expiry/security gate remains.
        if (this.#disposed) {
          this.#attemptId = undefined
          this.#release()
        }
        throw error
      }
    })
  }
  dispose(): Promise<void> {
    if (this.#disposal !== undefined) return this.#disposal
    this.#disposed = true
    const pending = this.#pending
    this.#disposal = Promise.resolve().then(async () => {
      if (pending !== undefined) await pending.catch(() => undefined)
      else await this.#cleanup()
    })
    return this.#disposal
  }
  #withAttempt<T>(
    attemptId: PairingAttemptId,
    request: () => Promise<T>,
  ): Promise<T> {
    if (this.#disposed) return Promise.reject(new MachinePairingDisposedError())
    if (this.#pending !== undefined)
      return Promise.reject(new MachineTrustFlowBusyError())
    if (!this.ownsLease || this.#attemptId !== attemptId)
      return Promise.reject(new Error('Machine pairing attempt is not current'))
    return this.#run(request)
  }
  #run<T>(request: () => Promise<T>): Promise<T> {
    const promise = Promise.resolve()
      .then(request)
      .finally(() => {
        if (this.#pending === promise) this.#pending = undefined
      })
    this.#pending = promise
    return promise
  }
  async #cleanup(): Promise<void> {
    const attemptId = this.#attemptId
    this.#attemptId = undefined
    try {
      if (attemptId !== undefined)
        await this.#runtime.cancelRemoteMachinePairing(attemptId)
    } catch {
      /* One bounded cleanup only; no retry, logging, or trust revocation. */
    } finally {
      this.#release()
    }
  }
  #release(): void {
    if (this.#token !== undefined) this.#lease.release(this.#token)
    this.#token = undefined
  }
}
