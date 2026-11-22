import type {
  ApprovalControlState,
  ApprovalController,
} from './conversation-controls.js'
import type { ConversationApprovalViewModel } from './conversation-view-model.js'
import {
  createToolCommandSubtitle,
  createToolPresentation,
} from './tool-presentation.js'

export interface PendingActionDockControlModel {
  readonly decision?: ApprovalControlState['decision']
  readonly disabled: boolean
  readonly error?: string
  readonly pending: boolean
}

export interface PendingActionDockItemModel {
  readonly id: string
  readonly kind: ConversationApprovalViewModel['kind']
  readonly kindLabel: string
  readonly title: string
  readonly subtitle: string
  readonly requestedAt: string
  readonly context?: string
  readonly contextLabel?: string
  readonly contextHasParent?: boolean
  /** Full normalized action text. This is not a Provider JSON-RPC payload. */
  readonly detail: string
  readonly controls: PendingActionDockControlModel
}

type PendingActionControlSource = Pick<ApprovalController, 'enabled' | 'states'>

/**
 * Builds ordered presentational items without taking ownership of Approval
 * state. Every control state remains bound to its exact CodeTether approvalId.
 */
export function createPendingActionDockModel(
  approvals: readonly ConversationApprovalViewModel[],
  controller?: PendingActionControlSource,
  projectRootPath?: string,
): readonly PendingActionDockItemModel[] {
  return approvals.map((approval) => {
    const state = controller?.states[approval.id]
    const pending = state?.state === 'submitting'
    const commandPresentation =
      approval.kind === 'command'
        ? createToolPresentation({
            command: approval.summary,
            status: 'running',
          })
        : undefined

    return {
      id: approval.id,
      kind: approval.kind,
      kindLabel: approvalKindLabel(approval.kind),
      title: commandPresentation?.title ?? approval.title,
      subtitle:
        commandPresentation === undefined
          ? compactSubtitle(approval.summary)
          : createToolCommandSubtitle(approval.summary),
      requestedAt: approval.requestedAt,
      ...(approval.context === undefined ||
      (projectRootPath !== undefined &&
        sameDirectory(approval.context, projectRootPath))
        ? {}
        : {
            context: approval.context,
            contextLabel: contextFolderName(approval.context),
            contextHasParent: hasContextParent(approval.context),
          }),
      detail: approval.summary,
      controls: {
        disabled: controller?.enabled !== true || pending,
        pending,
        ...(state?.decision === undefined ? {} : { decision: state.decision }),
        ...(state?.error === undefined ? {} : { error: state.error }),
      },
    }
  })
}

function approvalKindLabel(
  kind: ConversationApprovalViewModel['kind'],
): string {
  if (kind === 'command') return '批准命令'
  if (kind === 'file-change') return '批准文件变更'
  return '批准操作'
}

function compactSubtitle(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= 80) return normalized
  return `${normalized.slice(0, 79)}…`
}

function contextSegments(value: string): readonly string[] {
  return value.replace(/\\/gu, '/').split('/').filter(Boolean)
}

function contextFolderName(value: string): string {
  return contextSegments(value).at(-1) ?? value
}

function hasContextParent(value: string): boolean {
  return contextSegments(value).length > 1
}

function sameDirectory(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  const windowsPath = /^(?:[a-z]:|\/\/)/iu
  return windowsPath.test(normalizedLeft) && windowsPath.test(normalizedRight)
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
