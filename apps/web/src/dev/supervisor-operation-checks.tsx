import { useEffect, useRef, useState } from 'react'
import type { ActionId } from '@codetether/protocol'
import { Button, Notice } from '@codetether/ui'

import { createBrowserActionId } from '../runtime/host/action-id.js'
import type { SupervisorCheckConnectionOptions } from './supervisor-check-client.js'
import {
  diagnosticOperationError,
  inspectDiagnosticOperations,
  runDiagnosticMutation,
  withDiagnosticSession,
  type DiagnosticMutation,
  type OperationMeasurement,
} from './supervisor-operation-client.js'

export function SupervisorOperationChecks({
  disabled,
  ...connection
}: Omit<SupervisorCheckConnectionOptions, 'signal'> & {
  readonly disabled: boolean
}) {
  const active = useRef<AbortController | undefined>(undefined)
  const actionIds = useRef(new Map<string, ActionId>())
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [reads, setReads] = useState<readonly OperationMeasurement[]>([])
  const [actions, setActions] = useState<readonly DiagnosticMutation[]>([])
  const [writes, setWrites] = useState<readonly OperationMeasurement[]>([])
  const [allowMutations, setAllowMutations] = useState(false)

  useEffect(
    () => () => {
      active.current?.abort()
      active.current = undefined
    },
    [],
  )

  async function run(action?: DiagnosticMutation) {
    if (
      disabled ||
      active.current !== undefined ||
      (action !== undefined && !allowMutations)
    )
      return
    const controller = new AbortController()
    active.current = controller
    setRunning(true)
    setError(undefined)
    const current = () =>
      active.current === controller && !controller.signal.aborted
    try {
      if (action === undefined) {
        setActions([])
        setReads([])
        setAllowMutations(false)
        const result = await withDiagnosticSession(
          { ...connection, signal: controller.signal },
          inspectDiagnosticOperations,
        )
        if (current()) {
          setReads(result.measurements)
          setActions(result.actions)
        }
      } else {
        const key = JSON.stringify(action)
        const id = actionIds.current.get(key) ?? createBrowserActionId()
        actionIds.current.set(key, id)
        const result = await withDiagnosticSession(
          { ...connection, signal: controller.signal },
          (session, signal) =>
            runDiagnosticMutation(session, action, id, signal),
        )
        if (!current()) return
        setWrites((previous) => [
          ...previous.filter((entry) => entry.operation !== result.operation),
          result,
        ])
        if (result.status === '成功') {
          setActions((previous) =>
            previous.filter(
              (candidate) => candidate.operation !== action.operation,
            ),
          )
          setAllowMutations(false)
        }
      }
    } catch (caught) {
      if (active.current === controller)
        setError(diagnosticOperationError(caught))
    } finally {
      if (active.current === controller) {
        active.current = undefined
        setRunning(false)
      }
    }
  }

  return (
    <section
      aria-labelledby="supervisor-operation-checks-title"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <h2
        id="supervisor-operation-checks-title"
        className="text-base font-semibold"
      >
        远程操作检查
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={disabled || running}
          onClick={() => void run()}
        >
          检查最近会话、待处理和变更
        </Button>
        <Button
          variant="secondary"
          disabled={!running}
          onClick={() => active.current?.abort()}
        >
          取消操作检查
        </Button>
      </div>
      {error === undefined ? null : (
        <Notice tone="err">错误类型：{error}</Notice>
      )}
      {reads.length + writes.length === 0 ? null : (
        <ul aria-live="polite" className="space-y-1 text-sm">
          {[...reads, ...writes].map((entry) => (
            <li key={entry.operation}>
              {entry.operation} · {entry.status} · {entry.transport}
              {entry.elapsedMs === null ? '' : ` · ${entry.elapsedMs} ms`}
              {entry.detail === undefined ? '' : ` · ${entry.detail}`}
            </li>
          ))}
        </ul>
      )}
      {actions.length > 0 ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowMutations}
              disabled={disabled || running}
              onChange={(event) => setAllowMutations(event.target.checked)}
            />
            确认对选定电脑上的实际任务执行操作
          </label>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={JSON.stringify(action)}
                variant="secondary"
                disabled={disabled || running || !allowMutations}
                onClick={() => void run(action)}
              >
                {action.operation === 'attention.resolve'
                  ? '标记处理完成'
                  : action.operation === 'turn.interrupt'
                    ? '停止正在运行的任务'
                    : action.decision === 'accept'
                      ? '批准'
                      : '拒绝'}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
