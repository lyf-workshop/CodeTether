import { useEffect, useRef, type Ref } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, TriangleAlert, WifiOff } from 'lucide-react'
import {
  ConversationIdSchema,
  type ConversationSummary,
  type MachineId,
  type ProjectId,
} from '@codetether/protocol'
import { Button, cn } from '@codetether/ui'

import { Composer } from './composer'
import { ConversationHeader } from './conversation-header'
import { ConversationTimeline } from './conversation-timeline'
import {
  conversationExecutionBoundaryPresentation,
  type ConversationControls,
} from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationExecutionBoundaryViewModel,
  ConversationProjectBoundaryViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { organizationConversationStatus } from './conversation-view-model'
import { PendingActionDock } from './pending-action-dock'
import { ConversationRestoreButton } from '../conversations/conversation-organization-controls'

interface ConversationWorkspaceProps {
  anchorRequestKey?: string
  viewModel: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  executionBoundary?: ConversationExecutionBoundaryViewModel
  projectBoundary?: ConversationProjectBoundaryViewModel
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  machineId?: MachineId
  onOpenInspector?: () => void
  onOpenChanges?: () => void
  controls?: ConversationControls
  targetChangeId?: string
  targetChangeRequestKey?: number
  targetTurnId?: string
  projectId?: ProjectId
  onArchived?: (conversation: ConversationSummary) => void
}

export function ConversationWorkspace({
  anchorRequestKey,
  viewModel,
  connectionIndicator,
  executionBoundary,
  projectBoundary,
  inspectorTriggerRef,
  machineId,
  onOpenInspector,
  onOpenChanges,
  controls,
  targetChangeId,
  targetChangeRequestKey,
  targetTurnId,
  projectId,
  onArchived,
}: ConversationWorkspaceProps) {
  const wasArchivedRef = useRef(viewModel.archivedAt !== undefined)
  const conversationId = ConversationIdSchema.safeParse(viewModel.id)
  const organizationConversation =
    projectId === undefined || !conversationId.success
      ? undefined
      : {
          conversationId: conversationId.data,
          projectId,
          title: viewModel.title,
          titleSource: viewModel.titleSource,
          status: organizationConversationStatus(viewModel.status),
          ...(viewModel.pinnedAt === undefined
            ? {}
            : { pinnedAt: viewModel.pinnedAt }),
          ...(viewModel.archivedAt === undefined
            ? {}
            : { archivedAt: viewModel.archivedAt }),
        }
  const executionBoundaryCopy =
    executionBoundary === undefined
      ? undefined
      : conversationExecutionBoundaryPresentation(executionBoundary.reason)

  useEffect(() => {
    const wasArchived = wasArchivedRef.current
    const isArchived = viewModel.archivedAt !== undefined
    wasArchivedRef.current = isArchived
    if (
      !wasArchived ||
      isArchived ||
      !document.hasFocus() ||
      document.querySelector('[role="dialog"]') !== null
    ) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const composer = document.getElementById('conversation-composer')
      if (composer instanceof HTMLTextAreaElement) composer.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [viewModel.archivedAt])

  return (
    <section
      aria-label="会话工作区"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-background"
    >
      <div className="min-w-0">
        <ConversationHeader
          conversation={viewModel}
          capabilities={viewModel.capabilities}
          connectionIndicator={connectionIndicator}
          inspectorTriggerRef={inspectorTriggerRef}
          onOpenInspector={onOpenInspector}
          onOpenChanges={onOpenChanges}
          interruptController={controls?.interrupt}
          projectId={projectId}
          onArchived={onArchived}
        />
        {organizationConversation?.archivedAt === undefined ? null : (
          <div
            role="status"
            className="flex min-w-0 items-center gap-3 border-b border-border bg-surface-muted/35 px-5 py-2.5"
          >
            <Archive
              aria-hidden="true"
              className="size-4 shrink-0 text-text-secondary"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">
                此会话已归档
              </p>
              <p className="truncate text-xs text-text-secondary">
                历史记录仍然可查看。恢复后可以继续与当前智能体对话。
              </p>
            </div>
            <ConversationRestoreButton
              conversation={organizationConversation}
              size="sm"
            />
          </div>
        )}
        {organizationConversation?.archivedAt !== undefined ||
        projectBoundary === undefined ? null : (
          <ProjectLocationBoundary boundary={projectBoundary} />
        )}
        {organizationConversation?.archivedAt !== undefined ||
        projectBoundary !== undefined ||
        executionBoundary === undefined ? null : (
          <div
            role="status"
            className="flex min-w-0 items-center gap-3 border-b border-border bg-warning-muted/30 px-5 py-2.5"
          >
            <WifiOff
              aria-hidden="true"
              className="size-4 shrink-0 text-warning"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">
                {executionBoundaryCopy?.title}
              </p>
              <p className="truncate text-xs text-text-secondary">
                {executionBoundaryCopy?.description}
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link
                to="/machines/$machineId"
                params={{ machineId: executionBoundary.machineId }}
                aria-label={`查看${executionBoundary.machineName}的机器详情`}
              >
                查看机器
              </Link>
            </Button>
          </div>
        )}
      </div>
      <ConversationTimeline
        anchorRequestKey={anchorRequestKey}
        agent={viewModel.agent}
        timeline={viewModel.timeline}
        changes={viewModel.changes}
        pendingApprovals={viewModel.pendingApprovals}
        machineId={machineId}
        projectId={projectId}
        projectRootPath={viewModel.projectRootPath}
        retryController={controls?.failedTurnRetry}
        targetChangeId={targetChangeId}
        targetChangeRequestKey={targetChangeRequestKey}
        targetTurnId={targetTurnId}
      />
      {viewModel.capabilities.supportsApprovals ? (
        <PendingActionDock
          approvals={viewModel.pendingApprovals}
          controller={controls?.approvals}
          className="mx-4 mb-3"
        />
      ) : null}
      <div className="min-h-0 px-4 pb-5">
        {organizationConversation?.archivedAt === undefined ? (
          <Composer
            capabilities={viewModel.capabilities}
            controller={controls?.composer}
            externalError={controls?.interrupt.error}
          />
        ) : (
          <ArchivedComposer conversation={organizationConversation} />
        )}
      </div>
    </section>
  )
}

interface ProjectLocationBoundaryProps {
  readonly boundary: ConversationProjectBoundaryViewModel
}

function ProjectLocationBoundary({ boundary }: ProjectLocationBoundaryProps) {
  const copy = {
    project_location_missing: {
      title: '这台机器缺少项目位置',
      description:
        '历史记录仍可查看。请在项目详情中注册此机器的项目位置；CodeTether 不会改用其他目录。',
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
  } as const
  const current = copy[boundary.reason]

  return (
    <div
      role="status"
      aria-label="项目位置不可用"
      className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border bg-warning-muted/30 px-5 py-2.5 sm:flex-nowrap"
    >
      <TriangleAlert
        aria-hidden="true"
        className="size-4 shrink-0 text-warning"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{current.title}</p>
        <p className="break-words text-xs text-text-secondary">
          {current.description}
        </p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <Link
          to="/projects/$projectId"
          params={{ projectId: boundary.projectId }}
          aria-label={`查看${boundary.projectName}的项目详情`}
        >
          查看项目
        </Link>
      </Button>
    </div>
  )
}

interface ArchivedComposerProps {
  readonly conversation: Parameters<
    typeof ConversationRestoreButton
  >[0]['conversation']
}

function ArchivedComposer({ conversation }: ArchivedComposerProps) {
  return (
    <section
      aria-label="已归档会话"
      className={cn(
        'flex h-[var(--layout-conversation-composer-height)] min-w-0 items-center justify-between gap-4 overflow-hidden rounded-md',
        'border border-border-strong bg-surface/70 px-4',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">此会话已归档</p>
        <p className="mt-1 truncate text-xs text-text-secondary">
          恢复后可以继续发送消息。
        </p>
      </div>
      <ConversationRestoreButton conversation={conversation} />
    </section>
  )
}
