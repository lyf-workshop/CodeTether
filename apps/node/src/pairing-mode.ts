import {
  OpaquePairingAuthority,
  createPairingCode,
  machineTransportLimits,
  newPairingAttemptId,
  pairingServerIdentifier,
  type PairingCode,
  type PublicKeyFingerprint,
  type RemoteMachineMetadata,
} from '@codetether/machine-transport'
import type { MachineWireErrorCode } from '@codetether/machine-transport'

export interface PairingModeView {
  readonly code: PairingCode
  readonly expiresAt: Date
  readonly authority: OpaquePairingAuthority
}

export class PairingMode {
  readonly #machine: RemoteMachineMetadata
  readonly #nodeFingerprint: PublicKeyFingerprint
  #active: PairingModeView | undefined
  #connectionClaimed = false

  constructor(
    machine: RemoteMachineMetadata,
    nodeFingerprint: PublicKeyFingerprint,
  ) {
    this.#machine = machine
    this.#nodeFingerprint = nodeFingerprint
  }

  async enable(): Promise<PairingModeView> {
    this.cancel()
    const code = createPairingCode()
    const expiresAt = new Date(
      Date.now() + machineTransportLimits.pairingLifetimeMs,
    )
    const authority = await OpaquePairingAuthority.create({
      attemptId: newPairingAttemptId(),
      expiresAt,
      serverIdentifier: pairingServerIdentifier(
        this.#machine.machineId,
        this.#nodeFingerprint,
      ),
      code,
    })
    this.#active = { code, expiresAt, authority }
    this.#connectionClaimed = false
    return this.#active
  }

  claim(): PairingModeView | undefined {
    if (this.#active?.authority.active !== true) {
      return undefined
    }
    if (this.#connectionClaimed) return undefined
    this.#connectionClaimed = true
    return this.#active
  }

  release(): void {
    this.#connectionClaimed = false
  }

  consume(): void {
    this.#active?.authority.consume()
    this.#active = undefined
    this.#connectionClaimed = false
  }

  cancel(): void {
    this.#active?.authority.cancel()
    this.#active = undefined
    this.#connectionClaimed = false
  }

  get active(): boolean {
    return this.#active?.authority.active === true
  }

  get rejectionCode(): MachineWireErrorCode {
    if (this.#active === undefined) return 'pairing_disabled'
    if (this.#connectionClaimed && this.#active.authority.active) return 'busy'
    return this.#active.authority.remainingAttempts === 0
      ? 'pairing_rate_limited'
      : 'pairing_expired'
  }
}
