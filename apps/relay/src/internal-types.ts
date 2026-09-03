import type {
  RelayConnectionEpoch,
  RelayPeerId,
  RelayPeerRole,
  RelayPublicKeyFingerprint,
  RelayPublicKeySpki,
} from '@codetether/relay-protocol'

export type { RelayConnectionEpoch }

export interface RelayPeerRecord {
  readonly peerId: RelayPeerId
  readonly role: RelayPeerRole
  readonly publicKeySpki: RelayPublicKeySpki
  readonly fingerprint: RelayPublicKeyFingerprint
  readonly clientBuildIdentity: string
  readonly enrolledAt: string
  readonly lastSeenAt: string
  readonly revokedAt?: string
}
