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
  connectRemoteSupervisor,
  disconnectRemoteSupervisor,
  readRemoteBootstrap,
  readRemoteMachines,
  readRemoteMachine,
  readRemoteProjects,
  readRemoteConversations,
  readRemoteConversation,
  readRemoteConversationHistory,
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

export async function connectSupervisorCheck(options: {
  readonly session: Session
  readonly host: AuthorizedHostDirectoryEntry
  readonly productDevice: ResolvedProductDevice
  readonly identity: ProductDeviceIdentityCapability
  readonly forceRelay: boolean
  readonly signal: AbortSignal
}): Promise<SupervisorReadConnection> {
  if (options.host.supervisor === null)
    throw new SupervisorCheckError('presence_unavailable')
  if (
    options.host.authorization.scope !== 'supervisor_read' ||
    options.host.supervisor.grant.payload.scope !== 'supervisor_read'
  )
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
  if (session.control !== 'read') {
    await disconnectRemoteSupervisor(session)
    throw new SupervisorCheckError('authorization_unavailable')
  }
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
