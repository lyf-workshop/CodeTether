import type {
  ConversationId,
  MachineId,
  MachineProviderLifecycle,
  MachineSummary,
  ProjectId,
  ProjectLocation,
  ProjectRecord,
  ProviderId,
} from '@codetether/protocol'
import type { ProviderPresentation } from '../../provider/provider-presentation.js'
import { providerLifecycleForMachine } from '../../provider/provider-presentation.js'
import { providerLifecycleSupportsConversationExecution } from '../conversation/conversation-controls.js'
import { selectNewConversationMachine } from './new-conversation-machine-selection.js'
import { newConversationProviderEligibility } from './new-conversation-provider-selection.js'

export type NewConversationLaunchContext =
  | {
      readonly kind: 'fixed-project'
      readonly projectId: ProjectId
      readonly machineId?: MachineId
    }
  | {
      readonly kind: 'preselected'
      readonly projectId?: ProjectId
      readonly machineId?: MachineId
    }

export interface ConversationProjectSelection {
  readonly projectId: ProjectId
  readonly machineId: MachineId
}

export interface ConversationProjectChoice extends ConversationProjectSelection {
  readonly key: string
  readonly project: ProjectRecord
  readonly location: ProjectLocation
  readonly machine?: MachineSummary
  readonly unavailableReason?: string
}

export interface ConversationProjectGroup {
  readonly machineId: MachineId
  readonly label: string
  readonly choices: readonly ConversationProjectChoice[]
}

export interface ConversationProjectMenuGroup {
  readonly key: string
  readonly kind: 'recent' | 'device'
  readonly label: string
  readonly choices: readonly ConversationProjectChoice[]
}

interface LoadedConversationActivity {
  readonly conversationId: ConversationId
  readonly projectId?: ProjectId
  readonly machineId: MachineId
  readonly lastActivityAt?: string
}

interface ConversationActivitySource {
  readonly records: readonly LoadedConversationActivity[]
  readonly observedAt: number
}

export function conversationProjectChoiceKey(
  selection: ConversationProjectSelection,
): string {
  return selection.projectId + ':' + selection.machineId
}

/** Derive choices from Query records, keeping unavailable locations visible. */
export function conversationProjectGroups(
  machines: readonly MachineSummary[],
  projects: readonly ProjectRecord[],
): readonly ConversationProjectGroup[] {
  const ordered = [...machines].sort(
    (left, right) =>
      Number(right.kind === 'local') - Number(left.kind === 'local'),
  )
  const machineById = new Map(
    machines.map((machine) => [machine.machineId, machine]),
  )
  const choices = projects.flatMap((project) =>
    project.locations.map((location): ConversationProjectChoice => {
      const machine = machineById.get(location.machineId)
      const context = selectNewConversationMachine({
        machines,
        currentProject: project,
        currentMachineId: location.machineId,
      })
      let unavailableReason: string | undefined
      switch (context.contextIssue) {
        case 'machine_missing':
          unavailableReason = '设备不可用'
          break
        case 'machine_unavailable':
          unavailableReason = '设备离线或连接尚未恢复'
          break
        case 'project_access_unavailable':
          unavailableReason = '设备不能访问项目'
          break
        case 'provider_execution_unavailable':
          unavailableReason = '设备不能运行 AI 工具'
          break
        case 'project_location_missing':
        case 'project_location_unavailable':
          unavailableReason = '无法访问文件夹'
          break
      }
      return {
        key: conversationProjectChoiceKey({
          projectId: project.projectId,
          machineId: location.machineId,
        }),
        projectId: project.projectId,
        machineId: location.machineId,
        project,
        location,
        machine,
        unavailableReason,
      }
    }),
  )
  const orphanIds = [
    ...new Set(
      choices
        .filter((choice) => choice.machine === undefined)
        .map((choice) => choice.machineId),
    ),
  ]
  return [
    ...ordered.map((machine) => ({
      machineId: machine.machineId,
      label: machine.displayName,
      choices: choices.filter(
        (choice) => choice.machineId === machine.machineId,
      ),
    })),
    ...orphanIds.map((machineId) => ({
      machineId,
      label: '设备不可用',
      choices: choices.filter((choice) => choice.machineId === machineId),
    })),
  ].filter((group) => group.choices.length > 0)
}

/** Menu ordering only: never changes canonical choices, eligibility or launch context. */
export function conversationProjectMenuGroups(
  groups: readonly ConversationProjectGroup[],
  activitySources: readonly ConversationActivitySource[],
): readonly ConversationProjectMenuGroup[] {
  const latest = new Map<
    ConversationId,
    { record: LoadedConversationActivity; observedAt: number }
  >()
  for (const source of activitySources) {
    for (const record of source.records) {
      const current = latest.get(record.conversationId)
      if (current === undefined || source.observedAt > current.observedAt)
        latest.set(record.conversationId, {
          record,
          observedAt: source.observedAt,
        })
    }
  }
  const activityByPair = new Map<string, string>()
  for (const { record } of latest.values()) {
    if (record.projectId === undefined || record.lastActivityAt === undefined)
      continue
    const key = conversationProjectChoiceKey({
      projectId: record.projectId,
      machineId: record.machineId,
    })
    const current = activityByPair.get(key)
    if (current === undefined || record.lastActivityAt > current)
      activityByPair.set(key, record.lastActivityAt)
  }
  const recent = groups
    .flatMap((group) => group.choices)
    .filter((choice) => activityByPair.has(choice.key))
    .sort((left, right) =>
      activityByPair
        .get(right.key)!
        .localeCompare(activityByPair.get(left.key)!),
    )
    .slice(0, 5)
  const recentKeys = new Set(recent.map((choice) => choice.key))
  const remaining = groups
    .map<ConversationProjectMenuGroup>((group) => ({
      key: 'device:' + group.machineId,
      kind: 'device',
      label: group.label,
      choices: group.choices.filter((choice) => !recentKeys.has(choice.key)),
    }))
    .filter((group) => group.choices.length > 0)
  return recent.length === 0
    ? remaining
    : [
        { key: 'recent', kind: 'recent', label: '最近使用', choices: recent },
        ...remaining,
      ]
}

export function resolveConversationProject(
  groups: readonly ConversationProjectGroup[],
  context: NewConversationLaunchContext | undefined,
  selected?: ConversationProjectSelection,
) {
  const choices = groups.flatMap((group) => group.choices)
  const fixed = context?.kind === 'fixed-project'
  const allowed = choices.filter(
    (choice) =>
      !fixed ||
      (choice.projectId === context.projectId &&
        (context.machineId === undefined ||
          choice.machineId === context.machineId)),
  )
  const explicit =
    selected ??
    (context?.projectId !== undefined && context.machineId !== undefined
      ? { projectId: context.projectId, machineId: context.machineId }
      : undefined)
  if (explicit !== undefined) {
    const choice = allowed.find(
      (candidate) => candidate.key === conversationProjectChoiceKey(explicit),
    )
    return {
      choice,
      fixed: fixed && context.machineId !== undefined,
      requiresSelection: choice === undefined,
      selection: explicit,
    }
  }
  if (context?.projectId !== undefined) {
    const matching = allowed.filter(
      (choice) => choice.projectId === context.projectId,
    )
    const choice = matching.length === 1 ? matching[0] : undefined
    return {
      choice,
      fixed: fixed && matching.length === 1,
      requiresSelection: choice === undefined,
      selection: choice,
    }
  }
  const scope =
    context?.machineId === undefined
      ? allowed
      : allowed.filter((choice) => choice.machineId === context.machineId)
  const choice =
    scope.find((candidate) => candidate.unavailableReason === undefined) ??
    scope[0]
  return {
    choice,
    fixed: false,
    requiresSelection: choice === undefined,
    selection: choice,
  }
}

export function eligibleConversationProjectSelection(
  groups: readonly ConversationProjectGroup[],
  key: string,
  context?: NewConversationLaunchContext,
): ConversationProjectSelection | undefined {
  const choice = groups
    .flatMap((group) => group.choices)
    .find((candidate) => candidate.key === key)
  if (choice === undefined || choice.unavailableReason !== undefined)
    return undefined
  if (
    context?.kind === 'fixed-project' &&
    (choice.projectId !== context.projectId ||
      (context.machineId !== undefined &&
        choice.machineId !== context.machineId))
  )
    return undefined
  return { projectId: choice.projectId, machineId: choice.machineId }
}

export function conversationCreationProviderOptions(
  providers: readonly ProviderPresentation[],
  lifecycles: readonly MachineProviderLifecycle[] | undefined,
) {
  return providers.map((provider) => {
    const eligibility = newConversationProviderEligibility(provider)
    const lifecycle =
      lifecycles === undefined
        ? undefined
        : providerLifecycleForMachine(lifecycles, provider.provider)
    const selectedInstallation = lifecycle?.installations.find(
      (installation) =>
        installation.selected &&
        installation.installationId === lifecycle.selectedInstallationId,
    )
    const lifecycleBlocked =
      lifecycle !== undefined &&
      (selectedInstallation === undefined ||
        !providerLifecycleSupportsConversationExecution(selectedInstallation))
    return {
      provider,
      eligibility: lifecycleBlocked
        ? {
            ...eligibility,
            eligible: false,
            label:
              provider.displayName +
              ' · 当前安装尚不能创建会话，请在设备详情检查',
          }
        : eligibility,
    }
  })
}

export type ConversationCreationProviderOption = ReturnType<
  typeof conversationCreationProviderOptions
>[number]

/** A user-selected tool never silently falls back after discovery changes. */
export function resolveConversationCreationProvider(
  options: readonly ConversationCreationProviderOption[],
  selected?: ProviderId,
) {
  return selected === undefined
    ? (options.find(
        (option) =>
          option.eligibility.eligible && option.provider.provider === 'codex',
      ) ?? options.find((option) => option.eligibility.eligible))
    : options.find((option) => option.provider.provider === selected)
}
