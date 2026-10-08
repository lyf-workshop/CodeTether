import { randomUUID } from 'node:crypto'
import {
  canonicalJsonBytes,
  supervisorDescriptorProofType,
  type SupervisorHostPresencePayload,
} from '@codetether/supervisor-transport'

const PREFIX = 'host-presence-sign '

/** A single outstanding purpose-limited request over the owned parent pipe. */
export class HostPresenceSigningBridge {
  #pending:
    { id: string; finish: (signature: string | undefined) => void } | undefined
  constructor(readonly write: (line: string) => void) {}

  async sign(
    keyHandle: string,
    payload: SupervisorHostPresencePayload,
    signal: AbortSignal,
  ): Promise<string> {
    if (this.#pending || signal.aborted)
      throw new Error('Host signer unavailable')
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: supervisorDescriptorProofType }),
    ).toString('base64url')
    const encoded = Buffer.from(canonicalJsonBytes(payload)).toString(
      'base64url',
    )
    const id = randomUUID()
    const signature = await new Promise<string | undefined>((resolve) => {
      const finish = (value: string | undefined) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.#pending = undefined
        resolve(value)
      }
      const abort = () => finish(undefined)
      const timer = setTimeout(abort, 8_000)
      this.#pending = { id, finish }
      signal.addEventListener('abort', abort, { once: true })
      try {
        this.write(
          `${PREFIX}${JSON.stringify({ id, keyHandle, payload, signingInput: `${header}.${encoded}` })}\n`,
        )
      } catch {
        finish(undefined)
      }
    })
    if (signature === undefined) throw new Error('Host presence signing failed')
    return `${header}.${encoded}.${signature}`
  }

  receive(line: string): void {
    if (!line.startsWith('host-presence-signature ')) return
    try {
      const response = JSON.parse(
        line.slice('host-presence-signature '.length),
      ) as Record<string, unknown>
      if (response.id !== this.#pending?.id) return
      const signature =
        typeof response.signature === 'string' &&
        /^[A-Za-z0-9_-]{86}$/u.test(response.signature)
          ? response.signature
          : undefined
      this.#pending?.finish(signature)
    } catch {
      /* Malformed replies cannot become signatures or log content. */
    }
  }
}
