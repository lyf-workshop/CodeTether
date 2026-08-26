import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { AtSign, Hash, LockKeyhole, Paperclip, Send, Zap } from 'lucide-react'

import {
  Button,
  IconButton,
  Separator,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@codetether/ui'

import type { ConversationDetailMock } from '../../mocks/conversation-detail'

interface ComposerProps {
  conversation: ConversationDetailMock['conversation']
}

const quickActions = [
  { label: '/ 命令', accessibleLabel: '/ 命令', icon: null },
  { label: '引用', accessibleLabel: '@ 引用', icon: AtSign },
  { label: '! 终端', accessibleLabel: '! 终端', icon: null },
  { label: '技能', accessibleLabel: '# 技能', icon: Hash },
  { label: '附件', accessibleLabel: '附件', icon: Paperclip },
] as const

export function Composer({ conversation }: ComposerProps) {
  const [value, setValue] = useState('')
  const canSend = value.trim().length > 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSend) {
      event.preventDefault()
    }
  }

  return (
    <form
      aria-label="会话输入区"
      onSubmit={handleSubmit}
      className="flex h-[var(--layout-conversation-composer-height)] min-w-0 flex-col overflow-hidden rounded-md border border-border-strong bg-surface/70 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto px-2 pt-2">
        {quickActions.map(({ label, accessibleLabel, icon: Icon }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-sm text-text-muted hover:bg-surface-muted/70 hover:text-text-primary"
            aria-label={`${accessibleLabel}（演示）`}
          >
            {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
            {label}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-2 px-3 py-1">
        <label htmlFor="conversation-composer" className="sr-only">
          输入消息
        </label>
        <Textarea
          id="conversation-composer"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="输入消息…"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          className="min-h-12 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-base font-regular leading-normal placeholder:text-text-secondary/80 hover:border-transparent hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0"
        />
        <IconButton
          type="submit"
          label="发送消息（演示）"
          disabled={!canSend}
          className="mt-2 size-[var(--avatar-size-md)]"
        >
          <Send aria-hidden="true" />
        </IconButton>
      </div>

      <Separator className="bg-border/65" />

      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto px-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              tabIndex={0}
              role="note"
              aria-label={`智能体 ${conversation.agent}，已锁定`}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm font-regular text-text-secondary outline-none hover:bg-surface-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <LockKeyhole
                aria-hidden="true"
                className="size-3 text-text-muted"
              />
              <span className="text-text-muted">智能体</span>
              <span>Codex</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-72">
            此会话由 Codex 创建。如需使用其他智能体，请新建会话。
          </TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-sm text-text-secondary hover:bg-surface-muted/70"
        >
          <span className="text-text-muted">模型</span>
          {conversation.model}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-sm text-text-secondary hover:bg-surface-muted/70"
        >
          <span className="text-text-muted">推理</span>
          {conversation.reasoning}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-sm text-text-secondary hover:bg-surface-muted/70"
        >
          <span className="text-text-muted">权限</span>
          {conversation.permission}
        </Button>
        <IconButton
          type="button"
          label="添加上下文（演示）"
          variant="ghost"
          size="sm"
          className="size-7 text-text-muted hover:bg-surface-muted/70 hover:text-text-primary"
        >
          <Hash aria-hidden="true" />
        </IconButton>
        <IconButton
          type="button"
          label="快速操作（演示）"
          variant="ghost"
          size="sm"
          className="size-7 text-text-muted hover:bg-surface-muted/70 hover:text-text-primary"
        >
          <Zap aria-hidden="true" />
        </IconButton>
        <kbd
          aria-hidden="true"
          className="ml-auto shrink-0 font-sans text-xs text-text-muted"
        >
          ⌘↵ 发送
        </kbd>
      </div>
    </form>
  )
}
