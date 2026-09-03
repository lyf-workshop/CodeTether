import { createHash } from 'node:crypto'

import type { RelayChallengeMessage } from './messages.js'

const encoder = new TextEncoder()

export interface RelayEnrollmentTranscriptInput {
  readonly challenge: RelayChallengeMessage
  readonly role: 'controller' | 'node'
  readonly enrollmentToken: string
  readonly peerPublicKeySpki: string
  readonly peerFingerprint: string
  readonly clientBuildIdentity: string
  readonly authorizedControllerFingerprint?: string
}

export interface RelayAuthenticationTranscriptInput {
  readonly challenge: RelayChallengeMessage
  readonly peerFingerprint: string
  readonly role: 'controller' | 'node'
  readonly clientBuildIdentity: string
}

export function relayChallengeTranscript(
  challenge: Omit<RelayChallengeMessage, 'signature'>,
): Uint8Array {
  return transcript('CodeTether Relay challenge v1', [
    challenge.protocolVersion,
    challenge.relayId,
    challenge.relayPublicKeySpki,
    challenge.relayFingerprint,
    challenge.challengeId,
    challenge.nonce,
    challenge.issuedAt,
    challenge.expiresAt,
  ])
}

export function relayEnrollmentTranscript(
  input: RelayEnrollmentTranscriptInput,
): Uint8Array {
  return transcript('CodeTether Relay enrollment v1', [
    ...challengeFields(input.challenge),
    input.role,
    createHash('sha256')
      .update(input.enrollmentToken, 'utf8')
      .digest('base64url'),
    input.peerPublicKeySpki,
    input.peerFingerprint,
    input.clientBuildIdentity,
    input.authorizedControllerFingerprint ?? null,
  ])
}

export function relayAuthenticationTranscript(
  input: RelayAuthenticationTranscriptInput,
): Uint8Array {
  return transcript('CodeTether Relay authentication v1', [
    ...challengeFields(input.challenge),
    input.peerFingerprint,
    input.role,
    input.clientBuildIdentity,
  ])
}

function challengeFields(challenge: RelayChallengeMessage): unknown[] {
  return [
    challenge.protocolVersion,
    challenge.relayId,
    challenge.relayPublicKeySpki,
    challenge.relayFingerprint,
    challenge.challengeId,
    challenge.nonce,
    challenge.issuedAt,
    challenge.expiresAt,
  ]
}

function transcript(domain: string, values: readonly unknown[]): Uint8Array {
  return encoder.encode(`${domain}\0${JSON.stringify(values)}`)
}
