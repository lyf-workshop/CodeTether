import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import {
  RelayEnrollmentTokenSchema,
  RelayIdSchema,
  RelayPeerIdSchema,
  RelayPublicKeyFingerprintSchema,
} from '@codetether/relay-protocol'
import { z } from 'zod'

const MAXIMUM_RELAY_CONFIGURATION_BYTES = 16 * 1024
const MAXIMUM_ENROLLMENT_TOKEN_BYTES = 512

export const NODE_RELAY_CONFIGURATION_FILE = 'relay.json'
export const NODE_RELAY_ENROLLMENT_TOKEN_FILE = 'relay-enrollment-token'
export const NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE =
  'relay-enrollment-token.inflight'
export const NODE_RELAY_REGISTRATION_FILE = 'relay-registration.json'

const RelayHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      !/[\s\0/@\\]/u.test(value) &&
      !value.includes('://') &&
      value !== '.' &&
      value !== '..',
    'Relay host must be a host name or IP address',
  )

const RelayServerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      !/[\s\0/@\\:[\]]/u.test(value) &&
      !value.includes('://') &&
      value !== '.' &&
      value !== '..',
    'Relay TLS server name is invalid',
  )

export const NodeRelayTlsPolicySchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('public_ca'),
      serverName: RelayServerNameSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('pinned_certificate'),
      certificatePublicKeyFingerprint: RelayPublicKeyFingerprintSchema,
      serverName: RelayServerNameSchema.optional(),
    })
    .strict(),
])
export type NodeRelayTlsPolicy = z.infer<typeof NodeRelayTlsPolicySchema>

export const NodeRelayConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    endpoint: z
      .object({
        host: RelayHostSchema,
        port: z.number().int().min(1).max(65_535),
      })
      .strict(),
    relayIdentityFingerprint: RelayPublicKeyFingerprintSchema,
    tls: NodeRelayTlsPolicySchema,
  })
  .strict()
export type NodeRelayConfiguration = z.infer<
  typeof NodeRelayConfigurationSchema
>

export const NodeRelayRegistrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    relayId: RelayIdSchema,
    relayIdentityFingerprint: RelayPublicKeyFingerprintSchema,
    peerId: RelayPeerIdSchema,
    observedAt: z.iso.datetime({ offset: true }).max(64),
  })
  .strict()
export type NodeRelayRegistration = z.infer<typeof NodeRelayRegistrationSchema>

export interface NodeRelayEnrollmentToken {
  /** Provider-private input. Never log, persist in Relay state, or expose. */
  readonly secret: string
  /** Process-private guard used to avoid deleting a replacement token file. */
  readonly contentDigest: Buffer
}

export async function readNodeRelayConfiguration(
  dataDirectory: string,
): Promise<NodeRelayConfiguration | undefined> {
  assertAbsoluteDataDirectory(dataDirectory)
  const path = join(dataDirectory, NODE_RELAY_CONFIGURATION_FILE)
  const text = await readPrivateRegularFile(
    path,
    MAXIMUM_RELAY_CONFIGURATION_BYTES,
    true,
  )
  if (text === undefined) return undefined
  try {
    return NodeRelayConfigurationSchema.parse(JSON.parse(text) as unknown)
  } catch (error) {
    throw new Error('Node Relay configuration is invalid', { cause: error })
  }
}

/** Atomically stores only bounded public Relay configuration, never a token. */
export async function writeNodeRelayConfiguration(
  dataDirectory: string,
  configuration: NodeRelayConfiguration,
): Promise<void> {
  assertAbsoluteDataDirectory(dataDirectory)
  await writePrivateJson(
    join(dataDirectory, NODE_RELAY_CONFIGURATION_FILE),
    NodeRelayConfigurationSchema.parse(configuration),
  )
}

export async function readNodeRelayEnrollmentToken(
  dataDirectory: string,
): Promise<NodeRelayEnrollmentToken | undefined> {
  assertAbsoluteDataDirectory(dataDirectory)
  const pending = await readPendingNodeRelayEnrollmentToken(dataDirectory)
  if (pending !== undefined) return pending
  const path = join(dataDirectory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)
  const text = await readPrivateRegularFile(
    path,
    MAXIMUM_ENROLLMENT_TOKEN_BYTES,
    true,
  )
  if (text === undefined) return undefined
  parseEnrollmentToken(text)
  const pendingPath = join(
    dataDirectory,
    NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE,
  )
  await rename(path, pendingPath)
  const claimed = await readPrivateRegularFile(
    pendingPath,
    MAXIMUM_ENROLLMENT_TOKEN_BYTES,
    false,
  )
  if (claimed === undefined) {
    throw new Error('Node Relay enrollment token is unavailable')
  }
  return parseEnrollmentToken(claimed)
}

/** Reads only a one-use input atomically claimed by an earlier attempt. */
export async function readPendingNodeRelayEnrollmentToken(
  dataDirectory: string,
): Promise<NodeRelayEnrollmentToken | undefined> {
  assertAbsoluteDataDirectory(dataDirectory)
  const path = join(dataDirectory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)
  const text = await readPrivateRegularFile(
    path,
    MAXIMUM_ENROLLMENT_TOKEN_BYTES,
    true,
  )
  return text === undefined ? undefined : parseEnrollmentToken(text)
}

export async function readNodeRelayRegistration(
  dataDirectory: string,
): Promise<NodeRelayRegistration | undefined> {
  assertAbsoluteDataDirectory(dataDirectory)
  const path = join(dataDirectory, NODE_RELAY_REGISTRATION_FILE)
  const text = await readPrivateRegularFile(
    path,
    MAXIMUM_RELAY_CONFIGURATION_BYTES,
    true,
  )
  if (text === undefined) return undefined
  try {
    return NodeRelayRegistrationSchema.parse(JSON.parse(text) as unknown)
  } catch (error) {
    throw new Error('Node Relay registration is invalid', { cause: error })
  }
}

/** Writes only the server-issued opaque registration, never the enrollment token. */
export async function writeNodeRelayRegistration(
  dataDirectory: string,
  registration: NodeRelayRegistration,
): Promise<void> {
  assertAbsoluteDataDirectory(dataDirectory)
  const value = NodeRelayRegistrationSchema.parse(registration)
  await writePrivateJson(
    join(dataDirectory, NODE_RELAY_REGISTRATION_FILE),
    value,
  )
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  const payload = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(payload, 'utf8') > MAXIMUM_RELAY_CONFIGURATION_BYTES) {
    throw new Error('Node Relay state exceeds its size bound')
  }
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

/**
 * Deletes the exact one-use token only after successful enrollment/auth. A
 * token replaced while the request was in flight is deliberately retained.
 */
export async function consumeNodeRelayEnrollmentToken(
  dataDirectory: string,
  token: NodeRelayEnrollmentToken,
): Promise<void> {
  assertAbsoluteDataDirectory(dataDirectory)
  const path = join(dataDirectory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)
  const text = await readPrivateRegularFile(
    path,
    MAXIMUM_ENROLLMENT_TOKEN_BYTES,
    false,
  )
  if (text === undefined) {
    throw new Error('Node Relay enrollment token is unavailable')
  }
  const current = text.trim()
  const currentDigest = digestToken(current)
  if (
    currentDigest.byteLength !== token.contentDigest.byteLength ||
    !timingSafeEqual(currentDigest, token.contentDigest)
  ) {
    throw new Error('Node Relay enrollment token changed before consumption')
  }
  await unlink(path)
}

function parseEnrollmentToken(text: string): NodeRelayEnrollmentToken {
  const parsed = RelayEnrollmentTokenSchema.safeParse(text.trim())
  if (!parsed.success) {
    throw new Error('Node Relay enrollment token is invalid')
  }
  return {
    secret: parsed.data,
    contentDigest: digestToken(parsed.data),
  }
}

async function readPrivateRegularFile(
  path: string,
  maximumBytes: number,
  allowMissing: boolean,
): Promise<string | undefined> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (allowMissing && isMissingFileError(error)) return undefined
    throw error
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Node Relay state path is not a regular file')
  }
  if (metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error('Node Relay state file size is invalid')
  }
  await chmod(path, 0o600)
  return await readFile(path, 'utf8')
}

function digestToken(secret: string): Buffer {
  return createHash('sha256')
    .update('codetether-relay-enrollment-token\0', 'utf8')
    .update(secret, 'utf8')
    .digest()
}

function assertAbsoluteDataDirectory(dataDirectory: string): void {
  if (!isAbsolute(dataDirectory)) {
    throw new TypeError('Node data directory must be absolute')
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
