import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import { Copy } from 'lucide-react'

import { cn } from '../../lib/cn'
import { Button } from '../button'
import { CommandCopyTask, type CommandCopyState } from './command-copy-task'

export interface CodeBlockToken {
  readonly text: string
  readonly tone?: 'muted' | 'keyword' | 'string' | 'name' | 'value'
}

export interface CodeBlockProps extends Omit<
  ComponentPropsWithoutRef<'pre'>,
  'children'
> {
  code: string
  language?: string
  showLineNumbers?: boolean
  startLineNumber?: number
  appearance?: 'message'
  highlightedLines?: readonly (readonly CodeBlockToken[])[]
  expansionKey?: string
}

const tokenClasses = {
  muted: 'text-message-code-muted',
  keyword: 'text-message-code-keyword',
  string: 'text-message-code-string',
  name: 'text-message-code-name',
  value: 'text-message-code-value',
} satisfies Record<NonNullable<CodeBlockToken['tone']>, string>

const COLLAPSE_ABOVE_LINES = 30
const COLLAPSED_HEAD_LINES = 10
const COLLAPSED_TAIL_LINES = 5
const EXPANSION_STORAGE_PREFIX = 'codetether:code-block-expanded:'

type CodeBlockBodyProps = Omit<CodeBlockProps, 'appearance' | 'expansionKey'>

export function CodeBlock({
  appearance,
  expansionKey,
  ...props
}: CodeBlockProps) {
  if (appearance === 'message') {
    return (
      <MessageCodeBlock
        {...props}
        key={expansionKey}
        expansionKey={expansionKey}
      />
    )
  }
  return <CodeBlockBody {...props} />
}

function MessageCodeBlock({
  expansionKey,
  ...props
}: CodeBlockBodyProps & { expansionKey?: string }) {
  const blockId = useId()
  const storageKey =
    expansionKey === undefined
      ? undefined
      : EXPANSION_STORAGE_PREFIX + expansionKey
  const [expanded, setExpanded] = useState(() => {
    try {
      return (
        storageKey !== undefined &&
        window.localStorage.getItem(storageKey) === '1'
      )
    } catch {
      return false
    }
  })

  function toggleExpanded() {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (storageKey === undefined) return
    try {
      if (nextExpanded) window.localStorage.setItem(storageKey, '1')
      else window.localStorage.removeItem(storageKey)
    } catch {
      // The control still works when browser storage is unavailable.
    }
  }

  return (
    <div className="group/code-block min-w-0 max-w-full rounded-md border border-border/70 bg-message-code-background">
      <div className="flex h-8 min-w-0 items-center justify-between gap-2 rounded-t-md bg-message-code-header px-3 text-xs text-message-code-muted">
        <span className="truncate">{props.language ?? '纯文本'}</span>
        <CopyCodeButton key={props.code} code={props.code} />
      </div>
      <CodeBlockBody
        {...props}
        id={props.id ?? blockId}
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
      />
    </div>
  )
}

function CodeBlockBody({
  code,
  language,
  showLineNumbers = true,
  startLineNumber = 1,
  highlightedLines,
  className,
  expanded,
  onToggleExpanded,
  tabIndex,
  id,
  'aria-label': ariaLabel,
  ...props
}: CodeBlockBodyProps & { expanded?: boolean; onToggleExpanded?: () => void }) {
  const lines = code.split(/\r?\n/u)
  const isMessage = onToggleExpanded !== undefined
  const canCollapse = isMessage && lines.length > COLLAPSE_ABOVE_LINES
  const collapsed = canCollapse && expanded !== true
  const tailStart = lines.length - COLLAPSED_TAIL_LINES
  const hiddenLineCount = tailStart - COLLAPSED_HEAD_LINES
  const restStart = collapsed ? tailStart : COLLAPSED_HEAD_LINES

  const renderLine = (line: string, index: number) => {
    const tokens = highlightedLines?.[index]
    return (
      <span
        key={index}
        data-code-line={startLineNumber + index}
        className="flex min-h-4 min-w-max"
      >
        {showLineNumbers ? (
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 select-none pr-2 text-right tabular-nums',
              isMessage
                ? 'w-10 text-message-code-muted'
                : 'w-8 text-text-muted',
            )}
          >
            {startLineNumber + index}
          </span>
        ) : null}
        <span className="whitespace-pre [overflow-wrap:normal]">
          {tokens?.length
            ? tokens.map((token, tokenIndex) => (
                <span
                  key={tokenIndex}
                  className={
                    token.tone === undefined
                      ? undefined
                      : tokenClasses[token.tone]
                  }
                >
                  {token.text}
                </span>
              ))
            : line || '\u00a0'}
        </span>
      </span>
    )
  }

  const toggle = canCollapse ? (
    <span className="sticky left-0 block w-fit py-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={!collapsed}
        aria-controls={id}
        className="text-message-code-muted hover:bg-message-code-header hover:text-message-code-text active:bg-message-code-header"
        onClick={onToggleExpanded}
      >
        {collapsed
          ? '展开 ' + hiddenLineCount + ' 行'
          : '收起 ' + hiddenLineCount + ' 行'}
      </Button>
    </span>
  ) : null

  return (
    <pre
      id={id}
      tabIndex={tabIndex ?? 0}
      aria-label={
        ariaLabel ?? (language === undefined ? '代码块' : language + ' 代码块')
      }
      data-language={language}
      data-slot="code-block"
      className={cn(
        'w-full min-w-0 overflow-x-auto p-3 font-mono text-xs font-regular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isMessage
          ? 'rounded-b-md text-message-code-text focus-visible:ring-inset'
          : 'rounded-sm border border-border bg-background text-info',
        className,
      )}
      {...props}
    >
      <code className="block min-w-max font-mono">
        {(canCollapse ? lines.slice(0, COLLAPSED_HEAD_LINES) : lines).map(
          renderLine,
        )}
        {toggle}
        {canCollapse
          ? lines
              .slice(restStart)
              .map((line, index) => renderLine(line, restStart + index))
          : null}
      </code>
    </pre>
  )
}

function CopyCodeButton({ code }: { code: string }) {
  const [state, setState] = useState<CommandCopyState>('idle')
  const taskRef = useRef<CommandCopyTask | undefined>(undefined)
  useEffect(
    () => () => {
      taskRef.current?.dispose()
      taskRef.current = undefined
    },
    [],
  )

  function copyCode() {
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
      // Restricted clipboard access has the same manual-copy fallback.
    }
    void taskRef.current.copy(code, writer)
  }

  const failed = state === 'unavailable' || state === 'failed'
  const label = failed
    ? '复制失败'
    : state === 'pending'
      ? '正在复制…'
      : state === 'copied'
        ? '已复制'
        : '复制'

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={label === '复制' ? '复制代码' : label}
        aria-busy={state === 'pending'}
        aria-disabled={state === 'pending' || undefined}
        className="text-message-code-text opacity-0 group-hover/code-block:opacity-100 group-focus-within/code-block:opacity-100 focus-visible:opacity-100 hover:bg-message-code-background hover:text-message-code-text active:bg-message-code-background pointer-coarse:opacity-100"
        onClick={copyCode}
      >
        <Copy aria-hidden="true" />
        {label}
      </Button>
      <span role="status" className="sr-only">
        {failed ? '无法自动复制，请选中代码手动复制。' : null}
      </span>
    </>
  )
}
