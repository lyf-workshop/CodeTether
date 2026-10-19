import type { RefObject } from 'react'
import { FolderOpen, Monitor } from 'lucide-react'

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@codetether/ui'
import type { MachineId, MachineSummary } from '@codetether/protocol'

import {
  fixedProjectCreationMachineExplanation,
  selectFixedProjectCreationMachine,
} from './project-creation-machine'

interface AddProjectFieldsProps {
  readonly machines: readonly MachineSummary[]
  readonly machine?: MachineSummary
  readonly fixedMachine: boolean
  readonly ready: boolean
  readonly busy: boolean
  readonly canPickDirectory: boolean
  readonly picking: boolean
  readonly path: string
  readonly name: string
  readonly hasError: boolean
  readonly pathInputRef: RefObject<HTMLInputElement | null>
  readonly pickerButtonRef: RefObject<HTMLButtonElement | null>
  readonly onMachineChange: (machineId: MachineId) => void
  readonly onPathChange: (path: string) => void
  readonly onNameChange: (name: string) => void
  readonly onPickDirectory: () => void
}

/** Project-specific form fields; all controls are shared accessible primitives. */
export function AddProjectFields({
  machines,
  machine,
  fixedMachine,
  ready,
  busy,
  canPickDirectory,
  picking,
  path,
  name,
  hasError,
  pathInputRef,
  pickerButtonRef,
  onMachineChange,
  onPathChange,
  onNameChange,
  onPickDirectory,
}: AddProjectFieldsProps) {
  const remote = machine?.kind === 'remote'
  const pathDescription = hasError
    ? 'add-project-path-description add-project-error'
    : 'add-project-path-description'

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0 space-y-2">
        <label
          htmlFor="add-project-machine"
          className="text-sm font-medium text-text-primary"
        >
          设备
        </label>
        {fixedMachine ? (
          <div
            id="add-project-machine"
            role="group"
            aria-label="已固定的设备"
            className="flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface-inset px-3 py-2 text-md"
          >
            <Monitor
              aria-hidden="true"
              className="size-4 shrink-0 text-text-muted"
            />
            <span className="min-w-0 truncate" title={machine?.displayName}>
              {machine?.displayName ?? '找不到这台设备'}
            </span>
            {machine?.isLocal ? (
              <span className="shrink-0 text-xs text-text-muted">这台电脑</span>
            ) : null}
          </div>
        ) : (
          <Select
            value={machine?.machineId ?? ''}
            disabled={busy || machines.length === 0}
            onValueChange={(value) => {
              const selected = machines.find(
                (candidate) => candidate.machineId === value,
              )
              if (selected !== undefined) onMachineChange(selected.machineId)
            }}
          >
            <SelectTrigger
              id="add-project-machine"
              aria-describedby="add-project-machine-description"
            >
              <SelectValue placeholder="选择设备" />
            </SelectTrigger>
            <SelectContent>
              {machines.map((candidate) => {
                const target = selectFixedProjectCreationMachine(
                  [candidate],
                  candidate.machineId,
                )
                const reason = fixedProjectCreationMachineExplanation(
                  target.state,
                )
                return (
                  <SelectItem
                    key={candidate.machineId}
                    value={candidate.machineId}
                    disabled={target.state !== 'ready'}
                    title={reason}
                  >
                    {candidate.displayName}
                    {candidate.isLocal ? '（这台电脑）' : ''}
                    {reason === undefined ? '' : ` · ${reason}`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}
        <p
          id="add-project-machine-description"
          className="text-xs text-text-muted"
        >
          离线的设备恢复在线后才能添加项目；设备也需要能够运行 AI 工具。
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        <label
          htmlFor="add-project-path"
          className="text-sm font-medium text-text-primary"
        >
          文件夹
        </label>
        <div className="flex min-w-0 gap-2 max-sm:flex-col">
          <Input
            ref={pathInputRef}
            id="add-project-path"
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            disabled={busy || !ready}
            autoComplete="off"
            spellCheck={false}
            title={path || undefined}
            placeholder={
              remote
                ? '/home/user/project'
                : machine?.platform === 'windows' ||
                    machine?.platform === 'win32'
                  ? 'C:\\Projects\\我的项目'
                  : '/Users/user/project'
            }
            aria-describedby={pathDescription}
            aria-invalid={hasError || undefined}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          {canPickDirectory ? (
            <Button
              ref={pickerButtonRef}
              id="add-project-directory-picker"
              type="button"
              variant="secondary"
              disabled={busy || !ready}
              aria-busy={picking}
              onClick={onPickDirectory}
              className="shrink-0"
            >
              <FolderOpen aria-hidden="true" />
              {picking ? '正在打开…' : '选择文件夹'}
            </Button>
          ) : null}
        </div>
        <p
          id="add-project-path-description"
          className="text-xs text-text-muted"
        >
          {remote
            ? `输入${machine.displayName}上的完整路径。配对设备暂不支持浏览文件夹。`
            : canPickDirectory
              ? '使用系统文件夹选择器，或输入这台电脑上的完整路径。'
              : '输入或粘贴这台电脑上的完整路径。'}
        </p>
        <p className="text-xs text-text-muted">
          AI
          工具只会在这个文件夹里工作。同一台设备上已添加过的文件夹会直接打开原项目。
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        <label
          htmlFor="add-project-name"
          className="text-sm font-medium text-text-primary"
        >
          名称
        </label>
        <Input
          id="add-project-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          disabled={busy || !ready}
          autoComplete="off"
          placeholder="默认使用文件夹名"
          aria-describedby="add-project-name-description"
        />
        <p
          id="add-project-name-description"
          className="text-xs text-text-muted"
        >
          默认使用文件夹名，也可以填写便于识别的名称。
        </p>
      </div>
    </div>
  )
}
