import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Folder, Plus, Trash2 } from 'lucide-react'

import { Button, Notice, SectionState } from '@codetether/ui'
import { ProjectIdSchema, type ProjectId } from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { projectDetailViewState } from '../../runtime/host/project-view-state'
import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { deviceProjectState } from '../machines/device-project-model'
import { PreviousConversationsStep } from './previous-conversations-step'
import { ProjectConversationCollection } from './project-conversation-collection'
import { RemoveProjectDialog } from './remove-project-dialog'
import {
  parseProjectWorkspaceSearch,
  resolveProjectWorkspaceContext,
  type ProjectWorkspaceSearch,
} from './project-workspace-model'

export function ProjectDetailRoute({
  searchPage = false,
}: {
  searchPage?: boolean
}) {
  const { projectId: rawProjectId } = useParams({ strict: false })
  const search = parseProjectWorkspaceSearch(useSearch({ strict: false }))
  const projectId = ProjectIdSchema.safeParse(rawProjectId)
  return projectId.success ? (
    <ProjectDetailPage
      projectId={projectId.data}
      search={search}
      searchPage={searchPage || Boolean(search.q)}
    />
  ) : (
    <ProjectNotFound />
  )
}

export function ProjectSearchRoute() {
  return <ProjectDetailRoute searchPage />
}

function ProjectDetailPage({
  projectId,
  search,
  searchPage,
}: {
  projectId: ProjectId
  search: ProjectWorkspaceSearch
  searchPage: boolean
}) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const removeTrigger = useRef<HTMLButtonElement>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const viewState = projectDetailViewState(projectQuery)

  function retry() {
    runtime.retry()
    if (connectionState === 'connected') {
      void projectQuery.refetch()
      void machinesQuery.refetch()
    }
  }
  if (viewState.kind === 'not-found') return <ProjectNotFound />
  if (
    viewState.kind === 'loading' ||
    (projectQuery.data === undefined &&
      !projectQuery.isError &&
      connectionState !== 'unavailable' &&
      connectionState !== 'incompatible')
  )
    return (
      <ProjectFrame>
        <SectionState state="loading" title="正在读取项目" />
      </ProjectFrame>
    )
  if (viewState.kind === 'host-unavailable' || projectQuery.data === undefined)
    return (
      <ProjectFrame>
        <SectionState
          state="error"
          title="暂时无法读取项目"
          description="项目和会话历史会继续保留，请恢复连接后重试。"
          action={
            <Button variant="secondary" onClick={retry}>
              重试
            </Button>
          }
        />
      </ProjectFrame>
    )
  const project = projectQuery.data
  const context = resolveProjectWorkspaceContext(
    project,
    search.machineId,
    search.invalidMachineId === true,
  )
  if (context.kind !== 'selected')
    return (
      <ProjectFrame>
        <h1 className="mb-6 text-page font-semibold">{project.name}</h1>
        <Notice
          tone={context.kind === 'invalid-device' ? 'warn' : 'info'}
          title={
            context.kind === 'invalid-device'
              ? '这个项目不在所选设备上'
              : context.kind === 'missing-location'
                ? '项目没有可用的位置记录'
                : '选择要查看的设备'
          }
        >
          {context.kind === 'choose-device'
            ? '这个旧项目在多个设备上有独立的文件夹。请选择一个明确的位置，查看那台设备上的会话。'
            : context.kind === 'invalid-device'
              ? '所选设备没有这个项目的位置记录。请选择下面列出的设备。'
              : '项目和已有会话仍然保留，当前没有可以明确关联到设备的位置记录。'}
        </Notice>
        <ul className="mt-4 space-y-3">
          {project.locations.map((location) => (
            <li key={location.machineId}>
              <Link
                to={
                  searchPage
                    ? '/projects/$projectId/search'
                    : '/projects/$projectId'
                }
                params={{ projectId }}
                search={{
                  ...search,
                  invalidMachineId: undefined,
                  machineId: location.machineId,
                }}
                className="block min-w-0 rounded-lg border border-border bg-surface p-4 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-base font-medium">
                  {machinesQuery.data?.find(
                    (machine) => machine.machineId === location.machineId,
                  )?.displayName ?? '设备名称暂时未知'}
                </p>
                <p
                  title={location.rootPath}
                  className="mt-1 truncate font-mono text-sm text-text-muted"
                >
                  {location.rootPath}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </ProjectFrame>
    )
  const location = context.location
  const machine = machinesQuery.data?.find(
    (candidate) => candidate.machineId === location.machineId,
  )
  const state =
    machine === undefined
      ? {
          available: false,
          label: '设备状态尚未取得',
          reason: '暂时无法确认这台设备的当前状态。',
        }
      : deviceProjectState(machine, location)
  const canCreate =
    connectionState === 'connected' && machine !== undefined && state.available
  const archived = search.view === 'archived'

  function closeRemoval(open: boolean) {
    setRemoveOpen(open)
    if (!open) requestAnimationFrame(() => removeTrigger.current?.focus())
  }

  return (
    <ProjectFrame>
      <Link
        to={searchPage ? '/projects/$projectId' : '/devices/$machineId'}
        params={searchPage ? { projectId } : { machineId: location.machineId }}
        search={searchPage ? { machineId: location.machineId } : {}}
        className="mb-4 inline-flex items-center gap-1.5 rounded-xs text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {searchPage ? '返回项目' : '返回设备'}
      </Link>
      <header className="mb-8 flex min-w-0 flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-surface-inset text-text-muted"
        >
          <Folder className="size-6" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h1 title={project.name} className="truncate text-page font-semibold">
            {searchPage ? `在 ${project.name} 中搜索` : project.name}
          </h1>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm text-text-muted">
            <Link
              to="/devices/$machineId"
              params={{ machineId: location.machineId }}
              className="rounded-xs outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {machine?.displayName ?? '设备名称暂时未知'}
            </Link>
            <span aria-hidden="true">·</span>
            <span
              title={location.rootPath}
              className="min-w-0 truncate font-mono"
            >
              {location.rootPath}
            </span>
          </div>
        </div>
        {!searchPage ? (
          <NewConversationDialog
            currentProject={project}
            currentMachineId={location.machineId}
            trigger={
              <Button disabled={!canCreate} title={state.reason}>
                <Plus aria-hidden="true" />
                新建会话
              </Button>
            }
          />
        ) : null}
      </header>
      {!state.available ? (
        <div className="mb-6">
          <Notice
            role="status"
            tone="warn"
            title={state.label}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link
                  to="/devices/$machineId"
                  params={{ machineId: location.machineId }}
                >
                  查看设备
                </Link>
              </Button>
            }
          >
            {state.reason}
          </Notice>
        </div>
      ) : null}
      <ProjectConversationCollection
        key={`${projectId}:${location.machineId}`}
        projectId={projectId}
        machineId={location.machineId}
        projectName={project.name}
        search={{ ...search, machineId: location.machineId }}
        searchPage={searchPage}
      />
      {!searchPage && !archived ? (
        <>
          <section className="mt-10 min-w-0" aria-label="以前的会话">
            <PreviousConversationsStep
              key={`${projectId}:${location.machineId}`}
              projectId={projectId}
              machineId={location.machineId}
              presentation="embedded"
              onFinished={() => undefined}
            />
          </section>
          <section
            className="mt-10 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-5"
            aria-labelledby="project-removal-heading"
          >
            <div className="min-w-0 flex-1 basis-48">
              <h2
                id="project-removal-heading"
                className="text-base font-semibold"
              >
                移除项目
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                还有会话（包括已归档）时不能移除。只从 CodeTether
                中移除，不删除任何文件。
              </p>
            </div>
            <Button
              ref={removeTrigger}
              variant="danger"
              size="sm"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              移除
            </Button>
          </section>
        </>
      ) : null}
      <RemoveProjectDialog
        project={project}
        open={removeOpen}
        onOpenChange={closeRemoval}
      />
    </ProjectFrame>
  )
}

function ProjectNotFound() {
  return (
    <ProjectFrame>
      <SectionState
        state="empty"
        title="项目不存在"
        description="项目记录不存在，或链接中的项目标识无效。"
        action={
          <Button asChild variant="secondary">
            <Link to="/devices">返回设备</Link>
          </Button>
        }
      />
    </ProjectFrame>
  )
}

function ProjectFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-full w-full min-w-0 max-w-(--page-w) px-4 py-6 sm:px-8">
      {children}
    </div>
  )
}
