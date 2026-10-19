import { useEffect, useId, useRef, useState } from 'react'
import { Copy } from 'lucide-react'

import { Button } from '../button'
import { CodeBlock } from './code-block'
import { CommandCopyTask, type CommandCopyState } from './command-copy-task'

export interface CommandBlockProps {
  readonly code: string
  readonly label: string
}

/** Copy only. Changing the displayed command creates a new owned clipboard generation. */
export function CommandBlock(props: CommandBlockProps) {
  return <OwnedCommandBlock key={props.code} {...props} />
}

function OwnedCommandBlock({ code, label }: CommandBlockProps) {
  const statusId = useId()
  const [state, setState] = useState<CommandCopyState>('idle')
  const taskRef = useRef<CommandCopyTask | undefined>(undefined)
  useEffect(
    () => () => {
      taskRef.current?.dispose()
      taskRef.current = undefined
    },
    [],
  )

  function copyCommand() {
    if (taskRef.current === undefined) {
      const task = new CommandCopyTask()
      task.subscribe(() => setState(task.getSnapshot()))
      taskRef.current = task
    }
    let writer: ((text: string) => Promise<void>) | undefined
    try {
      const clipboard = navigator.clipboard
      if (clipboard !== undefined) writer = (text) => clipboard.writeText(text)
    } catch {
      // Restricted/unsupported clipboard access has the same manual-copy fallback.
    }
    void taskRef.current.copy(code, writer)
  }

  const failed = state === 'failed' || state === 'unavailable'
  return (
    <div
      className="mt-2 min-w-0"
      data-slot="command-block"
      data-copy-state={state}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <CodeBlock
          code={code}
          language="shell"
          showLineNumbers={false}
          aria-label={`${label}，命令内容`}
          className="min-w-0 flex-1 basis-48 rounded-lg bg-surface-inset font-mono text-text-primary [&_code]:font-mono"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`复制${label}`}
          aria-describedby={statusId}
          aria-busy={state === 'pending'}
          aria-disabled={state === 'pending' || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-60"
          onClick={copyCommand}
        >
          <Copy aria-hidden="true" />
          {state === 'pending'
            ? '正在复制…'
            : state === 'copied'
              ? '已复制'
              : '复制'}
        </Button>
      </div>
      <p
        id={statusId}
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
        className="mt-1 min-h-5 break-words text-xs text-text-secondary"
      >
        {failed
          ? '无法自动复制，请选中上方命令手动复制。'
          : state === 'copied'
            ? '命令已复制。粘贴前请确认目标设备和数据目录。'
            : state === 'pending'
              ? '正在等待剪贴板响应…'
              : null}
      </p>
    </div>
  )
}
