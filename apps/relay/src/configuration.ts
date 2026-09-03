import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
} from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { z } from 'zod'

import type { RelayApplicationIdentity } from '@codetether/relay-protocol'

import { generateRelayPinnedTlsIdentity } from './development-tls.js'

const AbsolutePathSchema = z
  .string()
  .min(4)
  .max(1_024)
  .refine((value) => isAbsolute(value), 'Path must be absolute')

const PortSchema = z.number().int().min(0).max(65_535)

export const RelayConfigurationSchema = z
  .object({
    stateDirectory: AbsolutePathSchema,
    listen: z
      .object({
        host: z.string().min(1).max(255).default('0.0.0.0'),
        port: PortSchema.default(443),
      })
      .strict()
      .default({ host: '0.0.0.0', port: 443 }),
    management: z
      .object({
        host: z.enum(['127.0.0.1', '::1', 'localhost']).default('127.0.0.1'),
        port: PortSchema,
      })
      .strict()
      .optional(),
    tls: z.discriminatedUnion('mode', [
      z
        .object({
          mode: z.literal('public_ca'),
          certificatePath: AbsolutePathSchema,
          privateKeyPath: AbsolutePathSchema,
        })
        .strict(),
      z.object({ mode: z.literal('pinned_identity') }).strict(),
    ]),
  })
  .strict()

export type RelayConfiguration = z.infer<typeof RelayConfigurationSchema>

export function loadRelayConfiguration(path: string): RelayConfiguration {
  const configPath = explicitAbsolutePath(path, 'Relay configuration')
  const raw = readBoundedFile(configPath, 64 * 1_024, 'Relay configuration')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    throw new Error('Relay configuration is not valid JSON')
  }
  return RelayConfigurationSchema.parse(parsed)
}

export async function resolveRelayTlsConfiguration(
  configuration: RelayConfiguration,
  applicationIdentity: RelayApplicationIdentity,
): Promise<{
  readonly certificatePem: Buffer
  readonly privateKeyPem: Buffer
}> {
  if (configuration.tls.mode === 'pinned_identity') {
    const identity = await generateRelayPinnedTlsIdentity(applicationIdentity)
    return {
      certificatePem: Buffer.from(identity.certificatePem, 'utf8'),
      privateKeyPem: Buffer.from(identity.privateKeyPem, 'utf8'),
    }
  }
  const certificatePem = readBoundedFile(
    configuration.tls.certificatePath,
    64 * 1_024,
    'Relay TLS certificate',
  )
  const privateKeyPem = readBoundedFile(
    configuration.tls.privateKeyPath,
    64 * 1_024,
    'Relay TLS private key',
  )
  if (
    process.platform !== 'win32' &&
    (statSync(configuration.tls.privateKeyPath).mode & 0o077) !== 0
  ) {
    throw new Error('Relay TLS private key permissions are too broad')
  }
  const certificate = new X509Certificate(certificatePem)
  const now = Date.now()
  if (
    Date.parse(certificate.validFrom) > now ||
    Date.parse(certificate.validTo) <= now
  ) {
    throw new Error('Relay TLS certificate is outside its validity period')
  }
  const certificateKey = certificate.publicKey.export({
    type: 'spki',
    format: 'der',
  })
  const privateKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: 'spki',
    format: 'der',
  })
  if (
    certificateKey.length !== privateKey.length ||
    !timingSafeEqual(certificateKey, privateKey)
  ) {
    throw new Error('Relay TLS certificate and private key do not match')
  }
  return { certificatePem, privateKeyPem }
}

function readBoundedFile(
  path: string,
  maximumBytes: number,
  label: string,
): Buffer {
  const absolute = explicitAbsolutePath(path, label)
  const stat = statSync(absolute)
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`${label} size is invalid`)
  }
  return readFileSync(absolute)
}

function explicitAbsolutePath(path: string, label: string): string {
  const absolute = resolve(path)
  if (!isAbsolute(path) || absolute !== path || absolute.length < 4) {
    throw new Error(`${label} path must be explicit and absolute`)
  }
  return absolute
}
