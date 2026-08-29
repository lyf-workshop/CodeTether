import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  FolderOpen,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { Button, IconButton, Separator, cn } from '@codetether/ui'
import {
  ProjectIdSchema,
  type ProjectId,
  type ProjectRecord,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { projectDetailViewState } from '../../runtime/host/project-view-state'
import { ProjectAvailabilityBadge } from './project-availability-badge'
import { ProjectsErrorState, ProjectsLoadingState } from './project-page-states'
import {
  compactProjectPath,
  formatProjectTime,
  projectFolderName,
} from './project-format'
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  )
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
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

  function handleRemoveOpenChange(open: boolean) {
    setRemoveOpen(open)
    if (!open) {
      requestAnimationFrame(() => removeButtonRef.current?.focus())
    }
  }

  async function handleCopyRootPath() {
    try {
      if (navigator.clipboard === undefined) throw new Error('unavailable')
      await navigator.clipboard.writeText(project.rootPath)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
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
            <ProjectAvailabilityBadge availability={project.availability} />
          </div>
          <div className="mt-1 flex min-w-0 max-w-2xl items-center gap-2 text-sm text-text-secondary">
            <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="shrink-0 font-medium text-text-primary">
              {projectFolderName(project.rootPath)}
            </span>
            <span
              title={project.rootPath}
              className="min-w-0 truncate font-mono text-xs"
            >
              {compactProjectPath(project.rootPath)}
            </span>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              label={copyState === 'copied' ? '路径已复制' : '复制完整路径'}
              className="size-7 shrink-0 text-text-muted hover:text-text-primary"
              onClick={() => void handleCopyRootPath()}
            >
              {copyState === 'copied' ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </IconButton>
            {copyState === 'failed' ? (
              <span role="alert" className="shrink-0 text-xs text-danger">
                复制失败
              </span>
            ) : null}
          </div>
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
                disabled={project.availability === 'unavailable'}
                title={
                  project.availability === 'unavailable'
                    ? '项目目录当前不可用'
                    : undefined
                }
              >
                <Plus aria-hidden="true" />
                新建会话
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

      {project.availability === 'unavailable' ? (
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
              项目目录当前不可用
            </h2>
            <p className="mt-0.5 text-sm font-regular text-text-secondary">
              目录当前不存在或无法访问。恢复原目录后，CodeTether
              会在下次读取时重新识别。
            </p>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <WorkspaceInformation project={project} />
        <ProjectAvailabilityPanel project={project} />
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

function WorkspaceInformation({ project }: { project: ProjectRecord }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface/65 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
        >
          <FolderOpen className="size-5" />
        </span>
        <div>
          <h2 className="text-section font-semibold text-text-primary">
            工作区信息
          </h2>
          <p className="mt-0.5 text-sm font-regular text-text-secondary">
            项目目录与最近使用信息。
          </p>
        </div>
      </div>

      <Separator className="my-5" />

      <dl className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
        <MetadataItem label="项目名称" value={project.name} />
        <MetadataItem
          label="根目录"
          value={compactProjectPath(project.rootPath)}
          title={project.rootPath}
          mono
          wide
          icon={<FolderOpen aria-hidden="true" />}
        />
        <MetadataItem
          label="创建时间"
          value={formatProjectTime(project.createdAt)}
          icon={<CalendarDays aria-hidden="true" />}
        />
        <MetadataItem
          label="最近更新"
          value={formatProjectTime(project.updatedAt)}
          icon={<CalendarDays aria-hidden="true" />}
        />
      </dl>
    </section>
  )
}

function ProjectAvailabilityPanel({ project }: { project: ProjectRecord }) {
  const available = project.availability === 'available'

  return (
    <section className="rounded-lg border border-border bg-surface/65 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section font-semibold text-text-primary">
          访问状态
        </h2>
        <ProjectAvailabilityBadge availability={project.availability} />
      </div>
      <p className="mt-3 text-sm font-regular text-text-secondary">
        {available
          ? 'CodeTether 已验证该目录，可以在此工作区中启动会话。'
          : '持久项目记录仍可查看，但工作区相关操作会安全失败。'}
      </p>
      <Separator className="my-5" />
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          aria-hidden="true"
          className={available ? 'size-4 text-success' : 'size-4 text-warning'}
        />
        <div>
          <p className="text-sm font-medium text-text-primary">
            本地工作区授权
          </p>
          <p className="mt-1 text-xs font-regular text-text-muted">
            智能体只能在该项目根目录及其受验证的子目录内工作。
          </p>
        </div>
      </div>
    </section>
  )
}

interface MetadataItemProps {
  icon?: ReactNode
  label: string
  mono?: boolean
  title?: string
  value: string
  wide?: boolean
}

function MetadataItem({
  icon,
  label,
  mono = false,
  title,
  value,
  wide,
}: MetadataItemProps) {
  return (
    <div className={wide ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
      <dt className="flex items-center gap-1.5 text-xs font-regular text-text-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd
        title={title}
        className={cn(
          'mt-1.5 truncate text-base font-regular text-text-primary',
          mono && 'font-mono text-sm',
        )}
      >
        {value}
      </dd>
    </div>
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
