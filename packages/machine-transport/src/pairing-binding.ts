import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { machineProtocolVersion } from './constants.js'
import { MachineTransportError } from './errors.js'
import { ControllerIdSchema, PairingAttemptIdSchema } from './ids.js'
import {
  PublicKeyFingerprintSchema,
  RemoteMachineMetadataSchema,
} from './messages.js'

const PairingTranscriptSchema = z
  .object({
    protocolVersion: z.literal(machineProtocolVersion),
    attemptId: PairingAttemptIdSchema,
    machine: RemoteMachineMetadataSchema,
    controllerId: ControllerIdSchema,
    nodeFingerprint: PublicKeyFingerprintSchema,
    controllerFingerprint: PublicKeyFingerprintSchema,
    nodeNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    controllerNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    tlsExporter: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
export type PairingTranscript = z.infer<typeof PairingTranscriptSchema>

export function pairingConfirmationTag(
  sessionKey: Buffer,
  role:
    'controller-confirm' | 'node-ack' | 'controller-cancel' | 'node-cancelled',
  transcript: PairingTranscript,
): string {
  const parsed = PairingTranscriptSchema.parse(transcript)
  if (sessionKey.length !== 64)
    throw new TypeError('Pairing session key is invalid')
  const canonical = canonicalTranscript(parsed)
  const salt = createHmac('sha256', Buffer.from('CodeTether pairing salt v1'))
    .update(canonical)
    .digest()
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      sessionKey,
      salt,
      Buffer.from('CodeTether machine pairing confirmation v1'),
      32,
    ),
  )
  try {
    return createHmac('sha256', key)
      .update(`CodeTether ${role} v1\0`, 'utf8')
      .update(canonical)
      .digest('base64url')
  } finally {
    key.fill(0)
    salt.fill(0)
  }
}

export function verifyPairingConfirmationTag(
  sessionKey: Buffer,
  role:
    'controller-confirm' | 'node-ack' | 'controller-cancel' | 'node-cancelled',
  transcript: PairingTranscript,
  candidate: string,
): void {
  const expected = Buffer.from(
    pairingConfirmationTag(sessionKey, role, transcript),
    'ascii',
  )
  const actual = Buffer.from(candidate, 'ascii')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new MachineTransportError(
      'authentication_failed',
      'Pairing confirmation failed',
    )
  }
}

/** A short human-comparison value derived from the authenticated channel. */
export function pairingVerificationCode(
  sessionKey: Buffer,
  transcript: PairingTranscript,
): string {
  const tag = createHmac('sha256', sessionKey)
    .update('CodeTether pairing verification v1\0', 'utf8')
    .update(canonicalTranscript(PairingTranscriptSchema.parse(transcript)))
    .digest()
  return String(tag.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

function canonicalTranscript(value: PairingTranscript): Buffer {
  return Buffer.from(
    JSON.stringify({
      protocolVersion: value.protocolVersion,
      attemptId: value.attemptId,
      machine: {
        machineId: value.machine.machineId,
        nodeId: value.machine.nodeId,
        displayName: value.machine.displayName,
        platform: value.machine.platform,
        architecture: value.machine.architecture,
      },
      controllerId: value.controllerId,
      nodeFingerprint: value.nodeFingerprint,
      controllerFingerprint: value.controllerFingerprint,
      nodeNonce: value.nodeNonce,
      controllerNonce: value.controllerNonce,
      tlsExporter: value.tlsExporter,
    }),
    'utf8',
  )
}
