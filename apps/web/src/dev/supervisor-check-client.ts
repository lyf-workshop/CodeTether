import type { Session } from '@supabase/supabase-js'
import {
  GetMachineResponseSchema,
  ListMachinesResponseSchema,
} from '@codetether/protocol'

import { controlPlaneBaseUrl } from '../runtime/account/account-config.js'
import {
  ControlPlaneClientError,
  listAuthorizedHosts,
  resolveExistingProductDevice,
  type AuthorizedHostDirectoryEntry,
  type ResolvedProductDevice,
} from '../runtime/account/control-plane-client.js'
import {
  readClaimedPairingSession,
  redeemPairingCode,
  type PairingDeviceContext,
  type RedeemPairingCode,
} from '../runtime/account/pairing-client.js'
import { waitForPairingPoll } from '../runtime/account/pairing-flow.js'
import {
  connectRemoteSupervisor,
  disconnectRemoteSupervisor,
  readRemoteBootstrap,
  readRemoteMachines,
  readRemoteMachine,
  readRemoteProjects,
  readRemoteConversations,
  readRemoteConversation,
  readRemoteConversationHistory,
  type RemoteSupervisorSession,
} from '../runtime/account/remote-supervisor.js'
import type { ProductDeviceIdentityCapability } from '../runtime/native/native-capabilities.js'
import {
  SupervisorCheckError,
  type SupervisorReadConnection,
} from './supervisor-check-model.js'

export interface SupervisorCheckDirectory {
  readonly productDevice: ResolvedProductDevice
  readonly hosts: readonly AuthorizedHostDirectoryEntry[]
}

export type SupervisorCheckPairing =
  | {
      readonly status: 'paired'
      readonly directory: SupervisorCheckDirectory
      readonly hostId: string
    }
  | {
      readonly status:
        'invalid_code' | 'expired' | 'used' | 'cancelled' | 'rate_limited'
      readonly remainingAttempts?: number
    }

export async function pairSupervisorCheckDevice(options: {
  readonly session: Session
  readonly identity: ProductDeviceIdentityCapability
  readonly signal: AbortSignal
  readonly code: string
  readonly allowRegistration: boolean
}): Promise<SupervisorCheckPairing> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(330_000)])
  const productDevice = await resolveExistingProductDevice({
    accessToken: options.session.access_token,
    baseUrl: controlPlaneBaseUrl,
    identity: options.identity,
    signal,
    existingOnly: !options.allowRegistration,
  })
  const context: PairingDeviceContext = {
    session: options.session,
    controlPlaneBaseUrl,
    deviceIdentity: options.identity,
    productDevice,
    signal,
  }
  let claim: RedeemPairingCode = await redeemPairingCode(context, options.code)
  if ('remainingAttempts' in claim) return claim
  while (claim.status === 'claimed') {
    await waitForPairingPoll(signal)
    claim = await readClaimedPairingSession(context, claim)
  }
  if (
    claim.status === 'cancelled' ||
    claim.status === 'expired' ||
    claim.status === 'rate_limited'
  )
    return { status: claim.status }
  if (claim.status !== 'paired')
    throw new SupervisorCheckError('invalid_response')
  // The Host signs and materializes the grant after finishing the pairing.
  const grantSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)])
  for (;;) {
    const hosts = await listAuthorizedHosts({
      accessToken: options.session.access_token,
      baseUrl: controlPlaneBaseUrl,
      identity: options.identity,
      productDevice,
      signal: grantSignal,
    })
    if (
      hosts.some(
        (host) =>
          host.hostId === claim.hostId &&
          host.authorization.scope === 'supervisor_control' &&
          host.supervisor?.grant.payload.scope === 'supervisor_control',
      )
    ) {
      return {
        status: 'paired',
        directory: { productDevice, hosts },
        hostId: claim.hostId,
      }
    }
    await waitForPairingPoll(grantSignal)
  }
}

export async function loadSupervisorCheckDirectory(options: {
  readonly session: Session
  readonly identity: ProductDeviceIdentityCapability
  readonly signal: AbortSignal
}): Promise<SupervisorCheckDirectory> {
  try {
    const productDevice = await resolveExistingProductDevice({
      accessToken: options.session.access_token,
      baseUrl: controlPlaneBaseUrl,
      identity: options.identity,
      signal: options.signal,
      existingOnly: true,
    })
    const hosts = await listAuthorizedHosts({
      accessToken: options.session.access_token,
      baseUrl: controlPlaneBaseUrl,
      identity: options.identity,
      productDevice,
      signal: options.signal,
    })
    return { productDevice, hosts }
  } catch (error) {
    if (error instanceof ControlPlaneClientError) {
      if (error.code.startsWith('product_device_'))
        throw new SupervisorCheckError('identity_unavailable')
      if (error.status === 401)
        throw new SupervisorCheckError('authentication_required')
      if (error.status === 403)
        throw new SupervisorCheckError('authorization_unavailable')
    }
    throw error
  }
}

export interface SupervisorCheckConnectionOptions {
  readonly session: Session
  readonly host: AuthorizedHostDirectoryEntry
  readonly productDevice: ResolvedProductDevice
  readonly identity: ProductDeviceIdentityCapability
  readonly forceRelay: boolean
  readonly signal: AbortSignal
}

export async function openSupervisorCheckSession(
  options: SupervisorCheckConnectionOptions,
): Promise<RemoteSupervisorSession> {
  if (options.host.supervisor === null)
    throw new SupervisorCheckError('presence_unavailable')
  const scope = options.host.authorization.scope
  if (options.host.supervisor.grant.payload.scope !== scope)
    throw new SupervisorCheckError('authorization_unavailable')
  const session = await connectRemoteSupervisor({
    session: options.session,
    host: options.host,
    productDevice: options.productDevice,
    deviceIdentity: options.identity,
    forceRelay: options.forceRelay,
    signal: options.signal,
    detached: true,
  })
  if (
    session.control !== (scope === 'supervisor_control' ? 'control' : 'read')
  ) {
    await disconnectRemoteSupervisor(session)
    throw new SupervisorCheckError('authorization_unavailable')
  }
  if (options.forceRelay && session.transport !== 'relay') {
    await disconnectRemoteSupervisor(session)
    throw new SupervisorCheckError('unexpected_transport')
  }
  return session
}

export async function connectSupervisorCheck(
  options: SupervisorCheckConnectionOptions,
): Promise<SupervisorReadConnection> {
  const session = await openSupervisorCheckSession(options)
  return {
    transport: session.transport,
    bootstrap: async (signal) => {
      await readRemoteBootstrap(session, signal)
    },
    machines: async (signal) => {
      const result = ListMachinesResponseSchema.safeParse(
        await readRemoteMachines(session, signal),
      )
      if (!result.success) {
        throw new SupervisorCheckError('invalid_response')
      }
      // Prefer the selected Host's canonical local Machine; paired Machines
      // need not have an available Project on this Host.
      return [
        ...result.data.machines.filter((machine) => machine.isLocal),
        ...result.data.machines.filter((machine) => !machine.isLocal),
      ].map((machine) => machine.machineId)
    },
    machine: async (machineId, signal) => {
      const result = GetMachineResponseSchema.safeParse(
        await readRemoteMachine(session, machineId, signal),
      )
      if (!result.success || result.data.machine.machineId !== machineId)
        throw new SupervisorCheckError('invalid_response')
    },
    projects: async (machineId, signal) =>
      (
        await readRemoteProjects(session, machineId, { limit: 1 }, signal)
      ).projects.map((project) => project.projectId),
    conversations: async (machineId, projectId, signal) =>
      (
        await readRemoteConversations(
          session,
          machineId,
          projectId,
          { limit: 1 },
          signal,
        )
      ).conversations.map((conversation) => conversation.conversationId),
    conversation: async (machineId, projectId, conversationId, signal) => {
      await readRemoteConversation(
        session,
        machineId,
        projectId,
        conversationId,
        signal,
      )
    },
    history: async (machineId, projectId, conversationId, signal) => {
      await readRemoteConversationHistory(
        session,
        machineId,
        projectId,
        conversationId,
        { limit: 1 },
        signal,
      )
    },
    close: () => disconnectRemoteSupervisor(session),
  }
}
