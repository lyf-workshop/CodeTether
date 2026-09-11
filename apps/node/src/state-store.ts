import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import {
  ControllerIdSchema,
  MachineTransportMachineIdSchema,
  NodeIdSchema,
  PublicKeyFingerprintSchema,
  generateMachineTlsIdentity,
  newMachineTransportMachineId,
  newNodeId,
  readMachineTlsIdentityFile,
  type ControllerId,
  type MachineTlsIdentity,
  type PublicKeyFingerprint,
  type RemoteMachineMetadata,
} from '@codetether/machine-transport'
import { z } from 'zod'

const maximumStateFileBytes = 128 * 1024

const NodeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    displayName: z.string().trim().min(1).max(240),
    platform: z.string().trim().min(1).max(64),
    architecture: z.string().trim().min(1).max(64),
    identityFingerprint: PublicKeyFingerprintSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const TrustedControllerSchema = z
  .object({
    controllerId: ControllerIdSchema,
    publicKeyFingerprint: PublicKeyFingerprintSchema,
    pairedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
export type TrustedController = z.infer<typeof TrustedControllerSchema>

const ControllerRecoveryAuditSchema = z
  .object({
    event: z.literal('controller.recovered'),
    occurredAt: z.iso.datetime({ offset: true }),
    machineId: MachineTransportMachineIdSchema,
    controllerId: ControllerIdSchema,
    publicKeyFingerprint: PublicKeyFingerprintSchema,
    pairedAt: z.iso.datetime({ offset: true }),
    result: z.literal('revoked'),
  })
  .strict()
export type ControllerRecoveryAudit = z.infer<
  typeof ControllerRecoveryAuditSchema
>

const TrustStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    controllers: z.array(TrustedControllerSchema).max(1),
    recoveryAudit: z.array(ControllerRecoveryAuditSchema).max(32).optional(),
  })
  .strict()

export interface OpenNodeStateOptions {
  readonly dataDirectory: string
  readonly displayName: string
  readonly platform: string
  readonly architecture: string
  /** Local management commands must never create a replacement identity. */
  readonly requireExisting?: boolean
  /** Internal deterministic-test seam for atomic trust-write failures. */
  readonly writeTrustState?: (path: string, value: unknown) => Promise<void>
}

export class NodeStateStore {
  readonly dataDirectory: string
  readonly machine: RemoteMachineMetadata
  readonly identity: MachineTlsIdentity
  readonly createdAt: string
  readonly #trustPath: string
  readonly #lockPath: string
  readonly #lockHandle: FileHandle
  readonly #lockNonce: string
  readonly #writeTrustState: (path: string, value: unknown) => Promise<void>
  #controllers: TrustedController[]
  #recoveryAudit: ControllerRecoveryAudit[]
  #closed = false

  private constructor(options: {
    dataDirectory: string
    manifest: z.infer<typeof NodeManifestSchema>
    identity: MachineTlsIdentity
    controllers: TrustedController[]
    lockPath: string
    lockHandle: FileHandle
    lockNonce: string
    recoveryAudit: ControllerRecoveryAudit[]
    writeTrustState: (path: string, value: unknown) => Promise<void>
  }) {
    this.dataDirectory = options.dataDirectory
    this.machine = {
      machineId: options.manifest.machineId,
      nodeId: options.manifest.nodeId,
      displayName: options.manifest.displayName,
      platform: options.manifest.platform,
      architecture: options.manifest.architecture,
    }
    this.identity = options.identity
    this.createdAt = options.manifest.createdAt
    this.#controllers = [...options.controllers]
    this.#trustPath = join(options.dataDirectory, 'trusted-controllers.json')
    this.#lockPath = options.lockPath
    this.#lockHandle = options.lockHandle
    this.#lockNonce = options.lockNonce
    this.#writeTrustState = options.writeTrustState
    this.#recoveryAudit = [...options.recoveryAudit]
  }

  static async open(options: OpenNodeStateOptions): Promise<NodeStateStore> {
    if (!isAbsolute(options.dataDirectory)) {
      throw new TypeError('Node data directory must be absolute')
    }
    const displayName = options.displayName.trim()
    if (displayName.length === 0 || displayName.length > 240) {
      throw new TypeError('Node display name is invalid')
    }
    await ensurePrivateDirectory(options.dataDirectory)
    const lockPath = join(options.dataDirectory, 'node.lock')
    const lock = await acquireNodeLock(lockPath)
    try {
      const manifestPath = join(options.dataDirectory, 'node.json')
      const identityPath = join(options.dataDirectory, 'node-identity.json')
      const trustPath = join(options.dataDirectory, 'trusted-controllers.json')
      const manifestExists = await regularFileExists(manifestPath)
      const identityExists = await regularFileExists(identityPath)
      const trustExists = await regularFileExists(trustPath)

      if (!manifestExists) {
        if (options.requireExisting === true) {
          throw new Error('Existing Node state is required')
        }
        if (identityExists || trustExists) {
          throw new Error(
            'Node state is incomplete; identity reset is required',
          )
        }
        const identity = await generateMachineTlsIdentity('CodeTether Node')
        await writePrivateJsonExclusive(identityPath, {
          schemaVersion: 1,
          ...identity,
        })
        await writePrivateJsonExclusive(trustPath, {
          schemaVersion: 1,
          controllers: [],
        })
        const manifest = NodeManifestSchema.parse({
          schemaVersion: 1,
          machineId: newMachineTransportMachineId(),
          nodeId: newNodeId(),
          displayName,
          platform: options.platform,
          architecture: options.architecture,
          identityFingerprint: identity.publicKeyFingerprint,
          createdAt: new Date().toISOString(),
        })
        // Publish the manifest last. Its presence means all identity state must exist.
        await writePrivateJsonExclusive(manifestPath, manifest)
        return new NodeStateStore({
          dataDirectory: options.dataDirectory,
          manifest,
          identity,
          controllers: [],
          lockPath,
          lockHandle: lock.handle,
          lockNonce: lock.nonce,
          recoveryAudit: [],
          writeTrustState: options.writeTrustState ?? writePrivateJsonAtomic,
        })
      }

      if (!identityExists || !trustExists) {
        throw new Error(
          'Node state is incomplete; refusing identity replacement',
        )
      }
      const manifest = NodeManifestSchema.parse(
        await readBoundedJson(manifestPath),
      )
      const identity = await readMachineTlsIdentityFile(identityPath)
      if (identity.publicKeyFingerprint !== manifest.identityFingerprint) {
        throw new Error(
          'Node TLS identity does not match its durable Machine identity',
        )
      }
      const trust = TrustStoreSchema.parse(await readBoundedJson(trustPath))
      assertUniqueControllers(trust.controllers)
      return new NodeStateStore({
        dataDirectory: options.dataDirectory,
        manifest,
        identity,
        controllers: trust.controllers,
        lockPath,
        lockHandle: lock.handle,
        lockNonce: lock.nonce,
        recoveryAudit: trust.recoveryAudit ?? [],
        writeTrustState: options.writeTrustState ?? writePrivateJsonAtomic,
      })
    } catch (error) {
      await releaseNodeLock(lockPath, lock).catch(() => undefined)
      throw error
    }
  }

  get trustedControllerCount(): number {
    return this.#controllers.length
  }

  /**
   * Returns the one durable Controller trust record without exposing mutable
   * store state. Relay presence may attest only this already-paired
   * relationship; it cannot create or replace Machine trust.
   */
  trustedController(): TrustedController | undefined {
    const [controller] = this.#controllers
    return controller === undefined ? undefined : { ...controller }
  }

  trustedControllers(): readonly TrustedController[] {
    return this.#controllers.map((controller) => ({ ...controller }))
  }

  controllerRecoveryAudit(
    controllerId: ControllerId,
  ): ControllerRecoveryAudit | undefined {
    const audit = this.#recoveryAudit.find(
      (entry) => entry.controllerId === controllerId,
    )
    return audit === undefined ? undefined : { ...audit }
  }

  controllerByFingerprint(
    fingerprint: PublicKeyFingerprint,
  ): TrustedController | undefined {
    return this.#controllers.find(
      (entry) => entry.publicKeyFingerprint === fingerprint,
    )
  }

  controllerById(controllerId: ControllerId): TrustedController | undefined {
    return this.#controllers.find(
      (entry) => entry.controllerId === controllerId,
    )
  }

  async trustController(controller: TrustedController): Promise<void> {
    this.#assertOpen()
    const parsed = TrustedControllerSchema.parse(controller)
    const byId = this.controllerById(parsed.controllerId)
    const byKey = this.controllerByFingerprint(parsed.publicKeyFingerprint)
    if (byId !== undefined || byKey !== undefined) {
      if (
        byId?.publicKeyFingerprint === parsed.publicKeyFingerprint &&
        byKey?.controllerId === parsed.controllerId
      ) {
        return
      }
      throw new Error('Controller identity conflicts with existing trust')
    }
    if (this.#controllers.length >= 1) {
      throw new Error(
        'CodeTether Node is already paired; revoke trust before pairing again',
      )
    }
    const next = [...this.#controllers, parsed]
    await this.#writeTrustState(this.#trustPath, {
      schemaVersion: 1,
      controllers: next,
      ...(this.#recoveryAudit.length === 0
        ? {}
        : { recoveryAudit: this.#recoveryAudit }),
    })
    this.#controllers = next
  }

  async revokeController(controllerId: ControllerId): Promise<boolean> {
    this.#assertOpen()
    const parsedId = ControllerIdSchema.parse(controllerId)
    const next = this.#controllers.filter(
      (entry) => entry.controllerId !== parsedId,
    )
    if (next.length === this.#controllers.length) return false
    await this.#writeTrustState(this.#trustPath, {
      schemaVersion: 1,
      controllers: next,
      ...(this.#recoveryAudit.length === 0
        ? {}
        : { recoveryAudit: this.#recoveryAudit }),
    })
    this.#controllers = next
    return true
  }

  /** Caller must hold this local state lock and obtain explicit confirmation. */
  async recoverControllerLocally(
    controllerId: ControllerId,
    occurredAt: string,
  ): Promise<ControllerRecoveryAudit | undefined> {
    this.#assertOpen()
    const parsedId = ControllerIdSchema.parse(controllerId)
    const existingAudit = this.controllerRecoveryAudit(parsedId)
    if (existingAudit !== undefined) return { ...existingAudit }
    const target = this.controllerById(parsedId)
    if (target === undefined) return undefined
    const audit = ControllerRecoveryAuditSchema.parse({
      event: 'controller.recovered',
      occurredAt,
      machineId: this.machine.machineId,
      controllerId: target.controllerId,
      publicKeyFingerprint: target.publicKeyFingerprint,
      pairedAt: target.pairedAt,
      result: 'revoked',
    })
    const recoveryAudit = [...this.#recoveryAudit, audit].slice(-32)
    const controllers = this.#controllers.filter(
      (controller) => controller.controllerId !== parsedId,
    )
    await this.#writeTrustState(this.#trustPath, {
      schemaVersion: 1,
      controllers,
      recoveryAudit,
    })
    this.#controllers = controllers
    this.#recoveryAudit = recoveryAudit
    return { ...audit }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await releaseNodeLock(this.#lockPath, {
      handle: this.#lockHandle,
      nonce: this.#lockNonce,
    })
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Node state is closed')
  }
}

interface NodeStateLock {
  readonly handle: FileHandle
  readonly nonce: string
}

const NodeLockSchema = z
  .object({
    pid: z.number().int().positive(),
    nonce: z.string().length(32),
  })
  .strict()

async function acquireNodeLock(path: string): Promise<NodeStateLock> {
  const nonce = randomBytes(16).toString('hex')
  const acquisition = await acquireNodeLockAcquisition(path)
  let ownedLock: NodeStateLock | undefined
  let operationError: unknown
  try {
    try {
      ownedLock = await createOwnedNodeLock(path, nonce)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error('Node lock path is unsafe', { cause: error })
      }
      const existing = NodeLockSchema.parse(await readBoundedJson(path))
      if (processExists(existing.pid)) {
        throw new Error('Node state is already in use', { cause: error })
      }
      await unlink(path)
      ownedLock = await createOwnedNodeLock(path, nonce)
    }
    if (ownedLock === undefined) {
      throw new Error('Node state lock was not established')
    }
  } catch (error) {
    operationError = error
  } finally {
    try {
      await releaseNodeLockAcquisition(path, acquisition)
    } catch (error) {
      if (ownedLock !== undefined) {
        try {
          await releaseNodeLock(path, ownedLock)
        } catch (cleanupError) {
          operationError ??= new AggregateError(
            [error, cleanupError],
            'Node lock acquisition and exact cleanup both failed',
          )
        }
        ownedLock = undefined
      }
      operationError ??= error
    }
  }
  if (operationError !== undefined) throw operationError
  if (ownedLock === undefined) {
    throw new Error('Node state lock was not established')
  }
  return ownedLock
}

async function createOwnedNodeLock(
  path: string,
  nonce: string,
): Promise<NodeStateLock> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'wx', 0o600)
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, nonce })}\n`,
      'utf8',
    )
    await handle.sync()
    return { handle, nonce }
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined)
      // The caller holds the acquisition mutex, so a partially written file
      // cannot have been replaced by another legitimate Node writer.
      await unlink(path).catch(() => undefined)
    }
    throw error
  }
}

interface NodeLockAcquisition {
  readonly directory: string
  readonly ownerPath: string
  readonly nonce: string
}

const LOCK_ACQUISITION_RETRY_MS = 10
const LOCK_ACQUISITION_STALE_MS = 1_000
const LOCK_ACQUISITION_ATTEMPTS = 500

/**
 * Serializes stale-lock recovery across processes. The short-lived directory
 * is not held for the Node lifetime; it only closes the unlink/create race
 * where two recovering Nodes could otherwise displace each other's live lock.
 */
async function acquireNodeLockAcquisition(
  path: string,
): Promise<NodeLockAcquisition> {
  const directory = `${path}.acquire`
  const ownerPath = join(directory, 'owner.json')
  const nonce = randomBytes(16).toString('hex')
  for (let attempt = 0; attempt < LOCK_ACQUISITION_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(directory, { mode: 0o700 })
      try {
        await writePrivateJsonExclusive(ownerPath, {
          pid: process.pid,
          nonce,
        })
      } catch (error) {
        await rmdir(directory).catch(() => undefined)
        throw error
      }
      return { directory, ownerPath, nonce }
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }

    const metadata = await lstat(directory).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (metadata === undefined) continue
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Node lock acquisition path is unsafe')
    }
    const entries = await readdir(directory).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'EPERM')) return undefined
      throw error
    })
    if (entries === undefined) {
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, LOCK_ACQUISITION_RETRY_MS),
      )
      continue
    }
    if (entries.some((entry) => entry !== 'owner.json')) {
      throw new Error('Node lock acquisition path is unsafe')
    }
    let owner: z.infer<typeof NodeLockSchema> | undefined
    if (entries.includes('owner.json')) {
      try {
        owner = NodeLockSchema.parse(await readBoundedJson(ownerPath))
      } catch (error) {
        const ownerMetadata = await lstat(ownerPath).catch((cause: unknown) => {
          if (hasCode(cause, 'ENOENT')) return undefined
          throw cause
        })
        if (ownerMetadata === undefined) continue
        if (ownerMetadata.isFile() && !ownerMetadata.isSymbolicLink()) {
          const ageMs = Date.now() - ownerMetadata.mtimeMs
          if (ownerMetadata.size === 0 && ageMs >= LOCK_ACQUISITION_STALE_MS) {
            await recoverNodeLockAcquisition({
              directory,
              ownerPath,
              metadata,
              emptyOwnerFile: true,
            })
            continue
          }
          if (ageMs < LOCK_ACQUISITION_STALE_MS) {
            await new Promise((resolveWait) =>
              setTimeout(resolveWait, LOCK_ACQUISITION_RETRY_MS),
            )
            continue
          }
        }
        throw error
      }
    }
    if (owner !== undefined && !processExists(owner.pid)) {
      await recoverNodeLockAcquisition({
        directory,
        ownerPath,
        metadata,
        owner,
      })
      continue
    }
    if (
      owner === undefined &&
      Date.now() - metadata.mtimeMs >= LOCK_ACQUISITION_STALE_MS
    ) {
      await recoverNodeLockAcquisition({
        directory,
        ownerPath,
        metadata,
      })
      continue
    }
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, LOCK_ACQUISITION_RETRY_MS),
    )
  }
  throw new Error('Node state lock acquisition remained busy')
}

async function recoverNodeLockAcquisition(options: {
  readonly directory: string
  readonly ownerPath: string
  readonly metadata: Awaited<ReturnType<typeof lstat>>
  readonly owner?: z.infer<typeof NodeLockSchema>
  readonly emptyOwnerFile?: boolean
}): Promise<void> {
  const identity =
    options.owner?.nonce ??
    `empty-${String(options.metadata.dev)}-${String(options.metadata.ino)}-${String(Math.trunc(Number(options.metadata.mtimeMs)))}`
  const claimPath = `${options.directory}.recover-${identity}`
  const claim = {
    pid: process.pid,
    nonce: randomBytes(16).toString('hex'),
  }
  try {
    await writePrivateJsonExclusive(claimPath, claim)
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
    const existing = NodeLockSchema.parse(await readBoundedJson(claimPath))
    if (!processExists(existing.pid)) {
      // Never race another recovery by replacing its claim. A crash inside
      // this tiny recovery window fails closed and requires explicit cleanup.
      throw new Error('Node lock recovery claim is stale', { cause: error })
    }
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, LOCK_ACQUISITION_RETRY_MS),
    )
    return
  }

  try {
    const currentMetadata = await lstat(options.directory).catch(
      (error: unknown) => {
        if (hasCode(error, 'ENOENT')) return undefined
        throw error
      },
    )
    if (currentMetadata === undefined) return
    if (
      currentMetadata.isSymbolicLink() ||
      !currentMetadata.isDirectory() ||
      currentMetadata.dev !== options.metadata.dev ||
      currentMetadata.ino !== options.metadata.ino
    ) {
      return
    }
    const entries = await readdir(options.directory).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'EPERM')) return undefined
      throw error
    })
    if (entries === undefined) return
    if (options.owner === undefined) {
      if (options.emptyOwnerFile === true) {
        if (entries.length !== 1 || entries[0] !== 'owner.json') return
        const ownerMetadata = await lstat(options.ownerPath)
        if (
          ownerMetadata.isSymbolicLink() ||
          !ownerMetadata.isFile() ||
          ownerMetadata.size !== 0 ||
          Date.now() - ownerMetadata.mtimeMs < LOCK_ACQUISITION_STALE_MS
        ) {
          return
        }
        await unlink(options.ownerPath)
      } else if (entries.length !== 0) return
    } else {
      if (entries.length !== 1 || entries[0] !== 'owner.json') return
      const currentOwner = NodeLockSchema.parse(
        await readBoundedJson(options.ownerPath),
      )
      if (
        currentOwner.pid !== options.owner.pid ||
        currentOwner.nonce !== options.owner.nonce ||
        processExists(currentOwner.pid)
      ) {
        return
      }
      await unlink(options.ownerPath)
    }
    await rmdir(options.directory)
  } finally {
    await releaseRecoveryClaim(claimPath, claim)
  }
}

async function releaseRecoveryClaim(
  path: string,
  claim: z.infer<typeof NodeLockSchema>,
): Promise<void> {
  const current = NodeLockSchema.parse(await readBoundedJson(path))
  if (current.pid !== claim.pid || current.nonce !== claim.nonce) {
    throw new Error('Node lock recovery claim ownership changed')
  }
  await unlink(path)
}

async function releaseNodeLockAcquisition(
  path: string,
  acquisition: NodeLockAcquisition,
): Promise<void> {
  const expectedDirectory = `${path}.acquire`
  if (acquisition.directory !== expectedDirectory) {
    throw new Error('Node lock acquisition ownership is invalid')
  }
  const owner = NodeLockSchema.parse(
    await readBoundedJson(acquisition.ownerPath),
  )
  if (owner.pid !== process.pid || owner.nonce !== acquisition.nonce) {
    throw new Error('Node lock acquisition ownership changed')
  }
  await unlink(acquisition.ownerPath)
  await rmdir(acquisition.directory)
}

async function releaseNodeLock(
  path: string,
  lock: NodeStateLock,
): Promise<void> {
  await lock.handle.close()
  const metadata = await lstat(path).catch(() => undefined)
  if (metadata === undefined) return
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Node lock path is unsafe')
  }
  const current = NodeLockSchema.parse(await readBoundedJson(path))
  if (current.pid !== process.pid || current.nonce !== lock.nonce) {
    throw new Error('Node state lock ownership changed; refusing removal')
  }
  await unlink(path)
}

async function writePrivateJsonExclusive(
  path: string,
  value: unknown,
): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
}

async function writePrivateJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Node state path is unsafe')
  }
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  await writePrivateJsonExclusive(temporary, value)
  try {
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Node state path is unsafe')
  }
  if (metadata.size <= 0 || metadata.size > maximumStateFileBytes) {
    throw new Error('Node state file size is invalid')
  }
  await chmod(path, 0o600)
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function regularFileExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('Node state path is unsafe')
    }
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('Node data directory is unsafe')
  }
  await chmod(path, 0o700)
}

function assertUniqueControllers(
  controllers: readonly TrustedController[],
): void {
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const controller of controllers) {
    if (
      ids.has(controller.controllerId) ||
      keys.has(controller.publicKeyFingerprint)
    ) {
      throw new Error('Trusted controller identities are duplicated')
    }
    ids.add(controller.controllerId)
    keys.add(controller.publicKeyFingerprint)
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return hasCode(error, 'EPERM')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
