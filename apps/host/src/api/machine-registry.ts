import { randomUUID } from 'node:crypto'

import {
  MachineCapabilitiesSchema,
  MachineIdSchema,
  MachineSummarySchema,
  TimestampSchema,
  type MachineCapabilities,
  type MachineId,
  type MachineSummary,
  type Timestamp,
} from '@codetether/protocol'

import { ConversationStore, type DurableMachine } from '../persistence/index.js'

export type MachineRegistryErrorCode = 'not_found' | 'unavailable'

export class MachineRegistryError extends Error {
  constructor(
    readonly code: MachineRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MachineRegistryError'
  }
}

interface MachineRegistryOptions {
  readonly persistence?: ConversationStore
  readonly now: () => Timestamp
  readonly capabilities: MachineCapabilities
}

/**
 * Host-owned Machine identity boundary. Phase 6A intentionally has one real
 * local Machine; Provider discovery stays in ProviderRegistry and is composed
 * by HostService only after this registry validates the selected Machine.
 */
export class MachineRegistry {
  readonly #machine: DurableMachine
  readonly #capabilities: MachineCapabilities

  constructor(options: MachineRegistryOptions) {
    this.#capabilities = MachineCapabilitiesSchema.parse(options.capabilities)
    const persistence = options.persistence
    const persisted = persistence?.listMachines()
    if (persistence !== undefined && persisted !== undefined) {
      if (persisted.length !== 1 || persisted[0]?.kind !== 'local') {
        throw new Error(
          'Durable Machine state must contain exactly one canonical local Machine',
        )
      }
      const lastSeenAt = TimestampSchema.parse(options.now())
      this.#machine = persistence.updateMachineLastSeen(
        persisted[0].machineId,
        lastSeenAt,
      )
      return
    }

    const timestamp = TimestampSchema.parse(options.now())
    this.#machine = {
      machineId: MachineIdSchema.parse(
        `machine_${randomUUID().replaceAll('-', '')}`,
      ),
      displayName: '本地电脑',
      kind: 'local',
      platform: localPlatformName(),
      architecture: process.arch,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    }
  }

  localMachineId(): MachineId {
    return this.#machine.machineId
  }

  list(): readonly MachineSummary[] {
    return [this.#summary()]
  }

  get(machineId: MachineId): MachineSummary {
    const id = MachineIdSchema.parse(machineId)
    if (id !== this.#machine.machineId) {
      throw new MachineRegistryError('not_found', 'Machine was not found')
    }
    return this.#summary()
  }

  requireAvailable(machineId: MachineId): MachineSummary {
    const machine = this.get(machineId)
    if (machine.availability !== 'available') {
      throw new MachineRegistryError(
        'unavailable',
        'Machine is currently unavailable',
      )
    }
    return machine
  }

  #summary(): MachineSummary {
    return MachineSummarySchema.parse({
      machineId: this.#machine.machineId,
      displayName: this.#machine.displayName,
      kind: this.#machine.kind,
      platform: this.#machine.platform,
      architecture: this.#machine.architecture,
      availability: 'available',
      isLocal: true,
      createdAt: this.#machine.createdAt,
      lastSeenAt: this.#machine.lastSeenAt,
      capabilities: this.#capabilities,
    })
  }
}

function localPlatformName(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return process.platform
  }
}
