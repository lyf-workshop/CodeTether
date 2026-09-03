import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttentionIdSchema,
  AttentionItemSchema,
  AttentionListResponseSchema,
  BeginRemoteMachinePairingRequestSchema,
  BeginRemoteMachinePairingResponseSchema,
  ArchiveConversationRequestSchema,
  ArchiveConversationResponseSchema,
  BootstrapSchema,
  CanonicalFailureSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationRecordSchema,
  ConversationRuntimeSnapshotSchema,
  ConversationSearchCursorSchema,
  ConversationSearchQuerySchema,
  ConversationSearchResponseSchema,
  ConversationSummarySchema,
  ConversationApprovalHistoryRecordSchema,
  CreateConversationRequestSchema,
  CreateConversationResponseSchema,
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  DeleteProjectRequestSchema,
  DeleteProjectResponseSchema,
  EventIdSchema,
  GetMachineResponseSchema,
  GetProjectResponseSchema,
  GetConversationResponseSchema,
  HostEventEnvelopeSchema,
  HostEventSchema,
  HostErrorCodeSchema,
  HostSnapshotSchema,
  InterruptTurnRequestSchema,
  ListAttentionQuerySchema,
  ListMachinesResponseSchema,
  ListProjectsResponseSchema,
  ListProjectConversationsQuerySchema,
  ManualConversationTitleSchema,
  MachineCapabilitiesSchema,
  MachineIdSchema,
  MachineProviderDiscoverySchema,
  MachineProviderDiscoveryStateSchema,
  MachineSummarySchema,
  MachinePairingAttemptIdSchema,
  PinConversationRequestSchema,
  PinConversationResponseSchema,
  ProjectIdSchema,
  ProjectLocationSchema,
  ProjectRecordSchema,
  RemoteMachineAddressSchema,
  RemoteMachineConnectionSchema,
  RemoteMachinePairingCandidateSchema,
  RegisterProjectLocationRequestSchema,
  RegisterProjectLocationResponseSchema,
  RemoveProjectLocationRequestSchema,
  RemoveProjectLocationResponseSchema,
  RefreshMachineProvidersRequestSchema,
  RefreshMachineProvidersResponseSchema,
  RetryMachineConnectionRequestSchema,
  RetryMachineConnectionResponseSchema,
  ProviderAvailabilitySchema,
  ProviderCapabilitiesSchema,
  ProviderDescriptorSchema,
  ProviderExecutionHealthSchema,
  ProviderIdSchema,
  ResolveApprovalRequestSchema,
  ResolveAttentionRequestSchema,
  ResolveAttentionResponseSchema,
  RenameConversationRequestSchema,
  RenameConversationResponseSchema,
  SafeErrorEnvelopeSchema,
  safeErrorDetailLimits,
  StartTurnRequestSchema,
  TurnRecordSchema,
  ToolKindSchema,
  TimestampSchema,
  UpdateMachineConnectionAddressRequestSchema,
  UpdateMachineConnectionAddressResponseSchema,
  UnarchiveConversationRequestSchema,
  UnarchiveConversationResponseSchema,
  UnpinConversationRequestSchema,
  UnpinConversationResponseSchema,
  conversationRuntimeWireLimits,
  attentionListLimits,
  conversationDetailWireLimits,
  conversationSearchLimits,
  formatLastEventId,
  hostEventTypes,
  manualConversationTitleLimits,
  machineWireLimits,
  parseLastEventId,
  protocolVersion,
  maximumTimestampCharacters,
  conversationListLimits,
} from '../dist/index.js'

const epoch = '11111111-1111-4111-8111-111111111111'
const conversationId = 'conv_demo01'
const projectId = 'proj_demo01'
const machineId = 'machine_demo01'
const actionId = 'act_action01'
const turnId = 'turn_demo01'
const itemId = 'item_demo01'
const approvalId = 'approval_demo01'
const attentionId = 'attn_demo01'
const timestamp = '2026-08-26T08:00:00.000Z'
const rootPath = 'C:\\workspace\\demo'

const machineCapabilities = {
  projectAccess: true,
  providerExecution: true,
  backgroundRuntime: true,
  nativeFolderPicker: true,
  notifications: true,
}

const machine = {
  machineId,
  displayName: '本地电脑',
  kind: 'local',
  platform: 'Windows',
  architecture: 'x86_64',
  availability: 'available',
  connectionState: 'local',
  trustState: 'local',
  isLocal: true,
  createdAt: timestamp,
  lastSeenAt: timestamp,
  capabilities: machineCapabilities,
}

const providerDescriptor = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
  capabilities: {
    streaming: true,
    resume: true,
    interrupt: true,
    approvals: true,
    fileRead: true,
    fileEdit: true,
    shell: true,
    search: true,
    diff: true,
    toolEvents: true,
    modelSelection: true,
    reasoningControl: true,
  },
}

const projectLocation = {
  projectId,
  machineId,
  rootPath,
  availability: 'available',
  createdAt: timestamp,
  updatedAt: timestamp,
}

const project = {
  projectId,
  name: 'Demo',
  locations: [projectLocation],
  createdAt: timestamp,
  updatedAt: timestamp,
}

const conversation = {
  conversationId,
  machineId,
  provider: 'codex',
  cwd: rootPath,
  model: 'gpt-5',
  reasoning: 'high',
  status: 'running',
  activeTurnId: turnId,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const conversationSummary = {
  conversationId,
  projectId,
  machineId,
  title: 'Inspect the workspace',
  titleSource: 'generated',
  provider: 'codex',
  model: 'gpt-5',
  reasoning: 'high',
  status: 'running',
  createdAt: timestamp,
  updatedAt: timestamp,
  lastActivityAt: timestamp,
}

const runningTurn = {
  turnId,
  conversationId,
  status: 'running',
  startedAt: timestamp,
}

const runningTurnWithInput = {
  ...runningTurn,
  input: {
    type: 'text',
    text: 'Inspect the workspace safely.',
    timestamp,
  },
}

const conversationRuntime = {
  conversationId,
  turns: [runningTurnWithInput],
  messages: [
    {
      turnId,
      itemId: 'item_message01',
      text: 'I will inspect the workspace.',
      status: 'completed',
      timestamp,
      order: 1,
    },
  ],
  tools: [
    {
      turnId,
      itemId,
      name: 'command',
      command: 'git status --short',
      summary: 'Inspect the Git working tree',
      status: 'completed',
      success: true,
      outputSummary: 'M src/example.ts',
      startedAt: timestamp,
      completedAt: timestamp,
      order: 2,
    },
  ],
  changes: [
    {
      turnId,
      itemId,
      path: 'src/example.ts',
      kind: 'modified',
      additions: 1,
      deletions: 0,
      timestamp,
      order: 3,
    },
  ],
  terminal: {
    turnId,
    itemId,
    command: 'git status --short',
    text: 'M src/example.ts\n',
    stream: 'stdout',
    truncated: false,
    updatedAt: timestamp,
  },
  history: {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  },
}

const pendingApproval = {
  approvalId,
  conversationId,
  turnId,
  itemId,
  kind: 'command',
  summary: 'Run a safe command',
  status: 'pending',
  requestedAt: timestamp,
}

const resolvedApproval = {
  ...pendingApproval,
  status: 'resolved',
  decision: 'accept',
  resolvedAt: timestamp,
}

const openApprovalAttention = {
  attentionId,
  projectId,
  conversationId,
  turnId,
  type: 'approval',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: {
    approvalId,
    kind: 'command',
    actionTitle: '运行命令',
    actionSubtitle: 'pnpm test',
  },
}

const openCompletedReviewAttention = {
  attentionId: 'attn_review01',
  projectId,
  conversationId,
  turnId,
  type: 'completed_review',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: { conversationTitle: '检查工作区' },
}

const openFailedAttention = {
  attentionId: 'attn_failed01',
  projectId,
  conversationId,
  turnId,
  type: 'failed',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: {
    conversationTitle: '运行测试',
    error: {
      code: 'provider_error',
      message: '测试命令失败',
      details: { exitCode: 1 },
    },
  },
}

const resolvedCompletedReviewAttention = {
  ...openCompletedReviewAttention,
  status: 'resolved',
  updatedAt: timestamp,
  resolvedAt: timestamp,
}

test('accepts only CodeTether Conversation IDs and excludes provider IDs', () => {
  assert.equal(ConversationIdSchema.safeParse(conversationId).success, true)
  assert.equal(
    ConversationIdSchema.safeParse('thread-provider-123').success,
    false,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({
      ...conversation,
      providerThreadId: 'thread-provider-123',
    }).success,
    false,
  )
})

test('validates bounded Project identity and records', () => {
  assert.equal(ProjectIdSchema.safeParse(projectId).success, true)
  assert.equal(ProjectIdSchema.safeParse('project-a').success, false)
  assert.deepEqual(ProjectRecordSchema.parse(project), project)
  assert.equal(
    ProjectRecordSchema.safeParse({
      ...project,
      locations: [{ ...projectLocation, availability: 'missing' }],
    }).success,
    false,
  )
  assert.equal(
    ProjectRecordSchema.safeParse({
      ...project,
      locations: [{ ...projectLocation, projectId: 'proj_other01' }],
    }).success,
    false,
  )
  assert.equal(
    ProjectRecordSchema.safeParse({
      ...project,
      locations: [
        projectLocation,
        { ...projectLocation, rootPath: 'D:\\demo' },
      ],
    }).success,
    false,
  )
  assert.equal(
    ProjectRecordSchema.safeParse({ ...project, provider: 'codex' }).success,
    false,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({ ...conversation, projectId }).success,
    true,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({
      ...conversation,
      projectId,
      title: conversationSummary.title,
      titleSource: conversationSummary.titleSource,
      pinnedAt: timestamp,
    }).success,
    true,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({
      ...conversation,
      projectId,
      title: conversationSummary.title,
      titleSource: conversationSummary.titleSource,
      pinnedAt: timestamp,
      archivedAt: timestamp,
    }).success,
    false,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({
      ...conversation,
      titleSource: conversationSummary.titleSource,
    }).success,
    false,
    'a title source cannot exist without its public title',
  )
  assert.equal(
    ConversationRecordSchema.safeParse(conversation).success,
    true,
    'legacy v1 Conversation records remain valid without projectId',
  )
})

test('validates bounded public Machine records and Machine API responses', () => {
  assert.equal(MachineIdSchema.safeParse(machineId).success, true)
  assert.equal(MachineIdSchema.safeParse('local-computer').success, false)
  assert.deepEqual(
    MachineCapabilitiesSchema.parse(machineCapabilities),
    machineCapabilities,
  )
  assert.deepEqual(MachineSummarySchema.parse(machine), machine)
  assert.deepEqual(
    ProjectLocationSchema.parse(projectLocation),
    projectLocation,
  )
  assert.equal(
    MachineSummarySchema.safeParse({ ...machine, hostPid: 1234 }).success,
    false,
  )
  assert.equal(
    MachineCapabilitiesSchema.safeParse({
      ...machineCapabilities,
      remoteShell: true,
    }).success,
    false,
  )

  const list = { protocolVersion, machines: [machine] }
  assert.deepEqual(ListMachinesResponseSchema.parse(list), list)
  assert.equal(
    ListMachinesResponseSchema.safeParse({
      protocolVersion,
      machines: [machine, machine],
    }).success,
    false,
  )
  assert.equal(
    ListMachinesResponseSchema.safeParse({
      protocolVersion,
      machines: Array.from(
        { length: machineWireLimits.machines + 1 },
        (_, index) => ({ ...machine, machineId: `machine_bound${index}` }),
      ),
    }).success,
    false,
  )

  const detail = {
    protocolVersion,
    machine,
    providers: [providerDescriptor],
    projects: [project],
    conversations: [conversationSummary],
  }
  assert.deepEqual(GetMachineResponseSchema.parse(detail), detail)
  assert.equal(
    GetMachineResponseSchema.safeParse({
      ...detail,
      conversations: [{ ...conversationSummary, machineId: 'machine_other01' }],
    }).success,
    false,
  )
  assert.equal(
    GetMachineResponseSchema.safeParse({
      ...detail,
      projects: [
        {
          ...project,
          locations: [{ ...projectLocation, machineId: 'machine_other01' }],
        },
      ],
    }).success,
    false,
  )
  for (const duplicate of [
    { providers: [providerDescriptor, providerDescriptor] },
    { projects: [project, project] },
    { conversations: [conversationSummary, conversationSummary] },
  ]) {
    assert.equal(
      GetMachineResponseSchema.safeParse({ ...detail, ...duplicate }).success,
      false,
    )
  }
})

test('validates strict bounded ProjectLocation registration requests and exact responses', () => {
  const remoteMachineId = 'machine_remote01'
  const remotePath = '/home/开发者/projects/CodeTether workspace'
  const request = {
    actionId: 'act_location1',
    machineId: remoteMachineId,
    path: remotePath,
  }
  assert.deepEqual(RegisterProjectLocationRequestSchema.parse(request), request)
  assert.deepEqual(
    RegisterProjectLocationRequestSchema.parse({
      ...request,
      path: `  ${remotePath}  `,
    }),
    request,
  )
  assert.equal(
    RegisterProjectLocationRequestSchema.safeParse({
      ...request,
      genericFilesystemAccess: true,
    }).success,
    false,
  )
  assert.equal(
    RegisterProjectLocationRequestSchema.safeParse({
      ...request,
      path: `/${'界'.repeat(4_096)}`,
    }).success,
    false,
  )

  const remoteLocation = {
    ...projectLocation,
    machineId: remoteMachineId,
    rootPath: remotePath,
  }
  const projectWithRemoteLocation = {
    ...project,
    locations: [projectLocation, remoteLocation],
  }
  const response = {
    protocolVersion,
    actionId: request.actionId,
    status: 'completed',
    data: {
      project: projectWithRemoteLocation,
      location: remoteLocation,
      created: true,
    },
  }
  assert.deepEqual(
    RegisterProjectLocationResponseSchema.parse(response),
    response,
  )
  assert.equal(
    RegisterProjectLocationResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        location: { ...remoteLocation, projectId: 'proj_other01' },
      },
    }).success,
    false,
  )
  assert.equal(
    RegisterProjectLocationResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        project: {
          ...projectWithRemoteLocation,
          locations: [
            projectLocation,
            { ...remoteLocation, rootPath: '/home/other/project' },
          ],
        },
      },
    }).success,
    false,
  )
  assert.equal(
    RegisterProjectLocationResponseSchema.safeParse({
      ...response,
      data: { ...response.data, canonicalPath: remotePath },
    }).success,
    false,
  )
})

test('validates strict ProjectLocation removal requests and absence-preserving responses', () => {
  const remoteMachineId = 'machine_remote01'
  const request = { actionId: 'act_location_remove1' }
  assert.deepEqual(RemoveProjectLocationRequestSchema.parse(request), request)
  assert.equal(
    RemoveProjectLocationRequestSchema.safeParse({
      ...request,
      deleteRemoteFiles: true,
    }).success,
    false,
  )

  const response = {
    protocolVersion,
    actionId: request.actionId,
    status: 'completed',
    data: { project, machineId: remoteMachineId },
  }
  assert.deepEqual(
    RemoveProjectLocationResponseSchema.parse(response),
    response,
  )
  assert.equal(
    RemoveProjectLocationResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        project: {
          ...project,
          locations: [
            ...project.locations,
            { ...projectLocation, machineId: remoteMachineId },
          ],
        },
      },
    }).success,
    false,
  )
  for (const code of [
    'project_location_not_found',
    'project_location_has_conversations',
    'project_location_local_required',
  ]) {
    assert.equal(HostErrorCodeSchema.parse(code), code)
  }
})

test('validates presentation-safe remote pairing contracts', () => {
  const pairingAttemptId =
    MachinePairingAttemptIdSchema.parse('pairing_attempt01')
  const address = RemoteMachineAddressSchema.parse({
    host: '192.0.2.10',
    port: 43_217,
  })
  const request = BeginRemoteMachinePairingRequestSchema.parse({
    actionId,
    address,
    pairingCode: '482 731',
  })
  assert.equal(request.pairingCode, '482731')
  assert.equal(
    RemoteMachineAddressSchema.safeParse({
      host: 'https://remote.example',
      port: 43_217,
    }).success,
    false,
  )
  const candidate = RemoteMachinePairingCandidateSchema.parse({
    pairingAttemptId,
    machineId: 'machine_remote01',
    displayName: 'Development server',
    platform: 'Linux',
    architecture: 'x64',
    address,
    protocolVersion: 1,
    expiresAt: timestamp,
    verificationCode: '482 731',
  })
  const response = {
    protocolVersion,
    actionId,
    status: 'accepted',
    data: { candidate },
  }
  assert.deepEqual(
    BeginRemoteMachinePairingResponseSchema.parse(response),
    response,
  )
  assert.equal(
    BeginRemoteMachinePairingResponseSchema.safeParse({
      ...response,
      data: { candidate: { ...candidate, peerPublicKey: 'private' } },
    }).success,
    false,
  )
})

test('validates bounded presentation-safe remote connection recovery contracts', () => {
  const remoteMachine = {
    ...machine,
    machineId: 'machine_remote01',
    displayName: 'Development server',
    kind: 'remote',
    availability: 'available',
    connectionState: 'online',
    trustState: 'trusted',
    isLocal: false,
    capabilities: {
      projectAccess: false,
      providerExecution: false,
      backgroundRuntime: false,
      nativeFolderPicker: false,
      notifications: false,
    },
  }
  const address = { host: '192.168.50.22', port: 4_318 }
  const connection = {
    state: 'online',
    currentEndpoint: address,
    lastSuccessfulAt: timestamp,
    lastAttemptAt: timestamp,
  }
  assert.deepEqual(RemoteMachineConnectionSchema.parse(connection), connection)
  assert.equal(
    RemoteMachineConnectionSchema.safeParse({ state: 'online' }).success,
    false,
  )
  assert.equal(
    RemoteMachineConnectionSchema.safeParse({
      ...connection,
      knownEndpoints: [address],
    }).success,
    false,
    'private endpoint history must not cross the public protocol',
  )

  const detail = {
    protocolVersion,
    machine: remoteMachine,
    providers: [],
    projects: [],
    conversations: [],
    connection,
    providerDiscovery: { state: 'not_observed' },
  }
  assert.deepEqual(GetMachineResponseSchema.parse(detail), detail)
  assert.equal(
    GetMachineResponseSchema.safeParse({ ...detail, connection: undefined })
      .success,
    false,
  )
  assert.equal(
    GetMachineResponseSchema.safeParse({
      ...detail,
      connection: { ...connection, state: 'offline' },
    }).success,
    false,
    'Machine and connection state must agree',
  )
  assert.equal(
    GetMachineResponseSchema.safeParse({
      protocolVersion,
      machine,
      providers: [providerDescriptor],
      projects: [project],
      conversations: [conversationSummary],
      connection,
    }).success,
    false,
    'local Machine detail must not expose remote connection metadata',
  )

  for (const state of ['not_observed', 'current', 'last_known']) {
    assert.equal(MachineProviderDiscoveryStateSchema.parse(state), state)
  }
  assert.deepEqual(
    MachineProviderDiscoverySchema.parse({ state: 'not_observed' }),
    { state: 'not_observed' },
  )
  const currentProviderDiscovery = {
    state: 'current',
    observedAt: timestamp,
  }
  assert.deepEqual(
    MachineProviderDiscoverySchema.parse(currentProviderDiscovery),
    currentProviderDiscovery,
  )
  assert.equal(
    MachineProviderDiscoverySchema.safeParse({
      state: 'not_observed',
      observedAt: timestamp,
    }).success,
    false,
  )
  assert.equal(
    GetMachineResponseSchema.safeParse({
      ...detail,
      providers: [providerDescriptor],
    }).success,
    false,
    'an unobserved Machine cannot expose Provider results',
  )
  assert.equal(
    GetMachineResponseSchema.safeParse({
      ...detail,
      machine: {
        ...remoteMachine,
        availability: 'unavailable',
        connectionState: 'offline',
      },
      connection: { ...connection, state: 'offline' },
      providers: [providerDescriptor],
      providerDiscovery: currentProviderDiscovery,
    }).success,
    false,
    'an offline Machine cannot claim a current observation',
  )
  assert.deepEqual(
    GetMachineResponseSchema.parse({
      ...detail,
      machine: {
        ...remoteMachine,
        availability: 'unavailable',
        connectionState: 'offline',
      },
      connection: { ...connection, state: 'offline' },
      providers: [providerDescriptor],
      providerDiscovery: { state: 'last_known', observedAt: timestamp },
    }).providerDiscovery,
    { state: 'last_known', observedAt: timestamp },
  )

  assert.deepEqual(RetryMachineConnectionRequestSchema.parse({ actionId }), {
    actionId,
  })
  assert.deepEqual(
    UpdateMachineConnectionAddressRequestSchema.parse({ actionId, address }),
    { actionId, address },
  )
  assert.deepEqual(RefreshMachineProvidersRequestSchema.parse({ actionId }), {
    actionId,
  })
  const mutation = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { machine: remoteMachine, connection },
  }
  assert.deepEqual(
    RetryMachineConnectionResponseSchema.parse(mutation),
    mutation,
  )
  assert.deepEqual(
    UpdateMachineConnectionAddressResponseSchema.parse(mutation),
    mutation,
  )
  const refresh = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: {
      machineId: remoteMachine.machineId,
      providers: [providerDescriptor],
      providerDiscovery: currentProviderDiscovery,
    },
  }
  assert.deepEqual(
    RefreshMachineProvidersResponseSchema.parse(refresh),
    refresh,
  )
  assert.equal(
    RefreshMachineProvidersResponseSchema.safeParse({
      ...refresh,
      data: {
        ...refresh.data,
        providerDiscovery: { state: 'last_known', observedAt: timestamp },
      },
    }).success,
    false,
  )
  assert.equal(
    RefreshMachineProvidersResponseSchema.safeParse({
      ...refresh,
      data: {
        ...refresh.data,
        providers: [providerDescriptor, providerDescriptor],
      },
    }).success,
    false,
  )
})

test('validates the durable Conversation summary without provider internals', () => {
  assert.deepEqual(
    ConversationSummarySchema.parse(conversationSummary),
    conversationSummary,
  )
  for (const privateField of [
    ['providerThreadId', 'thread_provider01'],
    ['cwd', 'C:\\workspace\\demo'],
  ]) {
    assert.equal(
      ConversationSummarySchema.safeParse({
        ...conversationSummary,
        [privateField[0]]: privateField[1],
      }).success,
      false,
    )
  }
  assert.equal(
    ConversationSummarySchema.safeParse({
      ...conversationSummary,
      pinnedAt: timestamp,
      archivedAt: timestamp,
    }).success,
    false,
    'an archived Conversation cannot remain pinned',
  )
})

test('normalizes and strictly bounds manual Conversation titles', () => {
  assert.equal(
    ManualConversationTitleSchema.parse('  Re\u0301sume\t  登录模块  '),
    'Résume 登录模块',
  )
  assert.equal(
    RenameConversationRequestSchema.parse({
      actionId,
      title: '  Manual\n\n title  ',
    }).title,
    'Manual title',
  )
  for (const title of [
    '   ',
    'x'.repeat(manualConversationTitleLimits.codeUnits + 1),
    `${'x'.repeat(manualConversationTitleLimits.graphemes)}😀`,
  ]) {
    assert.equal(
      RenameConversationRequestSchema.safeParse({ actionId, title }).success,
      false,
    )
  }
})

test('validates bounded Project Conversation list queries and responses', () => {
  assert.deepEqual(ListProjectConversationsQuerySchema.parse({}), {
    archived: 'false',
    limit: conversationListLimits.default,
  })
  assert.deepEqual(
    ListProjectConversationsQuerySchema.parse({
      provider: 'codex',
      status: 'completed',
      limit: '25',
    }),
    {
      provider: 'codex',
      status: 'completed',
      archived: 'false',
      limit: 25,
    },
  )
  for (const archived of ['false', 'true', 'all']) {
    assert.equal(
      ListProjectConversationsQuerySchema.parse({ archived }).archived,
      archived,
    )
  }
  for (const limit of [0, conversationListLimits.maximum + 1, 1.5]) {
    assert.equal(
      ListProjectConversationsQuerySchema.safeParse({ limit }).success,
      false,
    )
  }
  assert.equal(
    ListProjectConversationsQuerySchema.safeParse({
      provider: 'claude-code',
    }).success,
    true,
  )
  assert.equal(
    ListProjectConversationsQuerySchema.safeParse({ provider: 'claude' })
      .success,
    false,
  )
  assert.equal(
    ListProjectConversationsQuerySchema.safeParse({ archived: false }).success,
    false,
    'wire archive filters are strict URL enum strings',
  )
  assert.equal(
    ListProjectConversationsQuerySchema.safeParse({ status: 'active' }).success,
    false,
  )

  const response = {
    protocolVersion,
    conversations: [conversationSummary],
  }
  assert.deepEqual(ConversationListResponseSchema.parse(response), response)
  assert.equal(
    ConversationListResponseSchema.safeParse({
      ...response,
      conversations: Array.from(
        { length: conversationListLimits.maximum + 1 },
        () => conversationSummary,
      ),
    }).success,
    false,
  )
})

test('normalizes and strictly validates durable Conversation search queries', () => {
  const cursor = ConversationSearchCursorSchema.parse('csc_abcdefghijklmnop')
  assert.deepEqual(
    ConversationSearchQuerySchema.parse({ q: '  Cafe\u0301 reconnect  ' }),
    {
      q: 'Café reconnect',
      archive: 'active',
      limit: conversationSearchLimits.default,
    },
  )
  assert.equal(
    ConversationSearchQuerySchema.safeParse({
      q: 'marker',
      provider: 'claude-code',
    }).success,
    true,
  )
  assert.deepEqual(
    ConversationSearchQuerySchema.parse({
      q: '登录',
      archive: 'all',
      provider: 'codex',
      status: 'failed',
      limit: '100',
      cursor,
    }),
    {
      q: '登录',
      archive: 'all',
      provider: 'codex',
      status: 'failed',
      limit: conversationSearchLimits.maximum,
      cursor,
    },
  )

  for (const query of [
    { q: '' },
    { q: '   ' },
    { q: 'x'.repeat(conversationSearchLimits.queryCodeUnits + 1) },
    { q: 'é'.repeat(conversationSearchLimits.queryGraphemes + 1) },
    { q: 'ok', archive: 'false' },
    { q: 'ok', provider: 'claude' },
    { q: 'ok', status: 'archived' },
    { q: 'ok', limit: 0 },
    { q: 'ok', limit: conversationSearchLimits.maximum + 1 },
    { q: 'ok', cursor: 'cursor-without-public-format' },
    { q: 'ok', unknown: true },
  ]) {
    assert.equal(ConversationSearchQuerySchema.safeParse(query).success, false)
  }
})

test('bounds and de-duplicates privacy-safe Conversation search results', () => {
  const cursor = ConversationSearchCursorSchema.parse('csc_abcdefghijklmnop')
  const titleResult = {
    conversation: conversationSummary,
    matchedField: 'title',
  }
  const inputResult = {
    conversation: {
      ...conversationSummary,
      conversationId: 'conv_search02',
    },
    matchedField: 'user_input',
    matchPreview: '…Windows 登录后自动 reconnect…',
    matchedTurnId: turnId,
  }
  const response = {
    protocolVersion,
    results: [titleResult, inputResult],
    hasMore: true,
    nextCursor: cursor,
  }
  assert.deepEqual(ConversationSearchResponseSchema.parse(response), response)

  for (const invalidResponse of [
    { ...response, results: [titleResult, titleResult] },
    { ...response, hasMore: false },
    { ...response, nextCursor: undefined },
    { ...response, results: [] },
    {
      ...response,
      results: [{ ...titleResult, matchPreview: 'must not accompany title' }],
    },
    {
      ...response,
      results: [
        {
          conversation: inputResult.conversation,
          matchedField: 'user_input',
          matchPreview: 'missing public Turn identity',
        },
      ],
    },
    {
      ...response,
      results: [
        {
          ...titleResult,
          conversation: {
            ...conversationSummary,
            providerThreadId: 'private-thread',
          },
        },
      ],
    },
  ]) {
    assert.equal(
      ConversationSearchResponseSchema.safeParse(invalidResponse).success,
      false,
    )
  }
})

test('validates explicit Conversation organization mutation envelopes', () => {
  const requests = [
    RenameConversationRequestSchema.parse({ actionId, title: 'Manual title' }),
    PinConversationRequestSchema.parse({ actionId }),
    UnpinConversationRequestSchema.parse({ actionId }),
    ArchiveConversationRequestSchema.parse({ actionId }),
    UnarchiveConversationRequestSchema.parse({ actionId }),
  ]
  assert.deepEqual(requests[0], { actionId, title: 'Manual title' })
  for (const request of requests.slice(1)) {
    assert.deepEqual(request, { actionId })
  }
  assert.equal(
    RenameConversationRequestSchema.safeParse({
      actionId,
      machineId: 'machine_other01',
      title: 'Move this Conversation',
    }).success,
    false,
    'organization mutations cannot switch a durable Conversation Machine',
  )

  const response = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: {
      conversation: {
        ...conversationSummary,
        title: 'Manual title',
        titleSource: 'manual',
      },
    },
  }
  for (const schema of [
    RenameConversationResponseSchema,
    PinConversationResponseSchema,
    UnpinConversationResponseSchema,
    ArchiveConversationResponseSchema,
    UnarchiveConversationResponseSchema,
  ]) {
    assert.deepEqual(schema.parse(response), response)
    assert.equal(
      schema.safeParse({
        ...response,
        data: {
          conversation: {
            ...response.data.conversation,
            providerThreadId: 'private',
          },
        },
      }).success,
      false,
    )
  }
})

test('validates durable Attention identities and safe discriminated payloads', () => {
  assert.equal(AttentionIdSchema.safeParse(attentionId).success, true)
  assert.equal(AttentionIdSchema.safeParse('approval_demo01').success, false)

  for (const item of [
    openApprovalAttention,
    openCompletedReviewAttention,
    openFailedAttention,
  ]) {
    assert.deepEqual(AttentionItemSchema.parse(item), item)
  }

  for (const privateField of [
    ['providerThreadId', 'thread_private01'],
    ['providerRequestId', 42],
    ['rawProviderPayload', { command: 'secret' }],
  ]) {
    assert.equal(
      AttentionItemSchema.safeParse({
        ...openApprovalAttention,
        [privateField[0]]: privateField[1],
      }).success,
      false,
    )
  }
  assert.equal(
    AttentionItemSchema.safeParse({
      ...openCompletedReviewAttention,
      payload: {
        ...openCompletedReviewAttention.payload,
        changedFileCount: 3,
      },
    }).success,
    false,
  )
  assert.equal(
    AttentionItemSchema.safeParse({
      ...openFailedAttention,
      payload: {
        ...openFailedAttention.payload,
        error: {
          ...openFailedAttention.payload.error,
          stack: 'private stack',
        },
      },
    }).success,
    false,
  )
})

test('enforces Attention lifecycle outcomes without making expired items actionable', () => {
  const resolvedApprovalAttention = {
    ...openApprovalAttention,
    status: 'resolved',
    resolvedAt: timestamp,
    payload: { ...openApprovalAttention.payload, decision: 'accept' },
  }
  const expiredApprovalAttention = {
    ...openApprovalAttention,
    status: 'expired',
    resolvedAt: timestamp,
    payload: {
      ...openApprovalAttention.payload,
      expirationReason: 'host_restart',
    },
  }
  assert.deepEqual(
    AttentionItemSchema.parse(resolvedApprovalAttention),
    resolvedApprovalAttention,
  )
  assert.deepEqual(
    AttentionItemSchema.parse(expiredApprovalAttention),
    expiredApprovalAttention,
  )
  assert.equal(
    AttentionItemSchema.safeParse({
      ...openApprovalAttention,
      payload: { ...openApprovalAttention.payload, decision: 'decline' },
    }).success,
    false,
  )
  assert.equal(
    AttentionItemSchema.safeParse({
      ...resolvedApprovalAttention,
      payload: openApprovalAttention.payload,
    }).success,
    false,
  )
  assert.equal(
    AttentionItemSchema.safeParse({
      ...openCompletedReviewAttention,
      status: 'expired',
      resolvedAt: timestamp,
    }).success,
    false,
  )
  assert.equal(
    AttentionItemSchema.safeParse({
      ...openFailedAttention,
      status: 'resolved',
    }).success,
    false,
  )
})

test('validates bounded Attention filters, summaries, and generic resolution', () => {
  assert.deepEqual(ListAttentionQuerySchema.parse({}), {
    status: 'open',
    limit: attentionListLimits.default,
  })
  assert.deepEqual(
    ListAttentionQuerySchema.parse({
      projectId,
      type: 'failed',
      status: 'resolved',
      limit: '25',
    }),
    { projectId, type: 'failed', status: 'resolved', limit: 25 },
  )
  for (const input of [
    { limit: 0 },
    { limit: attentionListLimits.maximum + 1 },
    { type: 'question' },
    { status: 'pending' },
    { unknown: true },
  ]) {
    assert.equal(ListAttentionQuerySchema.safeParse(input).success, false)
  }

  const response = {
    protocolVersion,
    items: [openCompletedReviewAttention],
    summary: {
      totalOpen: 3,
      approvalOpen: 1,
      completedReviewOpen: 1,
      failedOpen: 1,
    },
  }
  assert.deepEqual(AttentionListResponseSchema.parse(response), response)
  assert.equal(
    AttentionListResponseSchema.safeParse({
      ...response,
      items: [openCompletedReviewAttention, openCompletedReviewAttention],
    }).success,
    false,
  )
  assert.equal(
    AttentionListResponseSchema.safeParse({
      ...response,
      summary: { ...response.summary, totalOpen: 4 },
    }).success,
    false,
  )

  assert.deepEqual(ResolveAttentionRequestSchema.parse({ actionId }), {
    actionId,
  })
  assert.equal(
    ResolveAttentionRequestSchema.safeParse({ actionId, decision: 'accept' })
      .success,
    false,
  )
  const resolvedResponse = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { attention: resolvedCompletedReviewAttention },
  }
  assert.deepEqual(
    ResolveAttentionResponseSchema.parse(resolvedResponse),
    resolvedResponse,
  )
  assert.equal(
    ResolveAttentionResponseSchema.safeParse({
      ...resolvedResponse,
      data: {
        attention: {
          ...openApprovalAttention,
          status: 'resolved',
          resolvedAt: timestamp,
          payload: { ...openApprovalAttention.payload, decision: 'accept' },
        },
      },
    }).success,
    false,
  )
})

test('validates one durable Conversation detail without a second Timeline model', () => {
  const response = {
    protocolVersion,
    conversation: { ...conversationSummary, status: 'waiting' },
    runtime: conversationRuntime,
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 1,
      totalTurnCount: 1,
    },
    pendingApprovals: [pendingApproval],
    approvalHistory: [],
  }
  assert.deepEqual(GetConversationResponseSchema.parse(response), response)
  assert.equal(response.runtime, conversationRuntime)

  for (const field of [
    ['providerThreadId', 'provider-thread-secret'],
    ['cwd', 'C:\\private\\workspace'],
    ['hydrated', true],
  ]) {
    assert.equal(
      GetConversationResponseSchema.safeParse({
        ...response,
        [field[0]]: field[1],
      }).success,
      false,
    )
  }
})

test('expresses resolved and expired Approvals as non-actionable history', () => {
  const resolvedHistory = {
    lifecycle: 'resolved',
    approval: resolvedApproval,
  }
  const expiredHistory = {
    lifecycle: 'expired',
    approval: {
      ...pendingApproval,
      approvalId: 'approval_expired01',
    },
    expiredAt: timestamp,
    reason: 'host_restart',
  }
  assert.deepEqual(
    ConversationApprovalHistoryRecordSchema.parse(resolvedHistory),
    resolvedHistory,
  )
  assert.deepEqual(
    ConversationApprovalHistoryRecordSchema.parse(expiredHistory),
    expiredHistory,
  )
  assert.equal(
    ConversationApprovalHistoryRecordSchema.safeParse({
      lifecycle: 'resolved',
      approval: pendingApproval,
    }).success,
    false,
  )
  assert.equal(
    ConversationApprovalHistoryRecordSchema.safeParse({
      ...expiredHistory,
      reason: 'provider_exit',
    }).success,
    false,
  )
})

test('enforces durable detail history counts and Approval identity', () => {
  const response = {
    protocolVersion,
    conversation: { ...conversationSummary, status: 'waiting' },
    runtime: conversationRuntime,
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 1,
      totalTurnCount: 1,
    },
    pendingApprovals: [pendingApproval],
    approvalHistory: [],
  }
  for (const history of [
    { hasOlderHistory: false, retainedTurnCount: 0, totalTurnCount: 1 },
    { hasOlderHistory: false, retainedTurnCount: 1, totalTurnCount: 2 },
    { hasOlderHistory: true, retainedTurnCount: 1, totalTurnCount: 1 },
    { hasOlderHistory: false, retainedTurnCount: 2, totalTurnCount: 1 },
  ]) {
    assert.equal(
      GetConversationResponseSchema.safeParse({ ...response, history }).success,
      false,
    )
  }
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      runtime: { ...conversationRuntime, conversationId: 'conv_other01' },
    }).success,
    false,
  )
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      pendingApprovals: [
        { ...pendingApproval, conversationId: 'conv_other01' },
      ],
    }).success,
    false,
  )
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      approvalHistory: [{ lifecycle: 'resolved', approval: resolvedApproval }],
    }).success,
    false,
    'current and historical Approval IDs must not overlap',
  )
  assert.equal(
    GetConversationResponseSchema.safeParse({
      ...response,
      pendingApprovals: Array.from(
        { length: conversationDetailWireLimits.pendingApprovals + 1 },
        (_, index) => ({
          ...pendingApproval,
          approvalId: `approval_pending${String(index).padStart(3, '0')}`,
        }),
      ),
    }).success,
    false,
  )
})

test('validates bootstrap and snapshot as separate wire records', () => {
  const bootstrap = {
    protocolVersion,
    hostVersion: '0.0.0',
    epoch,
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: true,
      diff: true,
      streaming: true,
    },
  }
  assert.deepEqual(BootstrapSchema.parse(bootstrap), bootstrap)
  const providerCapabilities = {
    streaming: true,
    resume: true,
    interrupt: false,
    approvals: false,
    fileRead: true,
    fileEdit: true,
    shell: true,
    search: true,
    diff: false,
    toolEvents: true,
    modelSelection: true,
    reasoningControl: false,
  }
  const providers = [
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      availability: 'available',
      capabilities: providerCapabilities,
      version: '1.2.3',
      testedVersion: '1.2.3',
      models: [{ id: 'model-real', label: 'Model Real', isDefault: true }],
      reasoningLabel: 'Effort',
      reasoningOptions: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' },
      ],
    },
  ]
  assert.deepEqual(
    BootstrapSchema.parse({ ...bootstrap, providers }).providers,
    providers,
  )
  assert.equal(
    BootstrapSchema.safeParse({
      ...bootstrap,
      providers: [...providers, providers[0]],
    }).success,
    false,
  )
  assert.equal(
    BootstrapSchema.safeParse({
      ...bootstrap,
      providers: [
        {
          ...providers[0],
          reasoningOptions: [
            { id: 'low', label: 'Low' },
            { id: 'low', label: 'Duplicate' },
          ],
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    BootstrapSchema.safeParse({ ...bootstrap, snapshot: {} }).success,
    false,
  )

  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 0,
    conversations: [{ ...conversation, status: 'waiting' }],
    activeTurns: [runningTurn],
    pendingApprovals: [pendingApproval],
  }
  assert.deepEqual(HostSnapshotSchema.parse(snapshot), snapshot)
  assert.equal(
    HostSnapshotSchema.parse(snapshot).conversationRuntimes,
    undefined,
    'the accepted Phase 2B Snapshot remains valid without runtime history',
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      activeTurns: [
        {
          ...runningTurn,
          status: 'completed',
          completedAt: timestamp,
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [
        { ...conversation, status: 'waiting' },
        { ...conversation, status: 'waiting' },
      ],
    }).success,
    false,
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      pendingApprovals: [{ ...pendingApproval, turnId: 'turn_missing01' }],
    }).success,
    false,
  )
})

test('adds Host-owned Turn input without invalidating legacy Turn records', () => {
  assert.deepEqual(TurnRecordSchema.parse(runningTurn), runningTurn)
  assert.deepEqual(
    TurnRecordSchema.parse(runningTurnWithInput),
    runningTurnWithInput,
  )
  assert.equal(
    TurnRecordSchema.safeParse({
      ...runningTurn,
      input: { type: 'text', text: '   ', timestamp },
    }).success,
    false,
  )
  assert.equal(
    TurnRecordSchema.safeParse({
      ...runningTurn,
      input: { type: 'text', text: 'hello' },
    }).success,
    false,
  )
  const restartFailure = {
    category: 'runtime',
    reason: 'execution_ownership_uncertain',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
    occurredAt: timestamp,
    technicalCode: 'execution_ownership_uncertain',
  }
  const diagnosticallyInterrupted = {
    ...runningTurnWithInput,
    status: 'interrupted',
    completedAt: timestamp,
    error: {
      code: 'provider_unavailable',
      message: 'Execution could not be verified after Host restart',
      failure: restartFailure,
    },
  }
  assert.deepEqual(
    TurnRecordSchema.parse(diagnosticallyInterrupted),
    diagnosticallyInterrupted,
  )
  assert.equal(
    TurnRecordSchema.safeParse({
      ...diagnosticallyInterrupted,
      status: 'completed',
    }).success,
    false,
    'canonical diagnostics do not turn completed history into failure history',
  )
})

test('validates a complete additive Conversation runtime Snapshot', () => {
  assert.deepEqual(
    ConversationRuntimeSnapshotSchema.parse(conversationRuntime),
    conversationRuntime,
  )

  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 3,
    conversations: [{ ...conversation, status: 'waiting' }],
    activeTurns: [runningTurnWithInput],
    pendingApprovals: [pendingApproval],
    conversationRuntimes: [conversationRuntime],
  }
  assert.deepEqual(HostSnapshotSchema.parse(snapshot), snapshot)

  const multiPathRuntime = {
    ...conversationRuntime,
    changes: [
      conversationRuntime.changes[0],
      {
        ...conversationRuntime.changes[0],
        path: 'src/second.ts',
        order: conversationRuntime.changes[0].order + 1,
      },
    ],
  }
  assert.deepEqual(
    ConversationRuntimeSnapshotSchema.parse(multiPathRuntime),
    multiPathRuntime,
  )
})

test('rejects runtime history with invalid ownership or duplicate identity', () => {
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      turns: [{ ...conversationRuntime.turns[0], input: undefined }],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      messages: [
        {
          ...conversationRuntime.messages[0],
          turnId: 'turn_missing01',
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [
        {
          ...conversationRuntime.tools[0],
          itemId: conversationRuntime.messages[0].itemId,
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [{ ...conversationRuntime.tools[0], order: 1 }],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        itemId: 'item_missing01',
      },
    }).success,
    false,
  )
})

test('requires one consistent runtime record per Snapshot Conversation', () => {
  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 3,
    conversations: [
      { ...conversation, status: 'waiting' },
      {
        ...conversation,
        conversationId: 'conv_other01',
        status: 'idle',
        activeTurnId: undefined,
      },
    ],
    activeTurns: [runningTurnWithInput],
    pendingApprovals: [pendingApproval],
    conversationRuntimes: [conversationRuntime],
  }
  assert.equal(HostSnapshotSchema.safeParse(snapshot).success, false)

  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [{ ...conversation, status: 'waiting' }],
      activeTurns: [runningTurn],
    }).success,
    false,
    'the top-level active Turn and retained runtime Turn cannot disagree',
  )

  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [{ ...conversation, status: 'waiting' }],
      conversationRuntimes: [
        {
          ...conversationRuntime,
          turns: [],
          messages: [],
          tools: [],
          changes: [],
          terminal: { text: '', truncated: false },
        },
      ],
    }).success,
    false,
    'a pending Approval cannot reference a Turn absent from runtime history',
  )
})

test('makes runtime eviction and terminal truncation explicit and bounded', () => {
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      history: {
        ...conversationRuntime.history,
        evictedTools: 1,
      },
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        truncated: true,
      },
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        text: '💡'.repeat(
          Math.floor(conversationRuntimeWireLimits.terminalBytes / 4) + 1,
        ),
      },
    }).success,
    false,
  )
})

test('keeps route identity out of mutation request bodies', () => {
  assert.deepEqual(
    CreateConversationRequestSchema.parse({
      actionId,
      machineId,
      provider: 'codex',
      cwd: 'C:\\workspace\\demo',
      model: 'gpt-5',
      reasoning: 'high',
    }).actionId,
    actionId,
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      machineId,
      provider: 'claude-code',
      projectId,
    }).success,
    true,
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      machineId,
      provider: 'codex',
      projectId,
      model: 'gpt-5',
    }).success,
    true,
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      machineId,
      provider: 'codex',
      projectId,
      cwd: 'C:\\workspace\\demo',
    }).success,
    false,
    'a Conversation request cannot contain both workspace locators',
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      machineId,
      provider: 'codex',
    }).success,
    false,
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      provider: 'codex',
      projectId,
    }).success,
    false,
    'every new Conversation requires an explicit Machine identity',
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      machineId,
      provider: 'codex',
      cwd: 'C:\\workspace\\demo',
      title: 'Not part of v1',
    }).success,
    false,
  )

  const exactText = '  preserve this input exactly  '
  const start = StartTurnRequestSchema.parse({
    actionId,
    input: { type: 'text', text: exactText },
  })
  assert.equal(start.input.text, exactText)
  assert.equal(
    StartTurnRequestSchema.safeParse({
      actionId,
      conversationId,
      input: { type: 'text', text: 'hello' },
    }).success,
    false,
  )
  assert.equal(
    InterruptTurnRequestSchema.safeParse({ actionId, turnId }).success,
    false,
  )
  assert.equal(
    ResolveApprovalRequestSchema.safeParse({ actionId, decision: 'allow' })
      .success,
    false,
  )
  assert.equal(
    ResolveApprovalRequestSchema.safeParse({ actionId, decision: 'decline' })
      .success,
    true,
  )
})

test('validates strict Provider descriptors, canonical errors, and Tool kinds', () => {
  for (const provider of ['codex', 'claude-code']) {
    assert.equal(ProviderIdSchema.parse(provider), provider)
  }
  for (const availability of [
    'available',
    'not_installed',
    'unsupported_version',
    'misconfigured',
    'unavailable',
  ]) {
    assert.equal(ProviderAvailabilitySchema.parse(availability), availability)
  }
  const capabilities = {
    streaming: true,
    resume: true,
    interrupt: true,
    approvals: false,
    fileRead: true,
    fileEdit: true,
    shell: true,
    search: true,
    diff: false,
    toolEvents: true,
    modelSelection: false,
    reasoningControl: false,
  }
  assert.deepEqual(ProviderCapabilitiesSchema.parse(capabilities), capabilities)
  const descriptor = {
    provider: 'claude-code',
    displayName: 'Claude Code',
    availability: 'available',
    capabilities,
  }
  assert.deepEqual(ProviderDescriptorSchema.parse(descriptor), descriptor)
  const failure = {
    category: 'quota',
    reason: 'usage_limit_reached',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
    occurredAt: timestamp,
    technicalCode: 'usage_limit_reached',
  }
  assert.deepEqual(CanonicalFailureSchema.parse(failure), failure)
  assert.equal(
    CanonicalFailureSchema.safeParse({
      ...failure,
      retryability: 'retry_now',
    }).success,
    false,
    'retry semantics are fixed by the CodeTether-owned reason',
  )
  assert.equal(
    CanonicalFailureSchema.safeParse({
      ...failure,
      rawProviderError: '<script>steal()</script>\u001b[2J',
    }).success,
    false,
    'raw Provider diagnostics cannot enter public failure metadata',
  )
  const executionHealth = {
    state: 'degraded',
    freshness: 'current',
    observedAt: timestamp,
    failure,
  }
  assert.deepEqual(
    ProviderExecutionHealthSchema.parse(executionHealth),
    executionHealth,
  )
  assert.deepEqual(
    ProviderDescriptorSchema.parse({ ...descriptor, executionHealth }),
    { ...descriptor, executionHealth },
  )
  assert.equal(
    ProviderExecutionHealthSchema.safeParse({
      state: 'healthy',
      freshness: 'current',
      observedAt: timestamp,
      failure,
    }).success,
    false,
  )
  assert.equal(
    ProviderExecutionHealthSchema.safeParse({
      state: 'unknown',
      freshness: 'last_known',
      failure,
    }).success,
    false,
    'unknown health cannot smuggle a failure observation',
  )
  const oversizedTimestamp = `2026-09-02T08:00:00.${'1'.repeat(
    maximumTimestampCharacters,
  )}Z`
  assert.ok(oversizedTimestamp.length > maximumTimestampCharacters)
  assert.equal(TimestampSchema.safeParse(oversizedTimestamp).success, false)
  assert.equal(
    CanonicalFailureSchema.safeParse({
      ...failure,
      occurredAt: oversizedTimestamp,
    }).success,
    false,
    'canonical failure timestamps use the bounded protocol timestamp schema',
  )
  assert.equal(
    ProviderDescriptorSchema.safeParse({
      ...descriptor,
      executablePath: 'C:\\private\\claude.exe',
    }).success,
    false,
    'public Provider descriptors never expose executable paths',
  )
  for (const code of [
    'provider_not_installed',
    'provider_version_unsupported',
    'provider_start_failed',
    'provider_session_lost',
    'provider_unavailable',
  ]) {
    assert.equal(HostErrorCodeSchema.parse(code), code)
  }
  for (const kind of ['read', 'edit', 'shell', 'search', 'generic']) {
    assert.equal(ToolKindSchema.parse(kind), kind)
  }
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [{ ...conversationRuntime.tools[0], kind: 'shell' }],
    }).success,
    true,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [{ ...conversationRuntime.tools[0], kind: 'command' }],
    }).success,
    false,
  )
})

test('validates Project HTTP records and mutation envelopes', () => {
  const createRequest = {
    actionId,
    name: project.name,
    path: rootPath,
  }
  assert.deepEqual(
    CreateProjectRequestSchema.parse(createRequest),
    createRequest,
  )
  assert.deepEqual(
    CreateProjectRequestSchema.parse({ actionId, path: rootPath }),
    { actionId, path: rootPath },
    'the Host may derive a default name from the canonical path basename',
  )
  assert.equal(
    CreateProjectRequestSchema.safeParse({
      ...createRequest,
      rootPath,
    }).success,
    false,
  )
  assert.deepEqual(DeleteProjectRequestSchema.parse({ actionId }), { actionId })
  assert.equal(
    DeleteProjectRequestSchema.safeParse({ actionId, projectId }).success,
    false,
    'Project route identity stays out of the DELETE body',
  )

  const list = { protocolVersion, projects: [project] }
  const get = { protocolVersion, project }
  assert.deepEqual(ListProjectsResponseSchema.parse(list), list)
  assert.deepEqual(GetProjectResponseSchema.parse(get), get)

  const created = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { project, created: true },
  }
  const deleted = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { projectId },
  }
  assert.deepEqual(CreateProjectResponseSchema.parse(created), created)
  assert.deepEqual(DeleteProjectResponseSchema.parse(deleted), deleted)
  for (const code of ['project_unavailable', 'project_has_conversations']) {
    assert.equal(
      SafeErrorEnvelopeSchema.safeParse({
        protocolVersion,
        actionId,
        code,
        message: 'Safe Project error',
      }).success,
      true,
    )
  }
})

test('separates mutation success and safe HTTP error envelopes', () => {
  const success = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { conversation },
  }
  assert.deepEqual(CreateConversationResponseSchema.parse(success), success)
  assert.equal(
    CreateConversationResponseSchema.safeParse({
      protocolVersion,
      actionId,
      code: 'conflict',
      message: 'Already exists',
    }).success,
    false,
  )

  const safeError = {
    protocolVersion,
    actionId,
    code: 'provider_error',
    message: 'The provider rejected the operation',
    details: { method: 'turn/start' },
  }
  assert.deepEqual(SafeErrorEnvelopeSchema.parse(safeError), safeError)
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({
      ...safeError,
      code: 'provider_conversation_unavailable',
    }).success,
    true,
  )
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({ ...safeError, stack: 'secret stack' })
      .success,
    false,
  )
  for (const details of [
    { stderr: 'Bearer owner-secret' },
    { access_token: 'owner-secret' },
    { authorizationHeader: 'Bearer owner-secret' },
    { rawDiagnostic: '<script>unsafe</script>' },
  ]) {
    assert.equal(
      SafeErrorEnvelopeSchema.safeParse({ ...safeError, details }).success,
      false,
    )
  }
  const classifiedError = {
    ...safeError,
    failure: {
      category: 'authentication',
      reason: 'login_required',
      retryability: 'retry_after_user_action',
      userAction: 'login_on_machine',
      source: 'provider',
      occurredAt: timestamp,
      technicalCode: 'login_required',
    },
  }
  assert.deepEqual(
    SafeErrorEnvelopeSchema.parse(classifiedError),
    classifiedError,
  )

  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({
      ...safeError,
      details: {
        diagnostic: 'x'.repeat(safeErrorDetailLimits.maxStringCharacters + 1),
      },
    }).success,
    false,
  )
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({
      ...safeError,
      details: Object.fromEntries(
        Array.from(
          { length: safeErrorDetailLimits.maxEntries + 1 },
          (_, index) => [`field${String(index)}`, index],
        ),
      ),
    }).success,
    false,
  )
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({
      ...safeError,
      details: Object.fromEntries(
        Array.from({ length: safeErrorDetailLimits.maxEntries }, (_, index) => [
          `field${String(index)}`,
          '界'.repeat(safeErrorDetailLimits.maxStringCharacters),
        ]),
      ),
    }).success,
    false,
  )
})

test('formats and parses the shared epoch and sequence event identity', () => {
  const eventId = formatLastEventId({ epoch, seq: 42 })
  assert.equal(eventId, `${epoch}:42`)
  assert.deepEqual(parseLastEventId(eventId), { epoch, seq: 42 })
  const emptyCursor = formatLastEventId({ epoch, seq: 0 })
  assert.deepEqual(parseLastEventId(emptyCursor), { epoch, seq: 0 })
  assert.equal(parseLastEventId('not-an-epoch:1'), null)
  assert.equal(
    EventIdSchema.safeParse(`${epoch}:9007199254740992`).success,
    false,
  )
})

test('accepts exactly the v1 HostEvent variants', () => {
  const events = createHostEventFixtures()
  assert.deepEqual(
    events.map((event) => event.type),
    [...hostEventTypes],
  )
  for (const event of events) HostEventSchema.parse(event)

  assert.equal(
    HostEventSchema.safeParse({
      conversationId,
      timestamp,
      type: 'message.delta',
      payload: { delta: 'missing item identity' },
    }).success,
    false,
  )
  assert.equal(
    HostEventSchema.safeParse({
      conversationId,
      timestamp,
      type: 'stream.reset',
      payload: { reason: 'epoch_mismatch' },
    }).success,
    false,
  )
})

test('validates envelope identity and deterministic event IDs', () => {
  const events = createHostEventFixtures()
  events.forEach((event, index) => {
    const seq = index + 1
    HostEventEnvelopeSchema.parse({
      ...event,
      protocolVersion,
      epoch,
      seq,
      eventId: `${epoch}:${String(seq)}`,
    })
  })

  const message = events.find((event) => event.type === 'message.delta')
  assert.notEqual(message, undefined)
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...message,
      protocolVersion,
      epoch,
      seq: 7,
      eventId: `${epoch}:8`,
    }).success,
    false,
  )

  const reset = events.find((event) => event.type === 'stream.reset')
  assert.notEqual(reset, undefined)
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...reset,
      protocolVersion,
      epoch,
      seq: 0,
      eventId: `${epoch}:0`,
    }).success,
    true,
  )
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...message,
      protocolVersion,
      epoch,
      seq: 0,
      eventId: `${epoch}:0`,
    }).success,
    false,
  )

  const started = events[0]
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...started,
      payload: {
        conversation: { ...conversation, conversationId: 'conv_other01' },
      },
      protocolVersion,
      epoch,
      seq: 1,
      eventId: `${epoch}:1`,
    }).success,
    false,
  )

  const attention = events.find((event) => event.type === 'attention.created')
  assert.notEqual(attention, undefined)
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...attention,
      payload: {
        attention: {
          ...attention.payload.attention,
          conversationId: 'conv_other01',
        },
      },
      protocolVersion,
      epoch,
      seq: 15,
      eventId: `${epoch}:15`,
    }).success,
    false,
  )
  assert.equal(
    HostEventSchema.safeParse({
      ...attention,
      payload: {
        attention: {
          ...attention.payload.attention,
          rawProviderPayload: { private: true },
        },
      },
    }).success,
    false,
  )
})

function createHostEventFixtures() {
  const itemIdentity = { conversationId, turnId, itemId, timestamp }
  const turnIdentity = { conversationId, turnId, timestamp }
  return [
    {
      conversationId,
      timestamp,
      type: 'conversation.started',
      payload: { conversation },
    },
    {
      conversationId,
      timestamp,
      type: 'conversation.updated',
      payload: { conversation: conversationSummary },
    },
    {
      conversationId: null,
      timestamp,
      type: 'machine.updated',
      payload: { machine },
    },
    {
      conversationId: null,
      timestamp,
      type: 'machine.removed',
      payload: { machineId },
    },
    {
      ...turnIdentity,
      type: 'turn.started',
      payload: { turn: runningTurnWithInput },
    },
    { ...itemIdentity, type: 'message.delta', payload: { delta: 'hello' } },
    {
      ...itemIdentity,
      type: 'message.completed',
      payload: { message: 'hello' },
    },
    {
      ...itemIdentity,
      type: 'tool.started',
      payload: {
        name: 'command',
        command: 'pnpm test',
        summary: 'Run tests',
      },
    },
    {
      ...itemIdentity,
      type: 'tool.output',
      payload: { output: 'ok', stream: 'stdout' },
    },
    {
      ...itemIdentity,
      type: 'tool.completed',
      payload: { name: 'command', command: 'pnpm test', success: true },
    },
    {
      ...itemIdentity,
      type: 'file.changed',
      payload: { path: 'src/example.ts', kind: 'modified', additions: 1 },
    },
    {
      ...itemIdentity,
      type: 'approval.requested',
      payload: { approval: pendingApproval },
    },
    {
      ...itemIdentity,
      type: 'approval.resolved',
      payload: { approval: resolvedApproval },
    },
    {
      ...turnIdentity,
      type: 'attention.created',
      payload: { attention: openCompletedReviewAttention },
    },
    {
      ...turnIdentity,
      type: 'attention.resolved',
      payload: { attention: resolvedCompletedReviewAttention },
    },
    {
      ...turnIdentity,
      type: 'turn.completed',
      payload: { finalMessage: 'Done' },
    },
    {
      ...turnIdentity,
      type: 'turn.failed',
      payload: {
        error: {
          code: 'provider_error',
          message: 'Provider turn failed',
        },
      },
    },
    {
      ...turnIdentity,
      type: 'turn.interrupted',
      payload: { reason: 'User interrupted' },
    },
    {
      conversationId: null,
      timestamp,
      type: 'stream.reset',
      payload: { reason: 'history_evicted' },
    },
  ]
}
