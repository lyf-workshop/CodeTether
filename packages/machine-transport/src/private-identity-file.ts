import { randomBytes } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
} from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

import { z } from 'zod'

import {
  generateMachineTlsIdentity,
  validateMachineTlsIdentity,
  type MachineTlsIdentity,
} from './identity.js'

const maximumIdentityFileBytes = 64 * 1024
const StoredIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    certificatePem: z
      .string()
      .min(1)
      .max(32 * 1024),
    privateKeyPem: z
      .string()
      .min(1)
      .max(32 * 1024),
    publicKeyFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()

/** Reads an existing owner-private TLS identity. Missing or malformed files fail closed. */
export async function readMachineTlsIdentityFile(
  path: string,
): Promise<MachineTlsIdentity> {
  assertAbsoluteFilePath(path)
  await ensurePrivateDirectory(dirname(path))
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Machine identity path is not a regular file')
  }
  if (metadata.size <= 0 || metadata.size > maximumIdentityFileBytes) {
    throw new Error('Machine identity file size is invalid')
  }
  await chmod(path, 0o600)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error('Machine identity file is unreadable', { cause: error })
  }
  const stored = StoredIdentitySchema.parse(parsed)
  return validateMachineTlsIdentity({
    certificatePem: stored.certificatePem,
    privateKeyPem: stored.privateKeyPem,
    publicKeyFingerprint: stored.publicKeyFingerprint,
  })
}

/** Creates a new identity without ever replacing an existing credential. */
export async function createMachineTlsIdentityFile(
  path: string,
  commonName:
    'CodeTether Node' | 'CodeTether Controller' = 'CodeTether Controller',
): Promise<MachineTlsIdentity> {
  assertAbsoluteFilePath(path)
  const directory = dirname(path)
  await ensurePrivateDirectory(directory)
  const identity = await generateMachineTlsIdentity(commonName)
  const payload = `${JSON.stringify({ schemaVersion: 1, ...identity })}\n`
  const temporaryPath = `${path}.${randomBytes(12).toString('hex')}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    // A hard-link publish is atomic and fails instead of replacing a credential
    // another process may have created concurrently.
    await link(temporaryPath, path)
  } catch (error) {
    throw new Error(
      'Machine identity already exists or could not be published',
      {
        cause: error,
      },
    )
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
  await chmod(path, 0o600)
  return identity
}

/** Explicit bootstrap helper; corruption never triggers identity replacement. */
export async function loadOrCreateMachineTlsIdentityFile(
  path: string,
  commonName:
    'CodeTether Node' | 'CodeTether Controller' = 'CodeTether Controller',
): Promise<{
  readonly identity: MachineTlsIdentity
  readonly created: boolean
}> {
  try {
    return { identity: await readMachineTlsIdentityFile(path), created: false }
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }
  try {
    return {
      identity: await createMachineTlsIdentityFile(path, commonName),
      created: true,
    }
  } catch (error) {
    // Resolve a benign concurrent creator. Any malformed winner still fails closed.
    if (!isAlreadyExistsError(error)) throw error
    return { identity: await readMachineTlsIdentityFile(path), created: false }
  }
}

/** Deletes exactly one credential file after rejecting symlinks and non-files. */
export async function deleteMachineTlsIdentityFile(
  path: string,
): Promise<void> {
  assertAbsoluteFilePath(path)
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Machine identity path is not a regular file')
  }
  await unlink(path)
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('Machine identity directory is not a regular directory')
  }
  await chmod(path, 0o700)
}

function assertAbsoluteFilePath(path: string): void {
  if (!isAbsolute(path))
    throw new TypeError('Machine identity path must be absolute')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if ('code' in error && error.code === 'EEXIST') return true
  return (
    error.cause instanceof Error &&
    'code' in error.cause &&
    error.cause.code === 'EEXIST'
  )
}
