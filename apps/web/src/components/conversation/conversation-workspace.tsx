import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ConversationIdSchema,
  type MachineId,
  type ProjectId,
} from '@codetether/protocol'
import { Button, agentDefinitions } from '@codetether/ui'

import { Composer } from './composer'
import { ConversationHeader } from './conversation-header'
import { ConversationTimeline } from './conversation-timeline'
import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationExecutionBoundaryViewModel,
  ConversationProjectBoundaryViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import type { ConversationDisplayContext } from './conversation-gate-presentation'
import { organizationConversationStatus } from './conversation-view-model'
import { PendingActionDock } from './pending-action-dock'
import { ConversationRestoreButton } from '../conversations/conversation-organization-controls'

interface ConversationWorkspaceProps {
  anchorRequestKey?: string
  viewModel: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  executionBoundary?: ConversationExecutionBoundaryViewModel
  projectBoundary?: ConversationProjectBoundaryViewModel
  displayContext?: ConversationDisplayContext
  machineId?: MachineId
  controls?: ConversationControls
  targetChangeId?: string
  targetChangeRequestKey?: number
  targetTurnId?: string
  projectId?: ProjectId
}

export function ConversationWorkspace({
  anchorRequestKey,
  viewModel,
  connectionIndicator,
  executionBoundary,
  projectBoundary,
  displayContext,
  machineId,
  controls,
  targetChangeId,
  targetChangeRequestKey,
  targetTurnId,
  projectId,
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
  const archived = viewModel.archivedAt !== undefined
  const recoveryMachineId =
    displayContext?.machineId ?? machineId ?? executionBoundary?.machineId
  const recoveryProjectId =
    displayContext?.projectId ?? projectId ?? projectBoundary?.projectId
  const recoveryProjectName =
    projectBoundary?.projectName ?? displayContext?.projectName ?? '当前项目'
  const recoveryAction =
    archived && organizationConversation !== undefined ? (
      <ConversationRestoreButton conversation={organizationConversation} />
    ) : (viewModel.capabilities.composerDisabled?.navigation === 'project' ||
        projectBoundary !== undefined) &&
      recoveryProjectId !== undefined ? (
      <Button asChild variant="secondary" size="sm">
        <Link
          to="/projects/$projectId"
          params={{ projectId: recoveryProjectId }}
          aria-label={`查看${recoveryProjectName}的项目详情`}
          search={
            recoveryMachineId === undefined
              ? {}
              : { machineId: recoveryMachineId }
          }
        >
          查看项目
        </Link>
      </Button>
    ) : recoveryMachineId === undefined ? undefined : (
      <Button asChild variant="secondary" size="sm">
        <Link
          to="/devices/$machineId"
          params={{ machineId: recoveryMachineId }}
        >
          查看设备
        </Link>
      </Button>
    )

  useEffect(() => {
    const wasArchived = wasArchivedRef.current
    const isArchived = viewModel.archivedAt !== undefined
    wasArchivedRef.current = isArchived
    if (
      !wasArchived ||
      isArchived ||
      !document.hasFocus() ||
      document.querySelector('[role="dialog"]') !== null
    )
      return
    const frame = window.requestAnimationFrame(() => {
      const composer = document.getElementById('conversation-composer')
      if (
        composer instanceof HTMLTextAreaElement &&
        !composer.readOnly &&
        composer.closest('[hidden]') === null
      )
        composer.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [viewModel.archivedAt])

  return (
    <section
      aria-label="会话工作区"
      className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto_auto] bg-background"
    >
      <ConversationTimeline
        header={
          <ConversationHeader
            conversation={viewModel}
            connectionIndicator={connectionIndicator}
            context={displayContext}
          />
        }
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
      {viewModel.capabilities.supportsApprovals &&
      displayContext?.machineKind === 'local' ? (
        <div className="mx-auto w-full min-w-0 max-w-(--read-w) px-8 max-sm:px-4">
          <PendingActionDock
            approvals={viewModel.pendingApprovals}
            controller={controls?.approvals}
            className="mb-3"
          />
        </div>
      ) : null}
      <div className="mx-auto w-full min-w-0 max-w-(--read-w) px-8 pb-5 max-sm:px-4">
        <Composer
          capabilities={viewModel.capabilities}
          controller={controls?.composer}
          interruptController={controls?.interrupt}
          context={displayContext}
          providerName={agentDefinitions[viewModel.agent].name}
          archived={archived}
          projectBoundary={projectBoundary}
          recoveryAction={recoveryAction}
        />
      </div>
    </section>
  )
}
