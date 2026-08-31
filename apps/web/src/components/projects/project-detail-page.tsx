import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { Button, Separator } from '@codetether/ui'
import { ProjectIdSchema, type ProjectId } from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectLocationAvailability } from '../../runtime/host/project-location'
import { projectDetailViewState } from '../../runtime/host/project-view-state'
import { ProjectAvailabilityBadge } from './project-availability-badge'
import { ProjectsErrorState, ProjectsLoadingState } from './project-page-states'
import { AddProjectLocationDialog } from './add-project-location-dialog'
import { ProjectLocationsSection } from './project-locations-section'
import { RemoveProjectDialog } from './remove-project-dialog'
import { NewConversationDialog } from '../conversations/new-conversation-dialog'

export function ProjectDetailRoute() {
  const { projectId: rawProjectId } = useParams({
    from: '/projects/$projectId',
  })
  const parsedProjectId = ProjectIdSchema.safeParse(rawProjectId)

  if (!parsedProjectId.success) return <ProjectNotFound />
  return <ProjectDetailPage projectId={parsedProjectId.data} />
}

interface ProjectDetailPageProps {
  projectId: ProjectId
}

function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const viewState = projectDetailViewState(projectQuery)
  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'

  function handleRetry() {
    runtime.retry()
    if (connectionState === 'connected') void projectQuery.refetch()
  }

  if (connectionUnavailable) {
    return (
      <ProjectPageFrame>
        <ProjectsErrorState
          incompatible={connectionState === 'incompatible'}
          onRetry={handleRetry}
        />
      </ProjectPageFrame>
    )
  }

  if (
    viewState.kind === 'loading' ||
    (connectionState !== 'connected' && projectQuery.data === undefined)
  ) {
    return (
      <ProjectPageFrame>
        <ProjectsLoadingState />
      </ProjectPageFrame>
    )
  }

  if (viewState.kind === 'not-found') return <ProjectNotFound />

  if (viewState.kind === 'host-unavailable') {
    return (
      <ProjectPageFrame>
        <ProjectsErrorState title="无法读取项目" onRetry={handleRetry} />
      </ProjectPageFrame>
    )
  }

  const project = viewState.project
  const machines = machinesQuery.data ?? []
  const availability = projectLocationAvailability(project)
  const hasExecutableLocation = project.locations.some((location) => {
    const machine = machines.find(
      (candidate) => candidate.machineId === location.machineId,
    )
    return (
      location.availability === 'available' &&
      machine?.availability === 'available' &&
      machine.capabilities.providerExecution
    )
  })

  function handleRemoveOpenChange(open: boolean) {
    setRemoveOpen(open)
    if (!open) {
      requestAnimationFrame(() => removeButtonRef.current?.focus())
    }
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <Link
        to="/projects"
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-xs text-sm font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回项目
      </Link>

      <header className="flex min-w-0 flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1
              title={project.name}
              className="min-w-0 truncate text-page font-semibold text-text-primary"
            >
              {project.name}
            </h1>
            <ProjectAvailabilityBadge availability={availability} />
            <span className="text-xs font-medium text-text-muted">
              {project.locations.length} 个工作区位置
            </span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            同一个项目可以在不同机器上拥有独立的工作区位置。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm" className="h-9">
            <Link
              to="/projects/$projectId/conversations"
              params={{ projectId: project.projectId }}
            >
              <MessageSquare aria-hidden="true" />
              查看会话
            </Link>
          </Button>
          <NewConversationDialog
            currentProject={project}
            trigger={
              <Button
                size="sm"
                className="h-9"
                disabled={!hasExecutableLocation}
                title={
                  !hasExecutableLocation
                    ? '当前没有可执行智能体会话的工作区位置'
                    : undefined
                }
              >
                <Plus aria-hidden="true" />
                新建会话
              </Button>
            }
          />
          <AddProjectLocationDialog
            project={project}
            machines={machines}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                className="h-9"
                disabled={connectionState !== 'connected'}
              >
                <Plus aria-hidden="true" />
                添加位置
              </Button>
            }
          />
          <Button
            ref={removeButtonRef}
            variant="danger"
            size="sm"
            className="h-9"
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            移除项目
          </Button>
        </div>
      </header>

      {availability === 'unavailable' ? (
        <section
          role="status"
          className="mt-6 flex min-w-0 items-start gap-3 rounded-md border border-warning/30 bg-warning-muted/45 px-4 py-3.5"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-text-primary">
              当前没有可用的工作区位置
            </h2>
            <p className="mt-0.5 text-sm font-regular text-text-secondary">
              已注册的位置当前均不可用。持久项目和历史仍可读取；恢复本地目录或远程机器连接后会重新计算位置状态。
            </p>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ProjectLocationsSection machines={machines} project={project} />
        <ProjectAvailabilityPanel availability={availability} />
      </div>

      {connectionState === 'reconnecting' ? (
        <p
          role="status"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-regular text-text-muted"
        >
          <RefreshCw
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          正在重新连接，当前显示最近读取的项目数据。
        </p>
      ) : null}

      <RemoveProjectDialog
        open={removeOpen}
        project={project}
        onOpenChange={handleRemoveOpenChange}
      />
    </div>
  )
}

function ProjectAvailabilityPanel({
  availability,
}: {
  availability: 'available' | 'unavailable'
}) {
  const available = availability === 'available'

  return (
    <section className="rounded-lg border border-border bg-surface/65 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section font-semibold text-text-primary">
          访问状态
        </h2>
        <ProjectAvailabilityBadge availability={availability} />
      </div>
      <p className="mt-3 text-sm font-regular text-text-secondary">
        {available
          ? '至少一个工作区位置当前可访问。智能体执行仍取决于所选机器的真实能力。'
          : '持久项目记录仍可查看，但所有工作区相关操作会安全失败。'}
      </p>
      <Separator className="my-5" />
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          aria-hidden="true"
          className={available ? 'size-4 text-success' : 'size-4 text-warning'}
        />
        <div>
          <p className="text-sm font-medium text-text-primary">
            机器范围的工作区授权
          </p>
          <p className="mt-1 text-xs font-regular text-text-muted">
            每个位置都绑定到一台真实机器；路径授权不会在机器之间复制或推断。
          </p>
        </div>
      </div>
    </section>
  )
}

function ProjectNotFound() {
  return (
    <ProjectPageFrame>
      <section className="grid min-h-64 place-items-center rounded-lg border border-border bg-surface/45 px-6 py-10 text-center">
        <div className="max-w-md">
          <h1 className="text-section font-semibold text-text-primary">
            项目不存在
          </h1>
          <p className="mt-1.5 text-base font-regular text-text-secondary">
            该项目可能已从 CodeTether 中移除，或链接中的项目标识无效。
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link to="/projects">返回项目列表</Link>
          </Button>
        </div>
      </section>
    </ProjectPageFrame>
  )
}

function ProjectPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full min-w-0 px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      {children}
    </div>
  )
}
