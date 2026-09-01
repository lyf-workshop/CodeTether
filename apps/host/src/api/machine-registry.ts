import { randomUUID } from 'node:crypto'

import {
  MachineCapabilitiesSchema,
  MachineConnectionStateSchema,
  MachineIdSchema,
  MachineSummarySchema,
  TimestampSchema,
  type MachineCapabilities,
  type MachineConnectionState,
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

export interface RemoteMachineStatusSource {
  connectionState(machineId: MachineId): MachineConnectionState | undefined
  /** True only for an online, authenticated Machine with a current execution profile. */
  providerExecutionAvailable?(machineId: MachineId): boolean
}

interface MachineRegistryOptions {
  readonly persistence?: ConversationStore
  readonly now: () => Timestamp
  readonly capabilities: MachineCapabilities
  readonly remoteStatus?: RemoteMachineStatusSource
}

/**
 * Host-owned durable Machine index. Remote transport/authentication remains a
 * separate boundary and contributes only an ephemeral presentation state.
 */
export class MachineRegistry {
  readonly #machines = new Map<MachineId, DurableMachine>()
  readonly #localMachineId: MachineId
  readonly #capabilities: MachineCapabilities
  readonly #remoteStatus?: RemoteMachineStatusSource

  constructor(options: MachineRegistryOptions) {
    this.#capabilities = MachineCapabilitiesSchema.parse(options.capabilities)
    this.#remoteStatus = options.remoteStatus
    const persistence = options.persistence
    const persisted = persistence?.listMachines()
    if (persistence !== undefined && persisted !== undefined) {
      const locals = persisted.filter((machine) => machine.kind === 'local')
      if (locals.length !== 1 || locals[0] === undefined) {
        throw new Error(
          'Durable Machine state must contain exactly one canonical local Machine',
        )
      }
      const lastSeenAt = TimestampSchema.parse(options.now())
      const local = persistence.updateMachineLastSeen(
        locals[0].machineId,
        lastSeenAt,
      )
      const activeRemoteIds = new Set(
        persistence
          .listTrustedMachinePeers()
          .filter((peer) => peer.trustState === 'active')
          .map((peer) => peer.machineId),
      )
      for (const machine of persisted) {
        if (
          machine.kind === 'local' ||
          activeRemoteIds.has(machine.machineId)
        ) {
          this.#retain(machine)
        }
      }
      this.#retain(local)
      this.#localMachineId = local.machineId
      return
    }

    const timestamp = TimestampSchema.parse(options.now())
    const local: DurableMachine = {
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
    this.#retain(local)
    this.#localMachineId = local.machineId
  }

  localMachineId(): MachineId {
    return this.#localMachineId
  }

  list(): readonly MachineSummary[] {
    return [...this.#machines.values()]
      .sort(
        (left, right) =>
          Number(right.kind === 'local') - Number(left.kind === 'local') ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.machineId.localeCompare(right.machineId),
      )
      .map((machine) => this.#summary(machine))
  }

  get(machineId: MachineId): MachineSummary {
    const id = MachineIdSchema.parse(machineId)
    const machine = this.#machines.get(id)
    if (machine === undefined) {
      throw new MachineRegistryError('not_found', 'Machine was not found')
    }
    return this.#summary(machine)
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

  retainRemote(machine: DurableMachine): MachineSummary {
    if (machine.kind !== 'remote') {
      throw new Error('Only remote Machines can be retained after pairing')
    }
    const existing = this.#machines.get(machine.machineId)
    if (existing !== undefined && existing.kind !== 'remote') {
      throw new Error(
        'Remote Machine identity conflicts with the local Machine',
      )
    }
    this.#retain(machine)
    return this.#summary(machine)
  }

  removeRemote(machineId: MachineId): void {
    const id = MachineIdSchema.parse(machineId)
    const machine = this.#machines.get(id)
    if (machine === undefined) {
      throw new MachineRegistryError('not_found', 'Machine was not found')
    }
    if (machine.kind !== 'remote') {
      throw new MachineRegistryError(
        'unavailable',
        'The local Machine cannot be unpaired',
      )
    }
    this.#machines.delete(id)
  }

  refresh(machine: DurableMachine): MachineSummary {
    if (!this.#machines.has(machine.machineId)) {
      throw new MachineRegistryError('not_found', 'Machine was not found')
    }
    this.#retain(machine)
    return this.#summary(machine)
  }

  #retain(machine: DurableMachine): void {
    const id = MachineIdSchema.parse(machine.machineId)
    this.#machines.set(id, { ...machine, machineId: id })
  }

  #summary(machine: DurableMachine): MachineSummary {
    if (machine.kind === 'local') {
      return MachineSummarySchema.parse({
        machineId: machine.machineId,
        displayName: machine.displayName,
        kind: machine.kind,
        platform: machine.platform,
        architecture: machine.architecture,
        availability: 'available',
        connectionState: 'local',
        trustState: 'local',
        isLocal: true,
        createdAt: machine.createdAt,
        lastSeenAt: machine.lastSeenAt,
        capabilities: this.#capabilities,
      })
    }

    const connectionState = MachineConnectionStateSchema.parse(
      this.#remoteStatus?.connectionState(machine.machineId) ?? 'offline',
    )
    if (connectionState === 'local') {
      throw new Error('Remote Machine transport returned a local state')
    }
    return MachineSummarySchema.parse({
      machineId: machine.machineId,
      displayName: machine.displayName,
      kind: machine.kind,
      platform: machine.platform,
      architecture: machine.architecture,
      availability: connectionState === 'online' ? 'available' : 'unavailable',
      connectionState,
      trustState: 'trusted',
      isLocal: false,
      createdAt: machine.createdAt,
      lastSeenAt: machine.lastSeenAt,
      capabilities: {
        // Phase 6B.3 admits only purpose-specific ProjectLocation
        // registration/reads. This does not imply remote filesystem access or
        // Provider execution.
        projectAccess: true,
        providerExecution:
          this.#remoteStatus?.providerExecutionAvailable?.(
            machine.machineId,
          ) === true,
        backgroundRuntime: false,
        nativeFolderPicker: false,
        notifications: false,
      },
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
