import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'

import type { AgentProvider } from '@codetether/agent-core'

type ReadinessSample = () => Promise<string | undefined>

export interface LocalProviderReadinessCheck {
  readonly key: string
  readonly sample: ReadinessSample
}

export interface LocalProviderReadiness {
  isCurrent(provider: AgentProvider): Promise<boolean>
  invalidate(provider: AgentProvider): void
}

/** Validation of the current Host's committed lifecycle observation. */
export class LocalProviderReadinessCache implements LocalProviderReadiness {
  readonly #checks = new Map<
    AgentProvider,
    readonly LocalProviderReadinessCheck[]
  >()

  record(
    provider: AgentProvider,
    checks: readonly LocalProviderReadinessCheck[],
  ): void {
    if (checks.length === 0) this.invalidate(provider)
    else this.#checks.set(provider, checks)
  }

  async isCurrent(provider: AgentProvider): Promise<boolean> {
    const checks = this.#checks.get(provider)
    if (checks === undefined) return false
    const matches = await Promise.all(
      checks.map(async ({ key, sample }) => (await sample()) === key),
    )
    return this.#checks.get(provider) === checks && matches.every(Boolean)
  }

  invalidate(provider: AgentProvider): void {
    this.#checks.delete(provider)
  }
}

export async function observeWithLocalProviderReadiness<T>(
  sample: ReadinessSample,
  observe: () => Promise<T>,
): Promise<{ observation: T; readiness?: LocalProviderReadinessCheck }> {
  const key = await sample()
  const observation = await observe()
  return key !== undefined && key === (await sample())
    ? { observation, readiness: { key, sample } }
    : { observation }
}

/** A bounded open and stat detects unreadable files without reading their bytes. */
export function localProviderReadinessSample(
  resolveFiles: (signal: AbortSignal) => Promise<readonly string[]>,
  signal: AbortSignal,
): ReadinessSample {
  return async () => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(1_000)])
    if (deadline.aborted) return undefined
    let stop: () => void = () => undefined
    try {
      return await Promise.race([
        (async () => {
          const paths = await resolveFiles(deadline)
          const artifacts = await Promise.all(
            [...new Set(paths)].map(async (path) => {
              deadline.throwIfAborted()
              const resolved = await realpath(path)
              deadline.throwIfAborted()
              const handle = await open(
                resolved,
                constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
              )
              try {
                const stat = await handle.stat()
                if (!stat.isFile())
                  throw new Error('Installation artifact is not a file')
                return [resolved, stat.size, stat.mtimeMs]
              } finally {
                await handle.close()
              }
            }),
          )
          return JSON.stringify(artifacts)
        })(),
        new Promise<undefined>((resolve) => {
          stop = () => resolve(undefined)
          deadline.addEventListener('abort', stop, { once: true })
        }),
      ])
    } catch {
      return undefined
    } finally {
      deadline.removeEventListener('abort', stop)
    }
  }
}
