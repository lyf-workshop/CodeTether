import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
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

const TrustStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    controllers: z.array(TrustedControllerSchema).max(1),
  })
  .strict()

export interface OpenNodeStateOptions {
  readonly dataDirectory: string
  readonly displayName: string
  readonly platform: string
  readonly architecture: string
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
  #controllers: TrustedController[]
  #closed = false

  private constructor(options: {
    dataDirectory: string
    manifest: z.infer<typeof NodeManifestSchema>
    identity: MachineTlsIdentity
    controllers: TrustedController[]
    lockPath: string
    lockHandle: FileHandle
    lockNonce: string
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
      })
    } catch (error) {
      await releaseNodeLock(lockPath, lock).catch(() => undefined)
      throw error
    }
  }

  get trustedControllerCount(): number {
    return this.#controllers.length
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
    await writePrivateJsonAtomic(this.#trustPath, {
      schemaVersion: 1,
      controllers: next,
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
    await writePrivateJsonAtomic(this.#trustPath, {
      schemaVersion: 1,
      controllers: next,
    })
    this.#controllers = next
    return true
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
      await unlink(path).catch(() => undefined)
    }
    if (!hasCode(error, 'EEXIST')) throw error
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('Node lock path is unsafe', { cause: error })
    }
    const existing = NodeLockSchema.parse(await readBoundedJson(path))
    if (processExists(existing.pid)) {
      throw new Error('Node state is already in use', { cause: error })
    }
    throw new Error(
      'Node state lock is stale; explicit lock recovery is required',
      { cause: error },
    )
  }
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
