import type {
  ConversationId,
  ConversationSummary,
  MachineId,
  MachineSummary,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'
import { machineConnectionStateLabel } from '../machines/machine-presentation.js'

export type PaletteActionId =
  | 'new-conversation'
  | 'add-project'
  | 'add-device'
  | 'theme-light'
  | 'theme-dark'
  | 'settings'
export type PaletteTarget =
  | { readonly kind: 'conversation'; readonly conversationId: ConversationId }
  | {
      readonly kind: 'project'
      readonly projectId: ProjectId
      readonly machineId: MachineId
    }
  | { readonly kind: 'device'; readonly machineId: MachineId }
  | { readonly kind: 'action'; readonly action: PaletteActionId }
export interface PaletteEntry {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly shortcut?: string
  readonly target: PaletteTarget
}
export interface PaletteGroup {
  readonly id: string
  readonly label: string
  readonly entries: readonly PaletteEntry[]
}
export interface PaletteConversationSnapshot {
  readonly records: readonly ConversationSummary[]
  readonly observedAt: number
}
export interface PaletteSnapshot {
  readonly machines: readonly MachineSummary[]
  readonly projects: readonly ProjectRecord[]
  readonly conversations: readonly PaletteConversationSnapshot[]
}

/** Cache projection only: no content, native transcripts, queries, mutations or synthetic records. */
export function commandPaletteGroups(
  snapshot: PaletteSnapshot,
  query: string,
  actions: readonly PaletteEntry[] = [],
): readonly PaletteGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  const matches = (label: string) =>
    needle === '' || label.toLocaleLowerCase().includes(needle)
  const machines = new Map(
    snapshot.machines.map((machine) => [machine.machineId, machine]),
  )
  const projects = new Map(
    snapshot.projects.map((project) => [project.projectId, project]),
  )
  const conversations = new Map<
    ConversationId,
    { readonly record: ConversationSummary; readonly observedAt: number }
  >()
  for (const source of snapshot.conversations)
    for (const record of source.records) {
      const current = conversations.get(record.conversationId)
      if (current === undefined || source.observedAt > current.observedAt)
        conversations.set(record.conversationId, {
          record,
          observedAt: source.observedAt,
        })
    }
  const recent = [...conversations.values()]
    .map(({ record }) => record)
    .sort((left, right) => {
      const byActivity = (
        right.lastActivityAt ??
        right.updatedAt ??
        right.createdAt
      ).localeCompare(left.lastActivityAt ?? left.updatedAt ?? left.createdAt)
      return (
        byActivity || left.conversationId.localeCompare(right.conversationId)
      )
    })
  const conversationEntries: PaletteEntry[] = recent
    .filter((conversation) => matches(conversation.title))
    .slice(0, needle === '' ? 4 : 6)
    .map((conversation) => ({
      id: 'conversation:' + conversation.conversationId,
      label: conversation.title,
      description: [
        machines.get(conversation.machineId)?.displayName ?? '设备未知',
        conversation.projectId === undefined
          ? '项目未知'
          : (projects.get(conversation.projectId)?.name ?? '项目未知'),
        conversation.archivedAt === undefined ? undefined : '已归档',
      ]
        .filter((part) => part !== undefined)
        .join(' · '),
      target: {
        kind: 'conversation',
        conversationId: conversation.conversationId,
      },
    }))
  const projectEntries: PaletteEntry[] = snapshot.projects
    .filter((project) => matches(project.name))
    .flatMap((project) =>
      project.locations.map((location) => ({
        id: 'project:' + project.projectId + ':' + location.machineId,
        label: project.name,
        description:
          machines.get(location.machineId)?.displayName ?? '设备未知',
        target: {
          kind: 'project' as const,
          projectId: project.projectId,
          machineId: location.machineId,
        },
      })),
    )
  const deviceEntries: PaletteEntry[] = [...snapshot.machines]
    .sort(
      (left, right) =>
        Number(right.kind === 'local') - Number(left.kind === 'local'),
    )
    .filter((machine) => matches(machine.displayName))
    .map((machine) => ({
      id: 'device:' + machine.machineId,
      label: machine.displayName,
      description:
        machine.kind === 'local'
          ? '这台电脑'
          : machineConnectionStateLabel(machine.connectionState),
      target: { kind: 'device', machineId: machine.machineId },
    }))
  return [
    {
      id: 'conversations',
      label: needle === '' ? '最近的会话' : '会话',
      entries: conversationEntries,
    },
    { id: 'projects', label: '项目', entries: projectEntries },
    { id: 'devices', label: '设备', entries: deviceEntries },
    {
      id: 'actions',
      label: '操作',
      entries: actions.filter((entry) => matches(entry.label)),
    },
  ].filter((group) => group.entries.length > 0)
}

export function paletteActionEntries(
  theme: 'light' | 'dark',
  available: readonly PaletteActionId[],
): readonly PaletteEntry[] {
  const entries: readonly PaletteEntry[] = [
    {
      id: 'action:new-conversation',
      label: '新建会话',
      shortcut: 'Ctrl N',
      target: { kind: 'action', action: 'new-conversation' },
    },
    {
      id: 'action:add-project',
      label: '添加项目',
      target: { kind: 'action', action: 'add-project' },
    },
    {
      id: 'action:add-device',
      label: '添加设备',
      target: { kind: 'action', action: 'add-device' },
    },
    {
      id: 'action:theme',
      label: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
      target: {
        kind: 'action',
        action: theme === 'dark' ? 'theme-light' : 'theme-dark',
      },
    },
    {
      id: 'action:settings',
      label: '打开设置',
      target: { kind: 'action', action: 'settings' },
    },
  ]
  return entries.filter(
    (entry) =>
      entry.target.kind === 'action' && available.includes(entry.target.action),
  )
}
