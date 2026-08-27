import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderPlus, RefreshCw } from 'lucide-react'

import { Button } from '@codetether/ui'
import type { ProjectRecord } from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { projectListViewState } from '../../runtime/host/project-view-state'
import { AddProjectDialog } from './add-project-dialog'
import {
  ProjectsEmptyState,
  ProjectsErrorState,
  ProjectsLoadingState,
} from './project-page-states'
import { ProjectRow } from './project-row'
import { RemoveProjectDialog } from './remove-project-dialog'

export function ProjectsPage() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const removeReturnFocusRef = useRef<HTMLElement | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const viewState = projectListViewState(projectsQuery)
  const projects = viewState.kind === 'ready' ? viewState.projects : []
  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    !connectionUnavailable &&
    (viewState.kind === 'loading' ||
      (connectionState !== 'connected' && projectsQuery.data === undefined))

  function handleRetry() {
    runtime.retry()
    if (connectionState === 'connected') void projectsQuery.refetch()
  }

  function handleRemoveRequest(
    project: ProjectRecord,
    returnFocusTarget: HTMLElement | null,
  ) {
    removeReturnFocusRef.current = returnFocusTarget
    setRemoveTarget(project)
  }

  function handleRemoveOpenChange(open: boolean) {
    if (open) return
    setRemoveTarget(null)
    requestAnimationFrame(() => {
      if (removeReturnFocusRef.current?.isConnected) {
        removeReturnFocusRef.current.focus()
      }
      removeReturnFocusRef.current = null
    })
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-text-primary">项目</h1>
          <p className="mt-0.5 text-sm font-regular text-text-secondary">
            管理 CodeTether 可以访问的本地工作区。
          </p>
        </div>

        <AddProjectDialog
          trigger={
            <Button
              size="sm"
              className="h-9 px-4"
              disabled={connectionState !== 'connected'}
            >
              <FolderPlus aria-hidden="true" />
              添加项目
            </Button>
          }
        />
      </header>

      <div className="mt-6 min-w-0 flex-1">
        {connectionUnavailable ? (
          <ProjectsErrorState
            incompatible={connectionState === 'incompatible'}
            onRetry={handleRetry}
          />
        ) : loading ? (
          <ProjectsLoadingState />
        ) : viewState.kind === 'unavailable' ? (
          <ProjectsErrorState title="无法读取项目" onRetry={handleRetry} />
        ) : viewState.kind === 'empty' ? (
          <ProjectsEmptyState
            action={
              <AddProjectDialog
                trigger={
                  <Button>
                    <FolderPlus aria-hidden="true" />
                    添加项目
                  </Button>
                }
              />
            }
          />
        ) : (
          <section aria-labelledby="project-list-heading">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
              <div>
                <h2
                  id="project-list-heading"
                  className="text-sm font-medium text-text-primary"
                >
                  已授权工作区
                </h2>
                <p className="mt-0.5 text-xs font-regular text-text-muted">
                  共 {projects.length} 个项目
                </p>
              </div>
              {connectionState === 'reconnecting' ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 text-xs font-regular text-text-muted"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  正在重新连接
                </span>
              ) : null}
            </div>

            <div className="space-y-4">
              {projects.map((project) => (
                <ProjectRow
                  key={project.projectId}
                  project={project}
                  onRemove={handleRemoveRequest}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {removeTarget ? (
        <RemoveProjectDialog
          open
          project={removeTarget}
          onOpenChange={handleRemoveOpenChange}
        />
      ) : null}
    </div>
  )
}
