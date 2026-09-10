import {
  ActionIdSchema,
  AttentionIdSchema,
  AttentionListResponseSchema,
  ArchiveConversationRequestSchema,
  ArchiveConversationResponseSchema,
  BeginRemoteMachinePairingRequestSchema,
  BeginRemoteMachinePairingResponseSchema,
  BootstrapSchema,
  CancelRemoteMachinePairingRequestSchema,
  CancelRemoteMachinePairingResponseSchema,
  ConfirmRemoteMachinePairingRequestSchema,
  ConfirmRemoteMachinePairingResponseSchema,
  ConfigureMachineRelayRequestSchema,
  ConfigureMachineRelayResponseSchema,
  ApprovalIdSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationSearchQuerySchema,
  ConversationSearchResponseSchema,
  CreateConversationRequestSchema,
  CreateConversationResponseSchema,
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  CreateRemoteProjectRequestSchema,
  CreateRemoteProjectResponseSchema,
  DisconnectMachineRelayRequestSchema,
  DisconnectMachineRelayResponseSchema,
  DiscoverProviderSessionsQuerySchema,
  DiscoverProviderSessionsResponseSchema,
  EnrollMachineRelayRequestSchema,
  EnrollMachineRelayResponseSchema,
  RegisterProjectLocationRequestSchema,
  RegisterProjectLocationResponseSchema,
  RemoveProjectLocationRequestSchema,
  RemoveProjectLocationResponseSchema,
  RefreshMachineProvidersRequestSchema,
  RefreshMachineProvidersResponseSchema,
  ReadNativeTranscriptQuerySchema,
  ReadNativeTranscriptResponseSchema,
  DeleteProjectRequestSchema,
  DeleteProjectResponseSchema,
  GetMachineResponseSchema,
  GetDoctorQuerySchema,
  GetDoctorResponseSchema,
  GetOnboardingResponseSchema,
  GetProjectResponseSchema,
  GetConversationResponseSchema,
  HostSnapshotSchema,
  InterruptTurnRequestSchema,
  InterruptTurnResponseSchema,
  LastEventIdSchema,
  ListAttentionQuerySchema,
  ListMachinesResponseSchema,
  ListProjectsResponseSchema,
  ListProjectConversationsQuerySchema,
  PinConversationRequestSchema,
  PinConversationResponseSchema,
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  ProjectIdSchema,
  ResolveApprovalRequestSchema,
  ResolveApprovalResponseSchema,
  ResolveAttentionRequestSchema,
  ResolveAttentionResponseSchema,
  RenameConversationRequestSchema,
  RenameConversationResponseSchema,
  RetryMachineConnectionRequestSchema,
  RetryMachineConnectionResponseSchema,
  RetryMachineRelayRequestSchema,
  RetryMachineRelayResponseSchema,
  SafeErrorEnvelopeSchema,
  StartTurnRequestSchema,
  StartTurnResponseSchema,
  TurnIdSchema,
  UpdateMachineConnectionAddressRequestSchema,
  UpdateMachineConnectionAddressResponseSchema,
  AdoptProviderSessionRequestSchema,
  AdoptProviderSessionResponseSchema,
  UnpairMachineRequestSchema,
  UnpairMachineResponseSchema,
  RemoveMachineRelayRequestSchema,
  RemoveMachineRelayResponseSchema,
  UnarchiveConversationRequestSchema,
  UnarchiveConversationResponseSchema,
  UnpinConversationRequestSchema,
  UnpinConversationResponseSchema,
  UpdateOnboardingRequestSchema,
  UpdateOnboardingResponseSchema,
  type ActionId,
  type ApprovalId,
  type AttentionId,
  type AttentionListResponse,
  type ArchiveConversationRequest,
  type ArchiveConversationResponse,
  type BeginRemoteMachinePairingRequest,
  type BeginRemoteMachinePairingResponse,
  type Bootstrap,
  type CancelRemoteMachinePairingRequest,
  type CancelRemoteMachinePairingResponse,
  type ConfirmRemoteMachinePairingRequest,
  type ConfirmRemoteMachinePairingResponse,
  type ConfigureMachineRelayRequest,
  type ConfigureMachineRelayResponse,
  type ConversationId,
  type ConversationListResponse,
  type ConversationSearchQuery,
  type ConversationSearchResponse,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CreateRemoteProjectRequest,
  type CreateRemoteProjectResponse,
  type DisconnectMachineRelayRequest,
  type DisconnectMachineRelayResponse,
  type DiscoverProviderSessionsQuery,
  type DiscoverProviderSessionsResponse,
  type EnrollMachineRelayRequest,
  type EnrollMachineRelayResponse,
  type RegisterProjectLocationRequest,
  type RegisterProjectLocationResponse,
  type RemoveProjectLocationRequest,
  type RemoveProjectLocationResponse,
  type RefreshMachineProvidersRequest,
  type RefreshMachineProvidersResponse,
  type ReadNativeTranscriptQuery,
  type ReadNativeTranscriptResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type GetMachineResponse,
  type GetDoctorQuery,
  type GetDoctorResponse,
  type GetOnboardingResponse,
  type GetProjectResponse,
  type GetConversationResponse,
  type HostSnapshot,
  type InterruptTurnRequest,
  type InterruptTurnResponse,
  type LastEventId,
  type ListAttentionQuery,
  type ListMachinesResponse,
  type ListProjectsResponse,
  type ListProjectConversationsQuery,
  type MachineId,
  type MachinePairingAttemptId,
  type ProjectId,
  type PinConversationRequest,
  type PinConversationResponse,
  type ResolveApprovalRequest,
  type ResolveApprovalResponse,
  type ResolveAttentionResponse,
  type RenameConversationRequest,
  type RenameConversationResponse,
  type RetryMachineConnectionRequest,
  type RetryMachineConnectionResponse,
  type RetryMachineRelayRequest,
  type RetryMachineRelayResponse,
  type StartTurnRequest,
  type StartTurnResponse,
  type TurnId,
  type UpdateMachineConnectionAddressRequest,
  type UpdateMachineConnectionAddressResponse,
  type AdoptProviderSessionRequest,
  type AdoptProviderSessionResponse,
  type UnpairMachineRequest,
  type UnpairMachineResponse,
  type RemoveMachineRelayRequest,
  type RemoveMachineRelayResponse,
  type UnarchiveConversationRequest,
  type UnarchiveConversationResponse,
  type UnpinConversationRequest,
  type UnpinConversationResponse,
  type UpdateOnboardingRequest,
  type UpdateOnboardingResponse,
  protocolVersion,
} from '@codetether/protocol'

import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from './errors.js'
import { CodeTetherEventStream, linkedAbortController } from './event-stream.js'

interface RuntimeSchema<T> {
  parse(value: unknown): T
}

export interface CodeTetherClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly maxResponseBytes?: number
  readonly maxEventFrameBytes?: number
}

export interface RequestOptions {
  readonly signal?: AbortSignal
}

export interface ConnectEventsOptions extends RequestOptions {
  readonly lastEventId?: LastEventId
}

export interface ListProjectConversationsOptions extends RequestOptions {
  readonly provider?: ListProjectConversationsQuery['provider']
  readonly status?: ListProjectConversationsQuery['status']
  readonly archived?: boolean | 'all'
  readonly limit?: ListProjectConversationsQuery['limit']
}

export interface SearchProjectConversationsOptions extends RequestOptions {
  readonly query: ConversationSearchQuery['q']
  readonly archive?: ConversationSearchQuery['archive']
  readonly provider?: ConversationSearchQuery['provider']
  readonly status?: ConversationSearchQuery['status']
  readonly limit?: ConversationSearchQuery['limit']
  readonly cursor?: ConversationSearchQuery['cursor']
}

export interface ListAttentionOptions extends RequestOptions {
  readonly projectId?: ListAttentionQuery['projectId']
  readonly type?: ListAttentionQuery['type']
  readonly status?: ListAttentionQuery['status']
  readonly limit?: ListAttentionQuery['limit']
}

export interface DiscoverProviderSessionsOptions extends RequestOptions {
  readonly provider?: DiscoverProviderSessionsQuery['provider']
  readonly limit?: DiscoverProviderSessionsQuery['limit']
  readonly cursor?: DiscoverProviderSessionsQuery['cursor']
  readonly rescan?: boolean
}

export interface ReadNativeTranscriptOptions extends RequestOptions {
  readonly limit?: ReadNativeTranscriptQuery['limit']
  readonly cursor?: ReadNativeTranscriptQuery['cursor']
}

export interface GetDoctorOptions extends RequestOptions {
  readonly projectId?: GetDoctorQuery['projectId']
  /** Explicit bounded factual check; ordinary Doctor reads leave this false. */
  readonly check?: boolean
}

export class CodeTetherClient {
  readonly #baseUrl: string
  readonly #fetch: typeof globalThis.fetch
  readonly #maxResponseBytes: number
  readonly #maxEventFrameBytes: number

  constructor(options: CodeTetherClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    const fetchImplementation = options.fetch ?? globalThis.fetch
    if (fetchImplementation === undefined) {
      throw new Error('CodeTetherClient requires a Fetch API implementation')
    }
    this.#fetch = fetchImplementation.bind(globalThis)
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes,
      64 * 1024 * 1024,
      'maxResponseBytes',
    )
    this.#maxEventFrameBytes = positiveInteger(
      options.maxEventFrameBytes,
      10 * 1024 * 1024,
      'maxEventFrameBytes',
    )
  }

  async bootstrap(options: RequestOptions = {}): Promise<Bootstrap> {
    return await this.#request(
      '/api/v1/bootstrap',
      BootstrapSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
      undefined,
      assertCompatibleBootstrapVersion,
    )
  }

  async snapshot(options: RequestOptions = {}): Promise<HostSnapshot> {
    return await this.#request('/api/v1/snapshot', HostSnapshotSchema, {
      method: 'GET',
      signal: options.signal,
    })
  }

  async getOnboarding(
    options: RequestOptions = {},
  ): Promise<GetOnboardingResponse> {
    return await this.#request(
      '/api/v1/onboarding',
      GetOnboardingResponseSchema,
      { method: 'GET', signal: options.signal },
    )
  }

  async updateOnboarding(
    input: UpdateOnboardingRequest,
    options: RequestOptions = {},
  ): Promise<UpdateOnboardingResponse> {
    const request = parseProtocol(
      UpdateOnboardingRequestSchema,
      input,
      'update-onboarding request',
    )
    return await this.#request(
      '/api/v1/onboarding',
      UpdateOnboardingResponseSchema,
      { ...jsonRequest(request, options.signal), method: 'PATCH' },
      request.actionId,
    )
  }

  async getDoctor(options: GetDoctorOptions = {}): Promise<GetDoctorResponse> {
    const query = parseProtocol(
      GetDoctorQuerySchema,
      {
        ...(options.projectId === undefined
          ? {}
          : { projectId: options.projectId }),
        ...(options.check === true ? { check: 'true' as const } : {}),
      },
      'get-doctor query',
    )
    const search = new URLSearchParams()
    if (query.projectId !== undefined) search.set('projectId', query.projectId)
    if (query.check !== undefined) search.set('check', query.check)
    return await this.#request(
      `/api/v1/doctor${search.size === 0 ? '' : `?${search.toString()}`}`,
      GetDoctorResponseSchema,
      { method: 'GET', signal: options.signal },
    )
  }

  async listMachines(
    options: RequestOptions = {},
  ): Promise<ListMachinesResponse> {
    return await this.#request('/api/v1/machines', ListMachinesResponseSchema, {
      method: 'GET',
      signal: options.signal,
    })
  }

  async getMachine(
    machineId: MachineId,
    options: RequestOptions = {},
  ): Promise<GetMachineResponse> {
    const machine = parseProtocol(MachineIdSchema, machineId, 'get-machine id')
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}`,
      GetMachineResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.machine.machineId === machine,
      'Machine response does not match the requested Machine',
    )
    return response
  }

  async beginRemoteMachinePairing(
    input: BeginRemoteMachinePairingRequest,
    options: RequestOptions = {},
  ): Promise<BeginRemoteMachinePairingResponse> {
    const request = parseProtocol(
      BeginRemoteMachinePairingRequestSchema,
      input,
      'begin-remote-machine-pairing request',
    )
    return await this.#request(
      '/api/v1/machine-pairings',
      BeginRemoteMachinePairingResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
  }

  async confirmRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    input: ConfirmRemoteMachinePairingRequest,
    options: RequestOptions = {},
  ): Promise<ConfirmRemoteMachinePairingResponse> {
    const attempt = parseProtocol(
      MachinePairingAttemptIdSchema,
      pairingAttemptId,
      'confirm-remote-machine-pairing id',
    )
    const request = parseProtocol(
      ConfirmRemoteMachinePairingRequestSchema,
      input,
      'confirm-remote-machine-pairing request',
    )
    const response = await this.#request(
      `/api/v1/machine-pairings/${encodeURIComponent(attempt)}/confirm`,
      ConfirmRemoteMachinePairingResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.machine.kind === 'remote',
      'Pairing response did not return a remote Machine',
    )
    return response
  }

  async cancelRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    input: CancelRemoteMachinePairingRequest,
    options: RequestOptions = {},
  ): Promise<CancelRemoteMachinePairingResponse> {
    const attempt = parseProtocol(
      MachinePairingAttemptIdSchema,
      pairingAttemptId,
      'cancel-remote-machine-pairing id',
    )
    const request = parseProtocol(
      CancelRemoteMachinePairingRequestSchema,
      input,
      'cancel-remote-machine-pairing request',
    )
    const response = await this.#request(
      `/api/v1/machine-pairings/${encodeURIComponent(attempt)}`,
      CancelRemoteMachinePairingResponseSchema,
      { ...jsonRequest(request, options.signal), method: 'DELETE' },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.pairingAttemptId === attempt,
      'Cancel pairing response does not match the requested attempt',
    )
    return response
  }

  async unpairMachine(
    machineId: MachineId,
    input: UnpairMachineRequest,
    options: RequestOptions = {},
  ): Promise<UnpairMachineResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'unpair-machine id',
    )
    const request = parseProtocol(
      UnpairMachineRequestSchema,
      input,
      'unpair-machine request',
    )
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/trust`,
      UnpairMachineResponseSchema,
      { ...jsonRequest(request, options.signal), method: 'DELETE' },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.machineId === machine,
      'Unpair response does not match the requested Machine',
    )
    return response
  }

  async retryMachineConnection(
    machineId: MachineId,
    input: RetryMachineConnectionRequest,
    options: RequestOptions = {},
  ): Promise<RetryMachineConnectionResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'retry-machine-connection id',
    )
    const request = parseProtocol(
      RetryMachineConnectionRequestSchema,
      input,
      'retry-machine-connection request',
    )
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/connection/retry`,
      RetryMachineConnectionResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertMachineConnectionMutationIdentity(response, machine)
    return response
  }

  async refreshMachineProviders(
    machineId: MachineId,
    input: RefreshMachineProvidersRequest,
    options: RequestOptions = {},
  ): Promise<RefreshMachineProvidersResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'refresh-machine-providers id',
    )
    const request = parseProtocol(
      RefreshMachineProvidersRequestSchema,
      input,
      'refresh-machine-providers request',
    )
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/providers/refresh`,
      RefreshMachineProvidersResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.machineId === machine &&
        response.data.providerDiscovery.state === 'current',
      'Provider refresh response does not match the requested Machine',
    )
    return response
  }

  async updateMachineConnectionAddress(
    machineId: MachineId,
    input: UpdateMachineConnectionAddressRequest,
    options: RequestOptions = {},
  ): Promise<UpdateMachineConnectionAddressResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'update-machine-connection-address id',
    )
    const request = parseProtocol(
      UpdateMachineConnectionAddressRequestSchema,
      input,
      'update-machine-connection-address request',
    )
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/connection/address`,
      UpdateMachineConnectionAddressResponseSchema,
      { ...jsonRequest(request, options.signal), method: 'PUT' },
      request.actionId,
    )
    assertMachineConnectionMutationIdentity(response, machine)
    return response
  }

  async configureMachineRelay(
    machineId: MachineId,
    input: ConfigureMachineRelayRequest,
    options: RequestOptions = {},
  ): Promise<ConfigureMachineRelayResponse> {
    return await this.#machineRelayMutation(
      machineId,
      input,
      ConfigureMachineRelayRequestSchema,
      ConfigureMachineRelayResponseSchema,
      { method: 'PUT', suffix: '' },
      options,
    )
  }

  async enrollMachineRelay(
    machineId: MachineId,
    input: EnrollMachineRelayRequest,
    options: RequestOptions = {},
  ): Promise<EnrollMachineRelayResponse> {
    return await this.#machineRelayMutation(
      machineId,
      input,
      EnrollMachineRelayRequestSchema,
      EnrollMachineRelayResponseSchema,
      { method: 'POST', suffix: '/enroll' },
      options,
    )
  }

  async retryMachineRelay(
    machineId: MachineId,
    input: RetryMachineRelayRequest,
    options: RequestOptions = {},
  ): Promise<RetryMachineRelayResponse> {
    return await this.#machineRelayMutation(
      machineId,
      input,
      RetryMachineRelayRequestSchema,
      RetryMachineRelayResponseSchema,
      { method: 'POST', suffix: '/retry' },
      options,
    )
  }

  async disconnectMachineRelay(
    machineId: MachineId,
    input: DisconnectMachineRelayRequest,
    options: RequestOptions = {},
  ): Promise<DisconnectMachineRelayResponse> {
    return await this.#machineRelayMutation(
      machineId,
      input,
      DisconnectMachineRelayRequestSchema,
      DisconnectMachineRelayResponseSchema,
      { method: 'POST', suffix: '/disconnect' },
      options,
    )
  }

  async removeMachineRelay(
    machineId: MachineId,
    input: RemoveMachineRelayRequest,
    options: RequestOptions = {},
  ): Promise<RemoveMachineRelayResponse> {
    return await this.#machineRelayMutation(
      machineId,
      input,
      RemoveMachineRelayRequestSchema,
      RemoveMachineRelayResponseSchema,
      { method: 'DELETE', suffix: '' },
      options,
    )
  }

  async #machineRelayMutation<
    TRequest extends { readonly actionId: ActionId },
    TResponse extends {
      readonly data: { readonly machineId: MachineId }
    },
  >(
    machineId: MachineId,
    input: TRequest,
    requestSchema: RuntimeSchema<TRequest>,
    responseSchema: RuntimeSchema<TResponse>,
    route: {
      readonly method: 'POST' | 'PUT' | 'DELETE'
      readonly suffix: string
    },
    options: RequestOptions,
  ): Promise<TResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'machine-relay id',
    )
    const request = parseProtocol(requestSchema, input, 'machine-relay request')
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/relay${route.suffix}`,
      responseSchema,
      { ...jsonRequest(request, options.signal), method: route.method },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.machineId === machine,
      'Relay response does not match the requested Machine',
    )
    return response
  }

  async listProjects(
    options: RequestOptions = {},
  ): Promise<ListProjectsResponse> {
    return await this.#request('/api/v1/projects', ListProjectsResponseSchema, {
      method: 'GET',
      signal: options.signal,
    })
  }

  async getProject(
    projectId: ProjectId,
    options: RequestOptions = {},
  ): Promise<GetProjectResponse> {
    const project = parseProtocol(ProjectIdSchema, projectId, 'get-project id')
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}`,
      GetProjectResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.project.projectId === project,
      'Project response does not match the requested Project',
    )
    return response
  }

  async listProjectConversations(
    projectId: ProjectId,
    options: ListProjectConversationsOptions = {},
  ): Promise<ConversationListResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'list-project-conversations project id',
    )
    const query = parseProtocol(
      ListProjectConversationsQuerySchema,
      {
        ...(options.provider === undefined
          ? {}
          : { provider: options.provider }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.archived === undefined
          ? {}
          : { archived: String(options.archived) }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      },
      'list-project-conversations query',
    )
    const search = new URLSearchParams({ limit: String(query.limit) })
    if (query.provider !== undefined) search.set('provider', query.provider)
    if (query.status !== undefined) search.set('status', query.status)
    search.set('archived', query.archived)

    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/conversations?${search.toString()}`,
      ConversationListResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.conversations.every(
        (conversation) => conversation.projectId === project,
      ),
      'Conversation list contains a Conversation from another Project',
    )
    assertProtocolIdentity(
      query.archived === 'all' ||
        response.conversations.every(
          (conversation) =>
            (conversation.archivedAt !== undefined) ===
            (query.archived === 'true'),
        ),
      'Conversation list contains a Conversation outside the requested archive filter',
    )
    return response
  }

  async searchProjectConversations(
    projectId: ProjectId,
    options: SearchProjectConversationsOptions,
  ): Promise<ConversationSearchResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'search-project-conversations project id',
    )
    const query = parseProtocol(
      ConversationSearchQuerySchema,
      {
        q: options.query,
        ...(options.archive === undefined ? {} : { archive: options.archive }),
        ...(options.provider === undefined
          ? {}
          : { provider: options.provider }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      'search-project-conversations query',
    )
    const search = new URLSearchParams({
      q: query.q,
      archive: query.archive,
      limit: String(query.limit),
    })
    if (query.provider !== undefined) search.set('provider', query.provider)
    if (query.status !== undefined) search.set('status', query.status)
    if (query.cursor !== undefined) search.set('cursor', query.cursor)

    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/conversations/search?${search.toString()}`,
      ConversationSearchResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.results.every(
        (result) => result.conversation.projectId === project,
      ),
      'Conversation search contains a Conversation from another Project',
    )
    assertProtocolIdentity(
      response.results.every((result) => {
        const isArchived = result.conversation.archivedAt !== undefined
        return (
          query.archive === 'all' ||
          (query.archive === 'archived' ? isArchived : !isArchived)
        )
      }),
      'Conversation search contains a Conversation outside the requested archive filter',
    )
    if (query.provider !== undefined) {
      assertProtocolIdentity(
        response.results.every(
          (result) => result.conversation.provider === query.provider,
        ),
        'Conversation search contains a Conversation outside the requested provider filter',
      )
    }
    if (query.status !== undefined) {
      assertProtocolIdentity(
        response.results.every(
          (result) => result.conversation.status === query.status,
        ),
        'Conversation search contains a Conversation outside the requested status filter',
      )
    }
    if (query.cursor !== undefined && response.nextCursor !== undefined) {
      assertProtocolIdentity(
        response.nextCursor !== query.cursor,
        'Conversation search returned the same pagination cursor',
      )
    }
    return response
  }

  async getConversation(
    conversationId: ConversationId,
    options: RequestOptions = {},
  ): Promise<GetConversationResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'get-conversation id',
    )
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}`,
      GetConversationResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    assertProtocolIdentity(
      response.conversation.conversationId === conversation,
      'Conversation response does not match the requested Conversation',
    )
    return response
  }

  async readNativeTranscript(
    conversationId: ConversationId,
    options: ReadNativeTranscriptOptions = {},
  ): Promise<ReadNativeTranscriptResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'read-native-transcript conversation id',
    )
    const query = parseProtocol(
      ReadNativeTranscriptQuerySchema,
      {
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      'read-native-transcript query',
    )
    const search = new URLSearchParams({ limit: String(query.limit) })
    if (query.cursor !== undefined) search.set('cursor', query.cursor)
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}/native-transcript?${search.toString()}`,
      ReadNativeTranscriptResponseSchema,
      { method: 'GET', signal: options.signal },
    )
    assertProtocolIdentity(
      response.conversationId === conversation &&
        response.entries.every(
          (entry) => entry.conversationId === conversation,
        ),
      'Native transcript response does not match the requested Conversation',
    )
    if (query.cursor !== undefined && response.nextCursor !== undefined) {
      assertProtocolIdentity(
        response.nextCursor !== query.cursor,
        'Native transcript returned the same pagination cursor',
      )
    }
    return response
  }

  async listAttention(
    options: ListAttentionOptions = {},
  ): Promise<AttentionListResponse> {
    const query = parseProtocol(
      ListAttentionQuerySchema,
      {
        ...(options.projectId === undefined
          ? {}
          : { projectId: options.projectId }),
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      },
      'list-attention query',
    )
    const search = new URLSearchParams({
      status: query.status,
      limit: String(query.limit),
    })
    if (query.projectId !== undefined) {
      search.set('projectId', query.projectId)
    }
    if (query.type !== undefined) search.set('type', query.type)

    const response = await this.#request(
      `/api/v1/attention?${search.toString()}`,
      AttentionListResponseSchema,
      {
        method: 'GET',
        signal: options.signal,
      },
    )
    if (query.projectId !== undefined) {
      assertProtocolIdentity(
        response.items.every((item) => item.projectId === query.projectId),
        'Attention list contains an item from another Project',
      )
    }
    return response
  }

  async createProject(
    input: CreateProjectRequest,
    options: RequestOptions = {},
  ): Promise<CreateProjectResponse> {
    const request = parseProtocol(
      CreateProjectRequestSchema,
      input,
      'create-project request',
    )
    return await this.#request(
      '/api/v1/projects',
      CreateProjectResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
  }

  async createRemoteProject(
    machineId: MachineId,
    input: CreateRemoteProjectRequest,
    options: RequestOptions = {},
  ): Promise<CreateRemoteProjectResponse> {
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'create-remote-project machine id',
    )
    const request = parseProtocol(
      CreateRemoteProjectRequestSchema,
      input,
      'create-remote-project request',
    )
    const response = await this.#request(
      `/api/v1/machines/${encodeURIComponent(machine)}/projects`,
      CreateRemoteProjectResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.location.machineId === machine,
      'Create remote Project response does not match the requested Machine',
    )
    assertProtocolIdentity(
      response.data.location.projectId === response.data.project.projectId,
      'Create remote Project response contains mismatched Project identity',
    )
    return response
  }

  async deleteProject(
    projectId: ProjectId,
    input: DeleteProjectRequest,
    options: RequestOptions = {},
  ): Promise<DeleteProjectResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'delete-project id',
    )
    const request = parseProtocol(
      DeleteProjectRequestSchema,
      input,
      'delete-project request',
    )
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}`,
      DeleteProjectResponseSchema,
      {
        ...jsonRequest(request, options.signal),
        method: 'DELETE',
      },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.projectId === project,
      'Delete Project response does not match the requested Project',
    )
    return response
  }

  async registerProjectLocation(
    projectId: ProjectId,
    input: RegisterProjectLocationRequest,
    options: RequestOptions = {},
  ): Promise<RegisterProjectLocationResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'register-project-location project id',
    )
    const request = parseProtocol(
      RegisterProjectLocationRequestSchema,
      input,
      'register-project-location request',
    )
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/locations`,
      RegisterProjectLocationResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.project.projectId === project &&
        response.data.location.projectId === project,
      'Register ProjectLocation response does not match the requested Project',
    )
    assertProtocolIdentity(
      response.data.location.machineId === request.machineId,
      'Register ProjectLocation response does not match the requested Machine',
    )
    return response
  }

  async removeProjectLocation(
    projectId: ProjectId,
    machineId: MachineId,
    input: RemoveProjectLocationRequest,
    options: RequestOptions = {},
  ): Promise<RemoveProjectLocationResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'remove-project-location project id',
    )
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'remove-project-location machine id',
    )
    const request = parseProtocol(
      RemoveProjectLocationRequestSchema,
      input,
      'remove-project-location request',
    )
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(machine)}`,
      RemoveProjectLocationResponseSchema,
      {
        ...jsonRequest(request, options.signal),
        method: 'DELETE',
      },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.project.projectId === project,
      'Remove ProjectLocation response does not match the requested Project',
    )
    assertProtocolIdentity(
      response.data.machineId === machine &&
        !response.data.project.locations.some(
          (location) => location.machineId === machine,
        ),
      'Remove ProjectLocation response does not match the requested Machine',
    )
    return response
  }

  async discoverProviderSessions(
    projectId: ProjectId,
    machineId: MachineId,
    options: DiscoverProviderSessionsOptions = {},
  ): Promise<DiscoverProviderSessionsResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'discover-provider-sessions project id',
    )
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'discover-provider-sessions machine id',
    )
    const query = parseProtocol(
      DiscoverProviderSessionsQuerySchema,
      {
        ...(options.provider === undefined
          ? {}
          : { provider: options.provider }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.rescan === undefined ? {} : { rescan: options.rescan }),
      },
      'discover-provider-sessions query',
    )
    const search = new URLSearchParams({ limit: String(query.limit) })
    if (query.provider !== undefined) search.set('provider', query.provider)
    if (query.cursor !== undefined) search.set('cursor', query.cursor)
    // Omitting false is important: URL query values are strings and the
    // Protocol default already represents the ordinary cached read.
    if (query.rescan) search.set('rescan', 'true')

    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(machine)}/provider-sessions?${search.toString()}`,
      DiscoverProviderSessionsResponseSchema,
      { method: 'GET', signal: options.signal },
    )
    assertProtocolIdentity(
      response.candidates.every((candidate) => candidate.machineId === machine),
      'Provider session discovery contains a candidate from another Machine',
    )
    if (query.provider !== undefined) {
      assertProtocolIdentity(
        response.providers.every(
          (provider) => provider.provider === query.provider,
        ) &&
          response.candidates.every(
            (candidate) => candidate.provider === query.provider,
          ),
        'Provider session discovery contains results from another Provider',
      )
    }
    if (query.cursor !== undefined && response.nextCursor !== undefined) {
      assertProtocolIdentity(
        response.nextCursor !== query.cursor,
        'Provider session discovery returned the same pagination cursor',
      )
    }
    return response
  }

  async adoptProviderSession(
    projectId: ProjectId,
    machineId: MachineId,
    input: AdoptProviderSessionRequest,
    options: RequestOptions = {},
  ): Promise<AdoptProviderSessionResponse> {
    const project = parseProtocol(
      ProjectIdSchema,
      projectId,
      'adopt-provider-session project id',
    )
    const machine = parseProtocol(
      MachineIdSchema,
      machineId,
      'adopt-provider-session machine id',
    )
    const request = parseProtocol(
      AdoptProviderSessionRequestSchema,
      input,
      'adopt-provider-session request',
    )
    const response = await this.#request(
      `/api/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(machine)}/provider-sessions`,
      AdoptProviderSessionResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.conversation.projectId === project,
      'Adopted Conversation does not match the requested Project',
    )
    assertProtocolIdentity(
      response.data.conversation.machineId === machine,
      'Adopted Conversation does not match the requested Machine',
    )
    return response
  }

  async createConversation(
    input: CreateConversationRequest,
    options: RequestOptions = {},
  ): Promise<CreateConversationResponse> {
    const request = parseProtocol(
      CreateConversationRequestSchema,
      input,
      'create-conversation request',
    )
    const response = await this.#request(
      '/api/v1/conversations',
      CreateConversationResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.conversation.machineId === request.machineId,
      'Create Conversation response does not match the requested Machine',
    )
    assertProtocolIdentity(
      response.data.conversation.provider === request.provider,
      'Create Conversation response does not match the requested Provider',
    )
    if ('projectId' in request) {
      assertProtocolIdentity(
        response.data.conversation.projectId === request.projectId,
        'Create Conversation response does not match the requested Project',
      )
    }
    return response
  }

  async renameConversation(
    conversationId: ConversationId,
    input: RenameConversationRequest,
    options: RequestOptions = {},
  ): Promise<RenameConversationResponse> {
    return await this.#mutateConversationOrganization(
      conversationId,
      input,
      RenameConversationRequestSchema,
      RenameConversationResponseSchema,
      '',
      'PATCH',
      'rename-conversation',
      options,
    )
  }

  async pinConversation(
    conversationId: ConversationId,
    input: PinConversationRequest,
    options: RequestOptions = {},
  ): Promise<PinConversationResponse> {
    return await this.#mutateConversationOrganization(
      conversationId,
      input,
      PinConversationRequestSchema,
      PinConversationResponseSchema,
      '/pin',
      'POST',
      'pin-conversation',
      options,
    )
  }

  async unpinConversation(
    conversationId: ConversationId,
    input: UnpinConversationRequest,
    options: RequestOptions = {},
  ): Promise<UnpinConversationResponse> {
    return await this.#mutateConversationOrganization(
      conversationId,
      input,
      UnpinConversationRequestSchema,
      UnpinConversationResponseSchema,
      '/unpin',
      'POST',
      'unpin-conversation',
      options,
    )
  }

  async archiveConversation(
    conversationId: ConversationId,
    input: ArchiveConversationRequest,
    options: RequestOptions = {},
  ): Promise<ArchiveConversationResponse> {
    return await this.#mutateConversationOrganization(
      conversationId,
      input,
      ArchiveConversationRequestSchema,
      ArchiveConversationResponseSchema,
      '/archive',
      'POST',
      'archive-conversation',
      options,
    )
  }

  async unarchiveConversation(
    conversationId: ConversationId,
    input: UnarchiveConversationRequest,
    options: RequestOptions = {},
  ): Promise<UnarchiveConversationResponse> {
    return await this.#mutateConversationOrganization(
      conversationId,
      input,
      UnarchiveConversationRequestSchema,
      UnarchiveConversationResponseSchema,
      '/unarchive',
      'POST',
      'unarchive-conversation',
      options,
    )
  }

  async startTurn(
    conversationId: ConversationId,
    input: StartTurnRequest,
    options: RequestOptions = {},
  ): Promise<StartTurnResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'start-turn conversation id',
    )
    const request = parseProtocol(
      StartTurnRequestSchema,
      input,
      'start-turn request',
    )
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}/turns`,
      StartTurnResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.turn.conversationId === conversation,
      'Start Turn response does not match the requested Conversation',
    )
    return response
  }

  async interruptTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    input: InterruptTurnRequest,
    options: RequestOptions = {},
  ): Promise<InterruptTurnResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      'interrupt-turn conversation id',
    )
    const turn = parseProtocol(TurnIdSchema, turnId, 'interrupt-turn turn id')
    const request = parseProtocol(
      InterruptTurnRequestSchema,
      input,
      'interrupt-turn request',
    )
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}/turns/${encodeURIComponent(turn)}/interrupt`,
      InterruptTurnResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.turn.conversationId === conversation &&
        response.data.turn.turnId === turn,
      'Interrupt response does not match the requested Turn',
    )
    return response
  }

  async resolveApproval(
    approvalId: ApprovalId,
    input: ResolveApprovalRequest,
    options: RequestOptions = {},
  ): Promise<ResolveApprovalResponse> {
    const approval = parseProtocol(
      ApprovalIdSchema,
      approvalId,
      'resolve-approval id',
    )
    const request = parseProtocol(
      ResolveApprovalRequestSchema,
      input,
      'resolve-approval request',
    )
    const response = await this.#request(
      `/api/v1/approvals/${encodeURIComponent(approval)}/resolve`,
      ResolveApprovalResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.approval.approvalId === approval,
      'Approval response does not match the requested Approval',
    )
    return response
  }

  async resolveAttention(
    attentionId: AttentionId,
    actionId: ActionId,
    options: RequestOptions = {},
  ): Promise<ResolveAttentionResponse> {
    const attention = parseProtocol(
      AttentionIdSchema,
      attentionId,
      'resolve-attention id',
    )
    const request = parseProtocol(
      ResolveAttentionRequestSchema,
      {
        actionId: parseProtocol(
          ActionIdSchema,
          actionId,
          'resolve-attention action id',
        ),
      },
      'resolve-attention request',
    )
    const response = await this.#request(
      `/api/v1/attention/${encodeURIComponent(attention)}/resolve`,
      ResolveAttentionResponseSchema,
      jsonRequest(request, options.signal),
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.attention.attentionId === attention,
      'Attention response does not match the requested Attention item',
    )
    return response
  }

  async connectEvents(
    options: ConnectEventsOptions = {},
  ): Promise<CodeTetherEventStream> {
    const lastEventId =
      options.lastEventId === undefined
        ? undefined
        : parseProtocol(LastEventIdSchema, options.lastEventId, 'Last-Event-ID')
    const linked = linkedAbortController(options.signal)
    let response: Response
    try {
      response = await this.#fetch(this.#url('/api/v1/events'), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(lastEventId === undefined
            ? {}
            : { 'Last-Event-ID': lastEventId }),
        },
        signal: linked.controller.signal,
      })
    } catch (error) {
      linked.detach()
      throw error
    }

    if (!response.ok) {
      try {
        throw await responseError(response, this.#maxResponseBytes)
      } finally {
        linked.detach()
      }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('text/event-stream')) {
      linked.controller.abort()
      linked.detach()
      await response.body?.cancel().catch(() => undefined)
      throw new CodeTetherProtocolError(
        `CodeTether event endpoint returned ${contentType || 'no content type'}`,
      )
    }
    if (response.body === null) {
      linked.controller.abort()
      linked.detach()
      throw new CodeTetherProtocolError(
        'CodeTether event endpoint returned no response body',
      )
    }
    return new CodeTetherEventStream(
      response.body,
      linked.controller,
      linked.detach,
      lastEventId,
      this.#maxEventFrameBytes,
    )
  }

  async #mutateConversationOrganization<
    TRequest extends { actionId: ActionId },
    TResponse extends {
      data: { conversation: { conversationId: ConversationId } }
    },
  >(
    conversationId: ConversationId,
    input: TRequest,
    requestSchema: RuntimeSchema<TRequest>,
    responseSchema: RuntimeSchema<TResponse>,
    suffix: string,
    method: 'PATCH' | 'POST',
    operation: string,
    options: RequestOptions,
  ): Promise<TResponse> {
    const conversation = parseProtocol(
      ConversationIdSchema,
      conversationId,
      `${operation} id`,
    )
    const request = parseProtocol(requestSchema, input, `${operation} request`)
    const response = await this.#request(
      `/api/v1/conversations/${encodeURIComponent(conversation)}${suffix}`,
      responseSchema,
      { ...jsonRequest(request, options.signal), method },
      request.actionId,
    )
    assertProtocolIdentity(
      response.data.conversation.conversationId === conversation,
      'Conversation organization response does not match the requested Conversation',
    )
    return response
  }

  async #request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    init: RequestInit,
    expectedActionId?: ActionId,
    inspectPayload?: (value: unknown) => void,
  ): Promise<T> {
    const response = await this.#fetch(this.#url(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    })
    if (!response.ok) {
      throw await responseError(
        response,
        this.#maxResponseBytes,
        expectedActionId,
      )
    }
    const payload = await readJson(response, this.#maxResponseBytes)
    inspectPayload?.(payload)
    const value = parseProtocol(schema, payload, `response from ${path}`)
    if (expectedActionId !== undefined) {
      assertProtocolIdentity(
        readActionId(value) === expectedActionId,
        'Mutation response actionId does not match the request',
      )
    }
    return value
  }

  #url(path: string): string {
    return `${this.#baseUrl}${path}`
  }
}

function assertCompatibleBootstrapVersion(value: unknown): void {
  if (
    typeof value === 'object' &&
    value !== null &&
    'protocolVersion' in value &&
    value.protocolVersion !== protocolVersion
  ) {
    throw new CodeTetherIncompatibleProtocolError(value.protocolVersion)
  }
}

function jsonRequest(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
}

async function responseError(
  response: Response,
  maxResponseBytes: number,
  expectedActionId?: ActionId,
): Promise<Error> {
  const payload = await readJson(response, maxResponseBytes)
  const envelope = parseProtocol(
    SafeErrorEnvelopeSchema,
    payload,
    `error response with HTTP ${response.status}`,
  )
  if (expectedActionId !== undefined && envelope.actionId !== undefined) {
    assertProtocolIdentity(
      envelope.actionId === expectedActionId,
      'Mutation error actionId does not match the request',
    )
  }
  return new CodeTetherResponseError(response.status, envelope)
}

async function readJson(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const body = await readBoundedText(response, maxResponseBytes)
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new CodeTetherProtocolError(
      `CodeTether returned invalid JSON with HTTP ${response.status}`,
      { cause: error },
    )
  }
}

async function readBoundedText(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new CodeTetherProtocolError(
      'CodeTether HTTP response exceeded its inbound body limit',
    )
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let completed = false
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxResponseBytes) {
        throw new CodeTetherProtocolError(
          'CodeTether HTTP response exceeded its inbound body limit',
        )
      }
      text += decoder.decode(result.value, { stream: true })
    }
    text += decoder.decode()
    completed = true
    return text
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function parseProtocol<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
  context: string,
): T {
  try {
    return schema.parse(value)
  } catch (error) {
    throw new CodeTetherProtocolError(
      `CodeTether protocol validation failed for ${context}`,
      { cause: error },
    )
  }
}

function readActionId(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'actionId' in value
    ? value.actionId
    : undefined
}

function assertProtocolIdentity(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new CodeTetherProtocolError(message)
}

function assertMachineConnectionMutationIdentity(
  response:
    RetryMachineConnectionResponse | UpdateMachineConnectionAddressResponse,
  machineId: MachineId,
): void {
  assertProtocolIdentity(
    response.data.machine.machineId === machineId &&
      response.data.machine.kind === 'remote',
    'Machine connection response does not match the requested remote Machine',
  )
  assertProtocolIdentity(
    response.data.connection.state === response.data.machine.connectionState,
    'Machine connection response state does not match the Machine summary',
  )
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return resolved
}
