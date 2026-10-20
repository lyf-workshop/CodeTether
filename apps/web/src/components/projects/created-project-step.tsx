import { useQuery } from '@tanstack/react-query'
import type { MachineId, ProjectRecord } from '@codetether/protocol'
import {
  Button,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Notice,
  SectionState,
} from '@codetether/ui'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { PreviousConversationsStep } from './previous-conversations-step'
import type { CreatedProjectContext } from './use-add-project-dialog'

export function CreatedProjectStep({
  context,
  machineName,
  onFinished,
}: {
  readonly context: CreatedProjectContext
  readonly machineName: string
  readonly onFinished: (
    project: ProjectRecord,
    created: boolean,
    machineId: MachineId,
  ) => Promise<void>
}) {
  const runtime = useHostRuntime()
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, context.projectId),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const project = projectQuery.data
  const location = project?.locations.find(
    (candidate) => candidate.machineId === context.machineId,
  )
  return (
    <div className="min-w-0 space-y-5">
      <DialogHeader>
        <DialogTitle className="break-words">
          已添加 {project?.name ?? '项目'}
        </DialogTitle>
        <DialogDescription>
          可以选择导入以前的会话，也可以跳过并直接开始。
        </DialogDescription>
      </DialogHeader>
      <Notice role="status" tone="ok" title="项目已添加">
        <span className="block break-words">{machineName}</span>
        {location ? (
          <span
            className="block break-all font-mono text-xs"
            title={location.rootPath}
          >
            {location.rootPath}
          </span>
        ) : null}
      </Notice>
      {project ? (
        <PreviousConversationsStep
          key={`${context.projectId}:${context.machineId}`}
          presentation="page"
          projectId={context.projectId}
          machineId={context.machineId}
          onFinished={() =>
            onFinished(project, context.created, context.machineId)
          }
        />
      ) : (
        <SectionState
          state={projectQuery.isError ? 'error' : 'loading'}
          title={projectQuery.isError ? '暂时无法读取项目' : '正在读取项目'}
          description="项目已经添加成功，不需要重新添加。"
          action={
            projectQuery.isError ? (
              <Button
                variant="secondary"
                onClick={() => void projectQuery.refetch()}
              >
                重新读取
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
