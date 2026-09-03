import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

import {
  type RelayApplicationIdentity,
  type RelayEnrollmentToken,
  RelayEnrollmentTokenSchema,
  RelayIdSchema,
  fingerprintRelayPublicKeySpki,
  type RelayPeerId,
  type RelayPeerRole,
  type RelayPublicKeyFingerprint,
  type RelayPublicKeySpki,
  RelayProtocolError,
  generateRelayApplicationIdentity,
  newRelayId,
  newRelayPeerId,
  validateRelayApplicationIdentity,
} from '@codetether/relay-protocol'

const schemaVersion = 1
const databaseFilename = 'relay.sqlite3'
const initializationMarkerFilename = 'relay-state-initialized'
const initializationMarkerContents = 'codetether-relay-state-v1\n'

interface MetadataRow {
  readonly key: string
  readonly value: string
}

interface EnrollmentTokenRow {
  readonly token_hash: string
  readonly role: string
  readonly expires_at: string
  readonly consumed_at: string | null
  readonly revoked_at: string | null
  readonly failed_attempts: number
}

export interface RelayEnrollmentGrant {
  readonly token: RelayEnrollmentToken
  readonly tokenReference: string
  readonly expiresAt: string
}

interface PeerRow {
  readonly peer_id: string
  readonly role: string
  readonly public_key_spki: string
  readonly fingerprint: string
  readonly client_build_identity: string
  readonly enrolled_at: string
  readonly last_seen_at: string
  readonly revoked_at: string | null
}

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

export interface RelayStateCounts {
  readonly enrolledControllers: number
  readonly enrolledNodes: number
  readonly revokedPeers: number
  readonly unconsumedTokens: number
}

export class RelayStateStore {
  readonly stateDirectory: string
  readonly databasePath: string
  readonly identity: RelayApplicationIdentity & {
    readonly relayId: ReturnType<typeof RelayIdSchema.parse>
  }
  readonly #database: DatabaseSync
  #closed = false

  constructor(stateDirectory: string) {
    this.stateDirectory = validateAbsoluteStateDirectory(stateDirectory)
    mkdirSync(this.stateDirectory, { recursive: true, mode: 0o700 })
    chmodSync(this.stateDirectory, 0o700)
    this.databasePath = join(this.stateDirectory, databaseFilename)
    const initializationMarkerPath = join(
      this.stateDirectory,
      initializationMarkerFilename,
    )
    const initializationMarkerExists = existsSync(initializationMarkerPath)
    if (initializationMarkerExists) {
      validateInitializationMarker(initializationMarkerPath)
    }
    const databaseExisted = existsSync(this.databasePath)
    if (initializationMarkerExists && !databaseExisted) {
      throw new Error(
        'Relay state database is missing from an initialized state directory',
      )
    }
    this.#database = new DatabaseSync(this.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    })
    chmodSync(this.databasePath, 0o600)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
    try {
      this.#migrate()
      this.identity = this.#loadOrCreateIdentity(databaseExisted)
      if (!initializationMarkerExists) {
        createInitializationMarker(initializationMarkerPath)
      }
    } catch (error) {
      this.#closed = true
      this.#database.close()
      throw error
    }
  }

  createEnrollmentToken(
    role: RelayPeerRole,
    options: { readonly ttlMs?: number; readonly now?: Date } = {},
  ): RelayEnrollmentToken {
    return this.createEnrollmentGrant(role, options).token
  }

  createEnrollmentGrant(
    role: RelayPeerRole,
    options: { readonly ttlMs?: number; readonly now?: Date } = {},
  ): RelayEnrollmentGrant {
    this.#assertOpen()
    const now = options.now ?? new Date()
    const ttlMs = options.ttlMs ?? 10 * 60_000
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > 24 * 60 * 60_000
    ) {
      throw new RangeError('Enrollment token lifetime is outside its bound')
    }
    const token = RelayEnrollmentTokenSchema.parse(
      `relay_enroll_${randomBytes(32).toString('base64url')}`,
    )
    const tokenReference = `relay_token_${randomBytes(18).toString('base64url')}`
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    this.#database
      .prepare(
        `INSERT INTO enrollment_tokens
         (token_hash, token_reference, role, created_at, expires_at,
          consumed_at, revoked_at, failed_attempts)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)`,
      )
      .run(
        tokenDigest(token),
        tokenReference,
        role,
        now.toISOString(),
        expiresAt,
      )
    return { token, tokenReference, expiresAt }
  }

  revokeEnrollmentToken(tokenReference: string, now = new Date()): boolean {
    this.#assertOpen()
    if (!/^relay_token_[A-Za-z0-9_-]{24}$/u.test(tokenReference)) {
      throw new Error('Relay enrollment token reference is invalid')
    }
    const result = this.#database
      .prepare(
        `UPDATE enrollment_tokens SET revoked_at = ?
         WHERE token_reference = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(now.toISOString(), tokenReference)
    return result.changes === 1
  }

  enroll(input: {
    readonly token: RelayEnrollmentToken
    readonly role: RelayPeerRole
    readonly publicKeySpki: RelayPublicKeySpki
    readonly fingerprint: RelayPublicKeyFingerprint
    readonly clientBuildIdentity: string
    readonly authorizedControllerFingerprint?: RelayPublicKeyFingerprint
    readonly now?: Date
  }): RelayPeerRecord {
    this.#assertOpen()
    if (
      fingerprintRelayPublicKeySpki(input.publicKeySpki) !== input.fingerprint
    ) {
      throw enrollmentFailure('identity_mismatch')
    }
    const now = input.now ?? new Date()
    const digest = tokenDigest(input.token)
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const token = this.#database
        .prepare(
          `SELECT token_hash, role, expires_at, consumed_at, revoked_at,
                  failed_attempts
           FROM enrollment_tokens WHERE token_hash = ?`,
        )
        .get(digest) as EnrollmentTokenRow | undefined
      if (token === undefined) throw enrollmentFailure('enrollment_invalid')
      if (token.consumed_at !== null) {
        throw enrollmentFailure('enrollment_consumed')
      }
      if (token.revoked_at !== null)
        throw enrollmentFailure('enrollment_invalid')
      if (token.role !== input.role) {
        throw enrollmentFailure('enrollment_invalid')
      }
      if (Date.parse(token.expires_at) <= now.getTime()) {
        throw enrollmentFailure('enrollment_expired')
      }
      if (token.failed_attempts >= 5) {
        throw enrollmentFailure('enrollment_invalid')
      }
      const existing = this.#findPeerRowByFingerprint(input.fingerprint)
      let peerId: RelayPeerId
      if (existing !== undefined) {
        if (
          existing.role !== input.role ||
          existing.public_key_spki !== input.publicKeySpki
        ) {
          throw enrollmentFailure('identity_mismatch')
        }
        peerId = existing.peer_id as RelayPeerId
        this.#database
          .prepare(
            `UPDATE peers SET
               client_build_identity = ?, enrolled_at = ?, last_seen_at = ?,
               revoked_at = NULL
             WHERE peer_id = ?`,
          )
          .run(
            input.clientBuildIdentity,
            now.toISOString(),
            now.toISOString(),
            peerId,
          )
      } else {
        peerId = newRelayPeerId()
        this.#database
          .prepare(
            `INSERT INTO peers
             (peer_id, role, public_key_spki, fingerprint, client_build_identity,
              enrolled_at, last_seen_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            peerId,
            input.role,
            input.publicKeySpki,
            input.fingerprint,
            input.clientBuildIdentity,
            now.toISOString(),
            now.toISOString(),
          )
      }
      if (input.role === 'node') {
        this.#replaceGrantWithinTransaction(
          peerId,
          input.authorizedControllerFingerprint,
          now,
        )
      }
      this.#database
        .prepare(
          'UPDATE enrollment_tokens SET consumed_at = ? WHERE token_hash = ?',
        )
        .run(now.toISOString(), digest)
      this.#database.exec('COMMIT')
      const result = this.getPeerByFingerprint(input.fingerprint)
      if (result === undefined)
        throw new Error('Enrolled Relay peer disappeared')
      return result
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  recordEnrollmentFailure(token: string): void {
    this.#assertOpen()
    const parsed = RelayEnrollmentTokenSchema.safeParse(token)
    if (!parsed.success) return
    this.#database
      .prepare(
        `UPDATE enrollment_tokens
         SET failed_attempts = MIN(failed_attempts + 1, 5)
         WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(tokenDigest(parsed.data))
  }

  getPeerByFingerprint(
    fingerprint: RelayPublicKeyFingerprint,
  ): RelayPeerRecord | undefined {
    this.#assertOpen()
    const row = this.#findPeerRowByFingerprint(fingerprint)
    return row === undefined ? undefined : peerRecord(row)
  }

  getPeerById(peerId: RelayPeerId): RelayPeerRecord | undefined {
    this.#assertOpen()
    const row = this.#database
      .prepare(
        `SELECT peer_id, role, public_key_spki, fingerprint,
                client_build_identity, enrolled_at, last_seen_at, revoked_at
         FROM peers WHERE peer_id = ?`,
      )
      .get(peerId) as PeerRow | undefined
    return row === undefined ? undefined : peerRecord(row)
  }

  recordAuthenticated(
    peerId: RelayPeerId,
    clientBuildIdentity: string,
    now = new Date(),
  ): void {
    this.#assertOpen()
    this.#database
      .prepare(
        `UPDATE peers SET client_build_identity = ?, last_seen_at = ?
         WHERE peer_id = ? AND revoked_at IS NULL`,
      )
      .run(clientBuildIdentity, now.toISOString(), peerId)
  }

  replaceGrant(
    nodePeerId: RelayPeerId,
    controllerFingerprint: RelayPublicKeyFingerprint | undefined,
    now = new Date(),
  ): void {
    this.#assertOpen()
    const node = this.getPeerById(nodePeerId)
    if (node?.role !== 'node' || node.revokedAt !== undefined) {
      throw new RelayProtocolError(
        'not_authorized',
        'Relay action is not authorized',
      )
    }
    this.#replaceGrantWithinTransaction(nodePeerId, controllerFingerprint, now)
  }

  canControllerObserveNode(
    controllerFingerprint: RelayPublicKeyFingerprint,
    nodeFingerprint: RelayPublicKeyFingerprint,
  ): boolean {
    this.#assertOpen()
    const row = this.#database
      .prepare(
        `SELECT 1 AS allowed
         FROM peers AS controller
         JOIN peers AS node ON node.fingerprint = ?
         JOIN rendezvous_grants AS grant ON grant.node_peer_id = node.peer_id
         WHERE controller.fingerprint = ?
           AND controller.role = 'controller'
           AND node.role = 'node'
           AND controller.revoked_at IS NULL
           AND node.revoked_at IS NULL
           AND grant.controller_fingerprint = ?`,
      )
      .get(nodeFingerprint, controllerFingerprint, controllerFingerprint) as
      { readonly allowed: number } | undefined
    return row?.allowed === 1
  }

  revokePeer(peerId: RelayPeerId, now = new Date()): boolean {
    this.#assertOpen()
    const result = this.#database
      .prepare(
        `UPDATE peers SET revoked_at = ?
         WHERE peer_id = ? AND revoked_at IS NULL`,
      )
      .run(now.toISOString(), peerId)
    return result.changes === 1
  }

  revokePeerByFingerprint(
    fingerprint: RelayPublicKeyFingerprint,
    now = new Date(),
  ): boolean {
    this.#assertOpen()
    const result = this.#database
      .prepare(
        `UPDATE peers SET revoked_at = ?
         WHERE fingerprint = ? AND revoked_at IS NULL`,
      )
      .run(now.toISOString(), fingerprint)
    return result.changes === 1
  }

  counts(now = new Date()): RelayStateCounts {
    this.#assertOpen()
    const row = this.#database
      .prepare(
        `SELECT
           SUM(CASE WHEN role = 'controller' AND revoked_at IS NULL THEN 1 ELSE 0 END) AS controllers,
           SUM(CASE WHEN role = 'node' AND revoked_at IS NULL THEN 1 ELSE 0 END) AS nodes,
           SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
         FROM peers`,
      )
      .get() as {
      readonly controllers: number | null
      readonly nodes: number | null
      readonly revoked: number | null
    }
    const tokens = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM enrollment_tokens
         WHERE consumed_at IS NULL AND revoked_at IS NULL
           AND expires_at > ? AND failed_attempts < 5`,
      )
      .get(now.toISOString()) as { readonly count: number }
    return {
      enrolledControllers: row.controllers ?? 0,
      enrolledNodes: row.nodes ?? 0,
      revokedPeers: row.revoked ?? 0,
      unconsumedTokens: tokens.count,
    }
  }

  async backupTo(destinationDirectory: string): Promise<string> {
    this.#assertOpen()
    const destination = resolve(destinationDirectory)
    mkdirSync(destination, { recursive: false, mode: 0o700 })
    chmodSync(destination, 0o700)
    const destinationPath = join(destination, databaseFilename)
    await backup(this.#database, destinationPath)
    chmodSync(destinationPath, 0o600)
    return destinationPath
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#database.close()
  }

  #migrate(): void {
    const version = this.#database.prepare('PRAGMA user_version').get() as {
      readonly user_version: number
    }
    if (version.user_version > schemaVersion) {
      throw new Error('Relay state schema is newer than this Relay build')
    }
    if (version.user_version === 0) {
      this.#database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE relay_metadata (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE enrollment_tokens (
          token_hash TEXT PRIMARY KEY NOT NULL,
          token_reference TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK (role IN ('controller', 'node')),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          revoked_at TEXT,
          failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5)
        ) STRICT;
        CREATE TABLE peers (
          peer_id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('controller', 'node')),
          public_key_spki TEXT NOT NULL,
          fingerprint TEXT NOT NULL UNIQUE,
          client_build_identity TEXT NOT NULL,
          enrolled_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          revoked_at TEXT
        ) STRICT;
        CREATE TABLE rendezvous_grants (
          node_peer_id TEXT PRIMARY KEY NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
          controller_fingerprint TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX relay_peers_role_active
          ON peers(role, revoked_at);
        CREATE INDEX relay_tokens_active
          ON enrollment_tokens(consumed_at, expires_at);
        PRAGMA user_version = 1;
        COMMIT;
      `)
    }
  }

  #loadOrCreateIdentity(databaseExisted: boolean): RelayStateStore['identity'] {
    const rows = this.#database
      .prepare('SELECT key, value FROM relay_metadata ORDER BY key')
      .all() as unknown as MetadataRow[]
    const metadata = new Map(rows.map((row) => [row.key, row.value]))
    const knownKeys = [
      'relay_id',
      'private_key_pem',
      'public_key_spki',
      'public_key_fingerprint',
    ] as const
    const values = knownKeys.map((key) => metadata.get(key))
    if (values.every((value) => value === undefined)) {
      if (databaseExisted) {
        throw new Error(
          'Relay identity is missing from an existing state database',
        )
      }
      const count = this.#database
        .prepare('SELECT COUNT(*) AS count FROM peers')
        .get() as { readonly count: number }
      if (count.count !== 0) {
        throw new Error(
          'Relay identity is missing from an initialized registry',
        )
      }
      const identity = generateRelayApplicationIdentity()
      const relayId = newRelayId()
      this.#database.exec('BEGIN IMMEDIATE')
      try {
        const insert = this.#database.prepare(
          'INSERT INTO relay_metadata (key, value) VALUES (?, ?)',
        )
        insert.run('relay_id', relayId)
        insert.run('private_key_pem', identity.privateKeyPem)
        insert.run('public_key_spki', identity.publicKeySpki)
        insert.run('public_key_fingerprint', identity.publicKeyFingerprint)
        this.#database.exec('COMMIT')
      } catch (error) {
        this.#database.exec('ROLLBACK')
        throw error
      }
      return { relayId, ...identity }
    }
    if (values.some((value) => value === undefined)) {
      throw new Error('Relay identity metadata is incomplete')
    }
    const identity = validateRelayApplicationIdentity({
      privateKeyPem: metadata.get('private_key_pem'),
      publicKeySpki: metadata.get('public_key_spki'),
      publicKeyFingerprint: metadata.get('public_key_fingerprint'),
    })
    return {
      relayId: RelayIdSchema.parse(metadata.get('relay_id')),
      ...identity,
    }
  }

  #findPeerRowByFingerprint(
    fingerprint: RelayPublicKeyFingerprint,
  ): PeerRow | undefined {
    return this.#database
      .prepare(
        `SELECT peer_id, role, public_key_spki, fingerprint,
                client_build_identity, enrolled_at, last_seen_at, revoked_at
         FROM peers WHERE fingerprint = ?`,
      )
      .get(fingerprint) as PeerRow | undefined
  }

  #replaceGrantWithinTransaction(
    nodePeerId: RelayPeerId,
    controllerFingerprint: RelayPublicKeyFingerprint | undefined,
    now: Date,
  ): void {
    if (controllerFingerprint === undefined) {
      this.#database
        .prepare('DELETE FROM rendezvous_grants WHERE node_peer_id = ?')
        .run(nodePeerId)
      return
    }
    this.#database
      .prepare(
        `INSERT INTO rendezvous_grants
         (node_peer_id, controller_fingerprint, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(node_peer_id) DO UPDATE SET
           controller_fingerprint = excluded.controller_fingerprint,
           updated_at = excluded.updated_at`,
      )
      .run(nodePeerId, controllerFingerprint, now.toISOString())
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Relay state store is closed')
  }
}

function peerRecord(row: PeerRow): RelayPeerRecord {
  return {
    peerId: row.peer_id as RelayPeerId,
    role: row.role as RelayPeerRole,
    publicKeySpki: row.public_key_spki as RelayPublicKeySpki,
    fingerprint: row.fingerprint as RelayPublicKeyFingerprint,
    clientBuildIdentity: row.client_build_identity,
    enrolledAt: row.enrolled_at,
    lastSeenAt: row.last_seen_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  }
}

function tokenDigest(token: RelayEnrollmentToken): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

function validateAbsoluteStateDirectory(directory: string): string {
  const absolute = resolve(directory)
  if (absolute !== directory || absolute.length < 4) {
    throw new Error('Relay state directory must be an explicit absolute path')
  }
  try {
    if (!statSync(absolute).isDirectory()) {
      throw new Error('Relay state path is not a directory')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  return absolute
}

function validateInitializationMarker(path: string): void {
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error('Relay state initialization marker is unreadable', {
      cause: error,
    })
  }
  if (contents !== initializationMarkerContents) {
    throw new Error('Relay state initialization marker is invalid')
  }
}

function createInitializationMarker(path: string): void {
  try {
    writeFileSync(path, initializationMarkerContents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // Another first-install initializer may have completed after this
    // process opened the database. Only the one exact marker is accepted.
    validateInitializationMarker(path)
  }
  chmodSync(path, 0o600)
}

function enrollmentFailure(
  code: ConstructorParameters<typeof RelayProtocolError>[0],
) {
  return new RelayProtocolError(code, 'Relay enrollment failed')
}
