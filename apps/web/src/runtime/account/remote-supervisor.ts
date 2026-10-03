import type { Session } from '@supabase/supabase-js'
import {
  RemoteConversationHistoryPageSchema,
  RemoteConversationLivePageSchema,
  type RemoteConversationHistoryPage,
  type RemoteConversationLivePage,
} from '@codetether/protocol'

import { hostBaseUrl } from '../host/host-config.js'
import type {
  HostIdentityCapability,
  ProductDeviceIdentityCapability,
} from '../native/native-capabilities.js'
import {
  base64Url,
  canonicalJsonBytes,
  createDeviceRequestProof,
  listHostSupervisorAuthorizations,
  postAuthenticatedProductDeviceJson,
  utf8,
  type AuthorizedHostDirectoryEntry,
  type OwnedHostAccessEntry,
  type ResolvedProductDevice,
  type SignedSupervisorGrant,
  type SignedSupervisorTransportDescriptor,
  type SupervisorHostPresencePayload,
} from './control-plane-client.js'

const GRANT_TYPE = 'codetether-host-supervisor-grant+jws'
const DESCRIPTOR_TYPE = 'codetether-host-supervisor-transport+jws'

export interface LocalHostIdentityRecord {
  readonly hostId: string
  readonly publicJwk: string
  readonly fingerprint: string
  readonly keyHandle: string
  readonly identityGeneration: number
}

export interface RemoteSupervisorSession {
  readonly hostId: string
  readonly sessionId: string
  readonly expiresAt: string
  readonly transport: 'direct' | 'relay'
  readonly control: 'read' | 'control'
  readonly bootstrap: unknown
  readonly machines: unknown
}

export interface RemoteProjectDirectoryItem {
  readonly projectId: string
  readonly machineId: string
  readonly name: string
  readonly conversationCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RemoteProjectDirectoryPage {
  readonly projects: readonly RemoteProjectDirectoryItem[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export interface RemoteConversationDirectoryItem {
  readonly conversationId: string
  readonly projectId: string
  readonly machineId: string
  readonly title: string
  readonly titleSource: 'generated' | 'manual'
  readonly origin: 'codetether' | 'adopted_native'
  readonly provider: 'codex' | 'claude-code'
  readonly status: 'idle' | 'running' | 'waiting' | 'completed' | 'failed'
  readonly archived: boolean
  readonly nativeSessionBound: boolean
  readonly resumability: 'resumable' | 'unavailable'
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastActivityAt: string
}

export interface RemoteConversationDirectoryPage {
  readonly conversations: readonly RemoteConversationDirectoryItem[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export async function readLocalHostIdentity(): Promise<
  LocalHostIdentityRecord | undefined
> {
  const response = await fetch(`${hostBaseUrl}/api/v1/host/identity`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error('local_host_identity_unavailable')
  const value = (await response.json()) as {
    readonly identity?: {
      readonly hostId?: unknown
      readonly fingerprint?: unknown
      readonly identityGeneration?: unknown
      readonly publicJwk?: unknown
      readonly keyHandle?: unknown
    }
  }
  const identity = value.identity
  if (
    typeof identity?.hostId !== 'string' ||
    typeof identity.fingerprint !== 'string' ||
    !Number.isSafeInteger(identity.identityGeneration) ||
    typeof identity.publicJwk !== 'string' ||
    typeof identity.keyHandle !== 'string'
  ) {
    throw new Error('local_host_identity_invalid')
  }
  return identity as LocalHostIdentityRecord
}

const remoteSessions = new Map<string, RemoteSupervisorSession>()
const reconnectContexts = new Map<string, RemoteSupervisorReconnectContext>()
const reconnects = new Map<string, Promise<RemoteSupervisorSession>>()

interface RemoteSupervisorReconnectContext {
  readonly session: Session
  readonly host: AuthorizedHostDirectoryEntry
  readonly productDevice: ResolvedProductDevice
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly forceRelay?: boolean
}

export function currentRemoteSupervisorSession(
  hostId: string,
): RemoteSupervisorSession | undefined {
  const session = remoteSessions.get(hostId)
  if (session !== undefined && Date.parse(session.expiresAt) > Date.now()) {
    return session
  }
  return undefined
}

async function closeRemoteSupervisorSession(
  hostId: string,
  session: RemoteSupervisorSession,
): Promise<void> {
  await fetch(
    `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}`,
    { method: 'DELETE' },
  ).catch(() => undefined)
  if (remoteSessions.get(hostId) === session) remoteSessions.delete(hostId)
}

export async function publishLocalSupervisorPresence(options: {
  readonly session: Session
  readonly controlPlaneBaseUrl: string
  readonly host: Pick<
    OwnedHostAccessEntry,
    'hostId' | 'spaceId' | 'fingerprint' | 'identityGeneration'
  >
  readonly localIdentity: LocalHostIdentityRecord
  readonly productDevice: ResolvedProductDevice
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly hostIdentity: HostIdentityCapability
  readonly signal?: AbortSignal
}): Promise<void> {
  const hostPublicJwk = parsePublicJwk(options.localIdentity.publicJwk)
  if (
    options.host.hostId !== options.localIdentity.hostId ||
    options.host.fingerprint !== options.localIdentity.fingerprint ||
    options.host.identityGeneration !== options.localIdentity.identityGeneration
  ) {
    throw new Error('local_host_identity_mismatch')
  }

  const authorizations = await listHostSupervisorAuthorizations({
    accessToken: options.session.access_token,
    baseUrl: options.controlPlaneBaseUrl,
    identity: options.deviceIdentity,
    productDevice: options.productDevice,
    hostId: options.host.hostId,
    signal: options.signal,
  })
  const presence = await readJson(`${hostBaseUrl}/api/v1/supervisor/presence`, {
    signal: options.signal,
  })
  const transportTlsFingerprint = boundedString(
    presence,
    'transportTlsFingerprint',
  )
  const directEndpoints = parseDirectEndpoints(presence.directEndpoints)
  const relay = parseRelayPresence(presence.relay)
  const now = Math.floor(Date.now() / 1_000)
  const descriptorPayload: SupervisorHostPresencePayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_presence',
    hostId: options.host.hostId,
    hostFingerprint: options.host.fingerprint,
    hostIdentityGeneration: options.host.identityGeneration,
    spaceId: options.host.spaceId,
    transportTlsFingerprint,
    controlPlaneOrigin: new URL(options.controlPlaneBaseUrl).origin,
    directEndpoints,
    relay,
    iat: now,
    exp: now + 600,
    protocolVersion: 2,
  }
  const descriptor: SignedSupervisorTransportDescriptor = {
    payload: descriptorPayload,
    proof: await signHostProof(
      options.hostIdentity,
      options.localIdentity.keyHandle,
      DESCRIPTOR_TYPE,
      descriptorPayload,
    ),
  }
  for (const authorization of authorizations) {
    if (
      authorization.hostId !== options.host.hostId ||
      authorization.hostIdentityGeneration !==
        options.host.identityGeneration ||
      authorization.spaceId !== options.host.spaceId ||
      authorization.userId !== options.productDevice.device.ownerUserId ||
      authorization.scope !== 'supervisor_read' ||
      Date.parse(authorization.expiresAt) <= Date.now()
    ) {
      throw new Error('host_supervisor_authorization_mismatch')
    }
  }
  // Remove revoked/expired activations before any signing or publication work.
  // A later transient failure cannot leave a removed device active locally.
  await postLocalJson('/api/v1/supervisor/activations/prune', {
    authorizationIds: authorizations.map(
      ({ authorizationId }) => authorizationId,
    ),
  })
  for (const authorization of authorizations) {
    const payload = {
      v: 1 as const,
      aud: 'codetether-host-supervisor' as const,
      purpose: 'host_supervisor_grant' as const,
      authorizationId: authorization.authorizationId,
      hostId: authorization.hostId,
      hostFingerprint: options.host.fingerprint,
      hostIdentityGeneration: authorization.hostIdentityGeneration,
      deviceId: authorization.deviceId,
      deviceFingerprint: authorization.deviceFingerprint,
      deviceKeyGeneration: authorization.deviceKeyGeneration,
      userId: authorization.userId,
      spaceId: authorization.spaceId,
      scope: authorization.scope,
      authorizationSerial: authorization.serial,
      authorizationGeneration: authorization.generation,
      issuedAt: Math.floor(Date.parse(authorization.issuedAt) / 1_000),
      expiresAt: Math.floor(Date.parse(authorization.expiresAt) / 1_000),
    }
    if (
      authorization.grant !== null &&
      canonicalJsonBytes(authorization.grant.payload).toString() !==
        canonicalJsonBytes(payload).toString()
    ) {
      throw new Error('host_supervisor_grant_mismatch')
    }
    const grant: SignedSupervisorGrant = authorization.grant ?? {
      payload,
      proof: await signHostProof(
        options.hostIdentity,
        options.localIdentity.keyHandle,
        GRANT_TYPE,
        payload,
      ),
    }
    if (authorization.grant === null) {
      await postAuthenticatedProductDeviceJson({
        accessToken: options.session.access_token,
        baseUrl: options.controlPlaneBaseUrl,
        identity: options.deviceIdentity,
        productDevice: options.productDevice,
        resource: `/v1/hosts/${options.host.hostId}/supervisor-grant/materialize`,
        value: grant,
        signal: options.signal,
      })
    }
    await postLocalJson('/api/v1/supervisor/activate', {
      hostPublicJwk,
      grant,
      descriptor,
    })
  }
  await postAuthenticatedProductDeviceJson({
    accessToken: options.session.access_token,
    baseUrl: options.controlPlaneBaseUrl,
    identity: options.deviceIdentity,
    productDevice: options.productDevice,
    resource: `/v1/hosts/${options.host.hostId}/supervisor-host-presence`,
    value: descriptor,
    signal: options.signal,
  })
}

export async function connectRemoteSupervisor(options: {
  readonly session: Session
  readonly host: AuthorizedHostDirectoryEntry
  readonly productDevice: ResolvedProductDevice
  readonly deviceIdentity: ProductDeviceIdentityCapability
  readonly forceRelay?: boolean
  readonly signal?: AbortSignal
}): Promise<RemoteSupervisorSession> {
  reconnectContexts.set(options.host.hostId, {
    session: options.session,
    host: options.host,
    productDevice: options.productDevice,
    deviceIdentity: options.deviceIdentity,
    ...(options.forceRelay === undefined
      ? {}
      : { forceRelay: options.forceRelay }),
  })
  const cached = remoteSessions.get(options.host.hostId)
  const existing = currentRemoteSupervisorSession(options.host.hostId)
  if (
    existing !== undefined &&
    (options.forceRelay !== true || existing.transport === 'relay')
  ) {
    return existing
  }
  if (cached !== undefined) {
    await closeRemoteSupervisorSession(options.host.hostId, cached)
  }
  if (options.host.supervisor === null) {
    throw new Error('remote_supervisor_presence_unavailable')
  }
  const pending = await postLocalJson('/api/v1/remote-supervisor/connections', {
    hostId: options.host.hostId,
    hostFingerprint: options.host.fingerprint,
    hostIdentityGeneration: options.host.identityGeneration,
    hostPublicJwk: options.host.publicKey,
    deviceId: options.productDevice.device.deviceId,
    deviceKeyGeneration: options.productDevice.device.keyGeneration,
    grant: options.host.supervisor.grant,
    descriptor: options.host.supervisor.transport,
    ...(options.forceRelay === true ? { forceRelay: true } : {}),
  })
  const connectionId = boundedString(pending, 'connectionId')
  const admissionResource = boundedString(pending, 'admissionResource')
  const challengeBody = decodeBase64Url(
    boundedString(pending, 'challengeBodyBase64Url'),
  )
  const proof = await createDeviceRequestProof({
    accessToken: options.session.access_token,
    deviceId: options.productDevice.device.deviceId,
    keyGeneration: options.productDevice.device.keyGeneration,
    keyHandle: options.productDevice.key.keyHandle,
    identity: options.deviceIdentity,
    method: 'POST',
    resource: admissionResource,
    body: challengeBody,
  })
  const authenticated = await postLocalJson(
    `/api/v1/remote-supervisor/connections/${encodeURIComponent(connectionId)}/authenticate`,
    { accessToken: options.session.access_token, deviceProof: proof },
  )
  const sessionId = boundedString(authenticated, 'sessionId')
  const expiresAt = boundedString(authenticated, 'expiresAt')
  const transport = boundedString(pending, 'transport')
  if (transport !== 'direct' && transport !== 'relay') {
    throw new Error('Supervisor response is invalid')
  }
  const control = boundedString(authenticated, 'control')
  if (control !== 'read' && control !== 'control') {
    throw new Error('Supervisor response is invalid')
  }
  const [bootstrap, machines] = await Promise.all([
    readJson(
      `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(sessionId)}/bootstrap`,
    ),
    readJson(
      `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(sessionId)}/machines`,
    ),
  ])
  const connected: RemoteSupervisorSession = {
    hostId: options.host.hostId,
    sessionId,
    expiresAt,
    transport,
    control,
    bootstrap,
    machines,
  }
  remoteSessions.set(options.host.hostId, connected)
  return connected
}

/**
 * Replaces a lost read session through the same authenticated Direct/Relay
 * selection. Calls for one Host coalesce so React retries cannot create
 * parallel ProductDevice sessions.
 */
export async function reconnectRemoteSupervisor(
  hostId: string,
  signal?: AbortSignal,
): Promise<RemoteSupervisorSession> {
  const pending = reconnects.get(hostId)
  if (pending !== undefined) return await pending
  const context = reconnectContexts.get(hostId)
  if (context === undefined) {
    throw new Error('remote_supervisor_reconnect_unavailable')
  }
  const reconnect = (async () => {
    const current = remoteSessions.get(hostId)
    if (current !== undefined) {
      await closeRemoteSupervisorSession(hostId, current)
    }
    return await connectRemoteSupervisor({ ...context, signal })
  })()
  reconnects.set(hostId, reconnect)
  try {
    return await reconnect
  } finally {
    if (reconnects.get(hostId) === reconnect) reconnects.delete(hostId)
  }
}

export async function readRemoteMachine(
  hostId: string,
  machineId: string,
): Promise<unknown> {
  const session = currentRemoteSupervisorSession(hostId)
  if (session === undefined) {
    const expired = remoteSessions.get(hostId)
    if (expired !== undefined) {
      await closeRemoteSupervisorSession(hostId, expired)
    }
    throw new Error('remote_supervisor_session_expired')
  }
  return await readJson(
    `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/machines/${encodeURIComponent(machineId)}`,
  )
}

export async function readRemoteProjects(
  hostId: string,
  machineId: string,
  page: { readonly limit: number; readonly cursor?: string },
): Promise<RemoteProjectDirectoryPage> {
  const session = requireRemoteSupervisorSession(hostId)
  const query = directoryQuery(page)
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects?${query}`,
  )
  const result = parseProjectPage(value)
  if (result.projects.some((project) => project.machineId !== machineId)) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return result
}

export async function readRemoteProject(
  hostId: string,
  machineId: string,
  projectId: string,
): Promise<RemoteProjectDirectoryItem> {
  const session = requireRemoteSupervisorSession(hostId)
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects/${encodeURIComponent(projectId)}`,
  )
  const project = parseProject(asRecord(value.project))
  if (project.machineId !== machineId || project.projectId !== projectId) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return project
}

export async function readRemoteConversations(
  hostId: string,
  machineId: string,
  projectId: string,
  page: { readonly limit: number; readonly cursor?: string },
): Promise<RemoteConversationDirectoryPage> {
  const session = requireRemoteSupervisorSession(hostId)
  const query = directoryQuery(page)
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects/${encodeURIComponent(projectId)}/conversations?${query}`,
  )
  const result = parseConversationPage(value)
  if (
    result.conversations.some(
      (conversation) =>
        conversation.machineId !== machineId ||
        conversation.projectId !== projectId,
    )
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return result
}

export async function readRemoteConversation(
  hostId: string,
  machineId: string,
  projectId: string,
  conversationId: string,
): Promise<RemoteConversationDirectoryItem> {
  const session = requireRemoteSupervisorSession(hostId)
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
  )
  const conversation = parseConversation(asRecord(value.conversation))
  if (
    conversation.machineId !== machineId ||
    conversation.projectId !== projectId ||
    conversation.conversationId !== conversationId
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return conversation
}

export async function readRemoteConversationHistory(
  hostId: string,
  machineId: string,
  projectId: string,
  conversationId: string,
  page: { readonly limit: number; readonly cursor?: string },
  signal?: AbortSignal,
): Promise<RemoteConversationHistoryPage> {
  const session = requireRemoteSupervisorSession(hostId)
  const query = directoryQuery(page)
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/history?${query}`,
    { signal },
  )
  const result = RemoteConversationHistoryPageSchema.parse(value)
  if (result.conversationId !== conversationId) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return result
}

export async function readRemoteConversationLive(
  hostId: string,
  machineId: string,
  projectId: string,
  conversationId: string,
  query: {
    readonly cursor: string
    readonly limit?: number
    readonly waitMs?: number
  },
  signal?: AbortSignal,
): Promise<RemoteConversationLivePage> {
  const session = requireRemoteSupervisorSession(hostId)
  const search = new URLSearchParams({
    cursor: query.cursor,
    limit: String(query.limit ?? 64),
    waitMs: String(query.waitMs ?? 10_000),
  })
  const value = await readJson(
    `${remoteMachineBaseUrl(session, machineId)}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/live?${search.toString()}`,
    { signal },
  )
  const result = RemoteConversationLivePageSchema.parse(value)
  if (result.conversationId !== conversationId) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return result
}

export interface RemoteActionState {
  readonly actionId: string
  readonly status: 'not_found' | 'accepted' | 'running' | 'completed' | 'failed'
  readonly conversationId?: string
  readonly turnId?: string
}

export async function readRemoteAction(
  hostId: string,
  actionId: string,
): Promise<RemoteActionState> {
  const session = requireRemoteSupervisorSession(hostId)
  const value = await readJson(
    `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/actions/${encodeURIComponent(actionId)}`,
  )
  const returnedActionId = boundedString(value, 'actionId')
  const status = boundedString(value, 'status')
  if (
    returnedActionId !== actionId ||
    !['not_found', 'accepted', 'running', 'completed', 'failed'].includes(
      status,
    )
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  const conversationId = optionalString(value, 'conversationId')
  const turnId = optionalString(value, 'turnId')
  return {
    actionId: returnedActionId,
    status: status as RemoteActionState['status'],
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(turnId === undefined ? {} : { turnId }),
  }
}

export async function startRemoteConversationTurn(options: {
  readonly hostId: string
  readonly machineId: string
  readonly projectId: string
  readonly conversationId: string
  readonly actionId: string
  readonly input: { readonly type: 'text'; readonly text: string }
}): Promise<unknown> {
  const session = requireRemoteSupervisorSession(options.hostId)
  return await postLocalJson(
    `/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/machines/${encodeURIComponent(options.machineId)}/projects/${encodeURIComponent(options.projectId)}/conversations/${encodeURIComponent(options.conversationId)}/turns`,
    {
      actionId: options.actionId,
      input: options.input,
    },
  )
}

export async function createRemoteConversation(options: {
  readonly hostId: string
  readonly machineId: string
  readonly projectId: string
  readonly provider: 'codex' | 'claude-code'
  readonly actionId: string
  readonly input: { readonly type: 'text'; readonly text: string }
  readonly model?: string
  readonly reasoning?: string
}): Promise<unknown> {
  const session = requireRemoteSupervisorSession(options.hostId)
  return await postLocalJson(
    `/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/machines/${encodeURIComponent(options.machineId)}/projects/${encodeURIComponent(options.projectId)}/conversations`,
    {
      actionId: options.actionId,
      provider: options.provider,
      input: options.input,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.reasoning === undefined
        ? {}
        : { reasoning: options.reasoning }),
    },
  )
}

function requireRemoteSupervisorSession(
  hostId: string,
): RemoteSupervisorSession {
  const session = currentRemoteSupervisorSession(hostId)
  if (session === undefined)
    throw new Error('remote_supervisor_session_expired')
  return session
}

function remoteMachineBaseUrl(
  session: RemoteSupervisorSession,
  machineId: string,
): string {
  return `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/machines/${encodeURIComponent(machineId)}`
}

function directoryQuery(page: {
  readonly limit: number
  readonly cursor?: string
}): string {
  const query = new URLSearchParams({ limit: String(page.limit) })
  if (page.cursor !== undefined) query.set('cursor', page.cursor)
  return query.toString()
}

function parseProjectPage(
  value: Record<string, unknown>,
): RemoteProjectDirectoryPage {
  if (!Array.isArray(value.projects) || typeof value.hasMore !== 'boolean') {
    throw new Error('remote_supervisor_response_invalid')
  }
  const nextCursor = optionalString(value, 'nextCursor')
  if (value.hasMore !== (nextCursor !== undefined)) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return {
    projects: value.projects.map((project) => parseProject(asRecord(project))),
    hasMore: value.hasMore,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

function parseProject(
  value: Record<string, unknown>,
): RemoteProjectDirectoryItem {
  const conversationCount = value.conversationCount
  if (
    !Number.isSafeInteger(conversationCount) ||
    Number(conversationCount) < 0
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return {
    projectId: boundedString(value, 'projectId'),
    machineId: boundedString(value, 'machineId'),
    name: boundedString(value, 'name'),
    conversationCount: Number(conversationCount),
    createdAt: timestampField(value, 'createdAt'),
    updatedAt: timestampField(value, 'updatedAt'),
  }
}

function parseConversationPage(
  value: Record<string, unknown>,
): RemoteConversationDirectoryPage {
  if (
    !Array.isArray(value.conversations) ||
    typeof value.hasMore !== 'boolean'
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  const nextCursor = optionalString(value, 'nextCursor')
  if (value.hasMore !== (nextCursor !== undefined)) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return {
    conversations: value.conversations.map((conversation) =>
      parseConversation(asRecord(conversation)),
    ),
    hasMore: value.hasMore,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

function parseConversation(
  value: Record<string, unknown>,
): RemoteConversationDirectoryItem {
  const titleSource = boundedString(value, 'titleSource')
  const origin = boundedString(value, 'origin')
  const provider = boundedString(value, 'provider')
  const status = boundedString(value, 'status')
  const resumability = boundedString(value, 'resumability')
  if (
    (titleSource !== 'generated' && titleSource !== 'manual') ||
    (origin !== 'codetether' && origin !== 'adopted_native') ||
    (provider !== 'codex' && provider !== 'claude-code') ||
    !['idle', 'running', 'waiting', 'completed', 'failed'].includes(status) ||
    (resumability !== 'resumable' && resumability !== 'unavailable') ||
    typeof value.archived !== 'boolean' ||
    typeof value.nativeSessionBound !== 'boolean'
  ) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return {
    conversationId: boundedString(value, 'conversationId'),
    projectId: boundedString(value, 'projectId'),
    machineId: boundedString(value, 'machineId'),
    title: boundedString(value, 'title'),
    titleSource,
    origin,
    provider,
    status: status as RemoteConversationDirectoryItem['status'],
    archived: value.archived,
    nativeSessionBound: value.nativeSessionBound,
    resumability,
    createdAt: timestampField(value, 'createdAt'),
    updatedAt: timestampField(value, 'updatedAt'),
    lastActivityAt: timestampField(value, 'lastActivityAt'),
  }
}

function timestampField(value: Record<string, unknown>, key: string): string {
  const timestamp = boundedString(value, key)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error('remote_supervisor_response_invalid')
  }
  return timestamp
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return value[key] === undefined ? undefined : boundedString(value, key)
}

async function signHostProof(
  identity: HostIdentityCapability,
  keyHandle: string,
  type: string,
  payload: unknown,
): Promise<string> {
  const header = base64Url(utf8(JSON.stringify({ alg: 'ES256', typ: type })))
  const encodedPayload = base64Url(canonicalJsonBytes(payload))
  const signingInput = `${header}.${encodedPayload}`
  const signature = await identity.sign(
    keyHandle,
    base64Url(utf8(signingInput)),
  )
  return `${signingInput}.${signature.signatureBase64Url}`
}

async function postLocalJson(
  path: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${hostBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
  if (!response.ok)
    throw new Error(`remote_supervisor_${String(response.status)}`)
  return asRecord(await response.json())
}

async function readJson(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  if (!response.ok)
    throw new Error(`remote_supervisor_${String(response.status)}`)
  return asRecord(await response.json())
}

function parsePublicJwk(value: string): {
  readonly crv: 'P-256'
  readonly kty: 'EC'
  readonly x: string
  readonly y: string
} {
  const key = asRecord(JSON.parse(value))
  if (
    key.kty !== 'EC' ||
    key.crv !== 'P-256' ||
    typeof key.x !== 'string' ||
    typeof key.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(key.x) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(key.y)
  ) {
    throw new Error('Local Host public key is invalid')
  }
  return { crv: 'P-256', kty: 'EC', x: key.x, y: key.y }
}

function parseDirectEndpoints(value: unknown): readonly {
  readonly host: string
  readonly port: number
}[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error('Supervisor presence is invalid')
  }
  return value.map((entry) => {
    const record = asRecord(entry)
    const host = boundedString(record, 'host')
    if (!Number.isInteger(record.port) || Number(record.port) < 1) {
      throw new Error('Supervisor presence is invalid')
    }
    return { host, port: Number(record.port) }
  })
}

function parseRelayPresence(
  value: unknown,
): SupervisorHostPresencePayload['relay'] {
  if (value === null) return null
  const relay = asRecord(value)
  const endpoint = boundedString(relay, 'endpoint')
  const relayId = boundedString(relay, 'relayId')
  const relayFingerprint = boundedString(relay, 'relayFingerprint')
  const rendezvousId = boundedString(relay, 'rendezvousId')
  const rendezvousCapability = boundedString(relay, 'rendezvousCapability')
  const hostTransportFingerprint = boundedString(
    relay,
    'hostTransportFingerprint',
  )
  if (
    !/^relay_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(relayId) ||
    !/^srv_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(rendezvousId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(relayFingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(rendezvousCapability) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(hostTransportFingerprint)
  ) {
    throw new Error('Supervisor presence is invalid')
  }
  return {
    endpoint,
    relayId,
    relayFingerprint,
    rendezvousId,
    rendezvousCapability,
    hostTransportFingerprint,
  }
}

function boundedString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (
    typeof field !== 'string' ||
    field.length === 0 ||
    field.length > 16_384
  ) {
    throw new Error('Supervisor response is invalid')
  }
  return field
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Supervisor response is invalid')
  }
  return value as Record<string, unknown>
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Supervisor response is invalid')
  }
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
