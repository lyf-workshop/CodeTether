import type {
  MachineId,
  MachineSummary,
  ProjectId,
  ProjectRecord,
  ProviderDescriptor,
  GetConversationResponse,
} from '@codetether/protocol'
import {
  projectConversationDetail,
  type ConversationProjection,
  type ConversationReadModel,
} from '../../runtime/host/conversation-projection.js'
import type { HostConnectionState } from '../../runtime/host/host-runtime.js'

import type { ComposerControlState } from './conversation-controls.js'
import { isComposerEditableState } from './conversation-controls.js'
import type {
  ConversationCapabilitiesViewModel,
  ConversationProjectBoundaryViewModel,
} from './conversation-view-model.js'

/** Keep the same workspace mounted while a cold snapshot is reconciled.
 * The fallback is a read-only rendering of this exact durable detail. It does
 * not write Query/Runtime state or authorize send, interrupt, or approval.
 */
export function conversationPresentationForDetail(
  projection: ConversationProjection | undefined,
  detail: GetConversationResponse,
  connectionState: HostConnectionState,
): {
  readonly conversation: ConversationReadModel
  readonly connectionState: HostConnectionState
} {
  const conversationId = detail.conversation.conversationId
  const projected = projection?.conversations[conversationId]
  const current = projected?.id === conversationId ? projected : undefined
  return {
    conversation: current ?? projectConversationDetail(detail),
    connectionState:
      current === undefined && connectionState === 'connected'
        ? 'reconnecting'
        : connectionState,
  }
}

export interface ConversationDisplayContext {
  readonly machineId: MachineId
  readonly machineName: string
  readonly machineKind?: MachineSummary['kind']
  readonly projectId: ProjectId
  readonly projectName: string
  readonly projectPath?: string
  readonly reasoning?: string
  readonly importedFrom?: string
  readonly readSearchOnly: boolean
}

interface DisplayContextInput {
  readonly machineId: MachineId
  readonly projectId: ProjectId
  readonly adopted: boolean
  readonly providerName?: string
  readonly machine?: Pick<MachineSummary, 'machineId' | 'kind' | 'displayName'>
  readonly project?: Pick<ProjectRecord, 'projectId' | 'name' | 'locations'>
  readonly provider?: Pick<
    ProviderDescriptor,
    'displayName' | 'capabilities' | 'reasoningOptions'
  >
  readonly reasoning?: string
}

/** Safe display context never substitutes a currently selected/global device. */
export function createConversationDisplayContext(
  input: DisplayContextInput,
): ConversationDisplayContext {
  const machine =
    input.machine?.machineId === input.machineId ? input.machine : undefined
  const project =
    input.project?.projectId === input.projectId ? input.project : undefined
  const location = project?.locations.find(
    (candidate) => candidate.machineId === input.machineId,
  )
  const capabilities = input.provider?.capabilities
  const reasoning =
    input.reasoning === undefined
      ? undefined
      : (input.provider?.reasoningOptions?.find(
          (option) => option.id === input.reasoning,
        )?.label ?? '已设置')
  return {
    machineId: input.machineId,
    machineName: machine?.displayName ?? '设备',
    ...(machine === undefined ? {} : { machineKind: machine.kind }),
    projectId: input.projectId,
    projectName: project?.name ?? '项目',
    ...(location === undefined ? {} : { projectPath: location.rootPath }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(input.adopted
      ? {
          importedFrom:
            input.provider?.displayName ?? input.providerName ?? 'AI 工具',
        }
      : {}),
    readSearchOnly:
      capabilities?.fileRead === true &&
      capabilities.search === true &&
      capabilities.fileEdit === false &&
      capabilities.shell === false,
  }
}

export interface ComposerGatePresentation {
  readonly kind:
    'running' | 'waiting' | 'submitting' | 'unavailable' | 'archived'
  readonly title: string
  readonly description: string
  readonly canInterrupt: boolean
  readonly navigation?: 'machine' | 'project'
}

interface ComposerGateInput {
  readonly capabilities: ConversationCapabilitiesViewModel
  readonly state: ComposerControlState
  readonly providerName: string
  readonly machineKind?: MachineSummary['kind']
  readonly archived?: boolean
  readonly projectBoundary?: ConversationProjectBoundaryViewModel
}

/** Presentation over canonical controls only; it never admits or retries work. */
export function composerGatePresentation({
  capabilities,
  state,
  providerName,
  machineKind,
  archived,
  projectBoundary,
}: ComposerGateInput): ComposerGatePresentation | undefined {
  if (archived)
    return {
      kind: 'archived',
      title: '此会话已归档',
      description: '历史记录仍可查看。恢复后可以继续发送消息。',
      canInterrupt: false,
    }
  const canInterrupt =
    machineKind === 'local' &&
    capabilities.supportsInterrupt &&
    capabilities.canInterrupt
  const disabled = capabilities.composerDisabled
  const projectExplanation =
    disabled?.navigation === 'project' && projectBoundary !== undefined
      ? {
          project_location_missing: {
            title: '这台电脑缺少项目位置',
            description:
              '历史记录仍可查看。请在项目详情中检查这台设备的项目文件夹；CodeTether 不会改用其他目录。',
          },
          project_location_invalid: {
            title: '已注册的项目位置已改变',
            description:
              '历史记录仍可查看。请修复原项目位置；CodeTether 未删除项目文件，也不会改用其他目录。',
          },
          project_location_unavailable: {
            title: '项目位置当前不可用',
            description:
              '历史记录仍可查看。请检查已注册的位置；CodeTether 未删除项目文件，也不会改用其他目录。',
          },
        }[projectBoundary.reason]
      : undefined
  if (
    state === 'unavailable' ||
    (disabled !== undefined && disabled.reason !== 'conversation_busy')
  ) {
    return {
      kind: 'unavailable',
      title: projectExplanation?.title ?? '当前不能发送消息',
      description:
        projectExplanation?.description ??
        disabled?.message
          .replaceAll('CodeTether Host', 'CodeTether')
          .replaceAll('智能体', 'AI 工具')
          .replaceAll('推理后端', 'AI 服务') ??
        'CodeTether 暂时无法连接。恢复连接后可以继续这个会话。',
      canInterrupt,
      ...(disabled?.navigation === undefined
        ? {}
        : { navigation: disabled.navigation }),
    }
  }
  if (state === 'submitting')
    return {
      kind: 'submitting',
      title: '正在发送消息',
      description: '请稍候。CodeTether 不会重复发送这条消息。',
      canInterrupt,
    }
  const stopExplanation =
    machineKind === 'remote'
      ? '在配对设备上运行的会话，这里不能停止。'
      : capabilities.supportsInterrupt
        ? ''
        : `${providerName} 会话暂不支持停止。`
  const canPresentApproval =
    machineKind === 'local' && capabilities.supportsApprovals
  if (state === 'waiting')
    return {
      kind: 'waiting',
      title: canPresentApproval ? '等你批准一条命令' : '这一轮正在等待处理',
      description: canPresentApproval
        ? `在上方批准或拒绝后，AI 工具会继续。${canInterrupt ? '也可以停止这一轮。' : stopExplanation}`
        : `请等待这一轮完成后再发送下一条消息。${stopExplanation}`,
      canInterrupt,
    }
  if (state === 'running' || disabled?.reason === 'conversation_busy')
    return {
      kind: 'running',
      title: `${providerName} 正在工作`,
      description: `这一轮完成后可以发送下一条消息。${stopExplanation}`,
      canInterrupt,
    }
  if (!capabilities.canCompose || !isComposerEditableState(state))
    return {
      kind: 'unavailable',
      title: '当前不能发送消息',
      description: disabled?.message ?? '请先检查设备、项目和 AI 工具的状态。',
      canInterrupt,
      navigation: 'machine',
    }
  return undefined
}
