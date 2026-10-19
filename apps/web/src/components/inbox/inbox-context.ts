import type {
  AttentionItem,
  ConversationSummary,
  MachineId,
  MachineSummary,
  ProjectAvailability,
  ProjectRecord,
  ProviderDescriptor,
} from '@codetether/protocol'
import { projectLocationAvailability } from '../../runtime/host/project-location.js'
import { providerPresentationForMachine } from '../../provider/provider-presentation.js'
import { deriveLiveControlAvailability } from '../conversation/conversation-controls.js'

export interface InboxItemMetadata {
  readonly conversationTitle?: string
  readonly projectAvailability?: ProjectAvailability
  readonly projectName?: string
  readonly provider?: ConversationSummary['provider']
  readonly machineId?: MachineId
  readonly machineName?: string
  readonly approvalSupported: boolean
}

/** Never borrow a sibling location or the local bootstrap's Provider capabilities. */
export function inboxItemContext(
  item: AttentionItem,
  project?: ProjectRecord,
  record?: ConversationSummary,
  machine?: MachineSummary,
  providers?: readonly ProviderDescriptor[],
): InboxItemMetadata {
  const conversation =
    record?.conversationId === item.conversationId &&
    record.projectId === item.projectId
      ? record
      : undefined
  const owningMachine =
    conversation !== undefined && machine?.machineId === conversation.machineId
      ? machine
      : undefined
  const owningProject =
    project?.projectId === item.projectId ? project : undefined
  const provider =
    conversation === undefined || owningMachine === undefined
      ? undefined
      : providerPresentationForMachine(providers ?? [], conversation.provider)
  const machineReady =
    owningMachine?.availability === 'available' &&
    (owningMachine.connectionState === 'local' ||
      owningMachine.connectionState === 'online') &&
    owningMachine.capabilities.providerExecution
  return {
    approvalSupported:
      machineReady &&
      provider?.available === true &&
      deriveLiveControlAvailability(
        'connected',
        provider.capabilities,
        undefined,
      ).canResolveApproval,
    ...(conversation === undefined
      ? {}
      : {
          conversationTitle: conversation.title,
          provider: conversation.provider,
          machineId: conversation.machineId,
        }),
    ...(owningMachine === undefined
      ? {}
      : { machineName: owningMachine.displayName }),
    ...(owningProject === undefined ? {} : { projectName: owningProject.name }),
    ...(owningProject === undefined || conversation === undefined
      ? {}
      : {
          projectAvailability: projectLocationAvailability(
            owningProject,
            conversation.machineId,
          ),
        }),
  }
}
