import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Notice,
  SectionState,
} from '@codetether/ui'
import { AddProjectFields } from './add-project-fields'
import { CreatedProjectStep } from './created-project-step'
import {
  useAddProjectDialog,
  type AddProjectDialogProps,
} from './use-add-project-dialog'

export function AddProjectDialog(props: AddProjectDialogProps) {
  const { fixedMachineId, returnFocusRef, trigger } = props
  const {
    open,
    handleOpenChange,
    createdProject,
    busy,
    skipCloseFocusRestore: skipCloseFocusRestoreRef,
    pathInputRef,
    pickerButtonRef,
    machinesQuery,
    connectionState,
    machines,
    target,
    targetReady,
    targetExplanation,
    canPickDirectory,
    pickerState,
    path,
    name,
    errorMessage,
    handleMachineChange,
    setPath,
    clearErrors,
    setNameOverride,
    handlePickDirectory,
    createMutation,
    handleSubmit,
    finishCreatedProject,
  } = useAddProjectDialog(props)
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        closeLabel="关闭添加项目对话框"
        className="ct-add-project-dialog max-w-lg overflow-x-hidden"
        showCloseButton={createdProject === undefined && !busy}
        aria-busy={busy}
        onCloseAutoFocus={(event) => {
          if (skipCloseFocusRestoreRef.current) {
            skipCloseFocusRestoreRef.current = false
            if (returnFocusRef !== undefined) event.preventDefault()
            return
          }
          if (!returnFocusRef?.current?.isConnected) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
        onOpenAutoFocus={(event) => {
          if (pathInputRef.current !== null) {
            event.preventDefault()
            pathInputRef.current.focus()
          }
        }}
      >
        {createdProject === undefined ? (
          <form
            className="min-w-0"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <DialogHeader>
              <DialogTitle>添加项目</DialogTitle>
              <DialogDescription>
                选择你平时用 Codex 或 Claude Code
                打开的文件夹。添加后会自动查找以前的会话。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 min-w-0 space-y-4">
              {machinesQuery.isPending && connectionState === 'connected' ? (
                <SectionState state="loading" title="正在读取设备" />
              ) : machinesQuery.isError ? (
                <SectionState
                  state="error"
                  title="暂时无法读取设备"
                  description="你的项目没有变化。请检查连接后重试。"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void machinesQuery.refetch()}
                    >
                      重新读取
                    </Button>
                  }
                />
              ) : (
                <>
                  <AddProjectFields
                    machines={machines}
                    machine={target.machine}
                    fixedMachine={fixedMachineId !== undefined}
                    ready={targetReady}
                    busy={busy}
                    canPickDirectory={canPickDirectory}
                    picking={pickerState === 'picking'}
                    path={path}
                    name={name}
                    hasError={errorMessage.length > 0}
                    pathInputRef={pathInputRef}
                    pickerButtonRef={pickerButtonRef}
                    onMachineChange={handleMachineChange}
                    onPathChange={(value) => {
                      setPath(value)
                      clearErrors()
                    }}
                    onNameChange={(value) => {
                      setNameOverride(value)
                      clearErrors()
                    }}
                    onPickDirectory={() => void handlePickDirectory()}
                  />
                  {targetExplanation ? (
                    <Notice tone="warn">{targetExplanation}</Notice>
                  ) : null}
                  {machinesQuery.data?.length === 0 ? (
                    <Notice title="还没有可用的设备">
                      在设备页添加设备，或等这台电脑恢复后再添加项目。
                    </Notice>
                  ) : null}
                </>
              )}
              {errorMessage ? (
                <Notice id="add-project-error" tone="err">
                  {errorMessage}
                </Notice>
              ) : null}
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button variant="secondary" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy || !targetReady}>
                {createMutation.isPending ? '正在添加…' : '添加'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <CreatedProjectStep
            context={createdProject}
            machineName={
              machinesQuery.data?.find(
                (machine) => machine.machineId === createdProject.machineId,
              )?.displayName ?? '所选设备'
            }
            onFinished={finishCreatedProject}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
