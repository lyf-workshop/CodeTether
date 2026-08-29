import { memo, type ReactNode } from 'react'

import {
  parseMessageMarkdown,
  type MessageMarkdownInline,
} from './message-markdown-model'
import { presentProjectPaths } from './message-presentation'

interface MessageMarkdownProps {
  readonly children: string
  readonly projectRootPath?: string
}

export const MessageMarkdown = memo(function MessageMarkdown({
  children,
  projectRootPath,
}: MessageMarkdownProps) {
  const blocks = parseMessageMarkdown(children)

  return (
    <div className="mt-2 min-w-0 space-y-3 break-words text-base font-regular leading-normal text-text-primary [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        const key = `${block.kind}:${index}`
        if (block.kind === 'paragraph') {
          return (
            <p key={key} className="whitespace-pre-wrap">
              <InlineContent
                tokens={block.children}
                projectRootPath={projectRootPath}
              />
            </p>
          )
        }
        if (block.kind === 'heading') {
          const className =
            block.level === 1
              ? 'text-lg font-semibold'
              : 'text-md font-semibold'
          if (block.level === 1) {
            return (
              <h2 key={key} className={className}>
                <InlineContent
                  tokens={block.children}
                  projectRootPath={projectRootPath}
                />
              </h2>
            )
          }
          return (
            <h3 key={key} className={className}>
              <InlineContent
                tokens={block.children}
                projectRootPath={projectRootPath}
              />
            </h3>
          )
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List
              key={key}
              {...(block.ordered && block.start !== undefined
                ? { start: block.start }
                : {})}
              className={
                block.ordered
                  ? 'list-decimal space-y-1 pl-5'
                  : 'list-disc space-y-1 pl-5'
              }
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}:${itemIndex}`}>
                  <InlineContent
                    tokens={item}
                    projectRootPath={projectRootPath}
                  />
                </li>
              ))}
            </List>
          )
        }
        return (
          <pre
            key={key}
            tabIndex={0}
            aria-label={
              block.language ? `${block.language} 代码块` : 'Agent 代码块'
            }
            className="max-w-full overflow-x-auto rounded-sm border border-border/70 bg-surface-code/80 p-3 text-sm leading-relaxed text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <code>{presentProjectPaths(block.value, projectRootPath)}</code>
          </pre>
        )
      })}
    </div>
  )
})

function InlineContent({
  projectRootPath,
  tokens,
}: {
  readonly projectRootPath?: string
  readonly tokens: readonly MessageMarkdownInline[]
}) {
  return tokens.map((token, index): ReactNode => {
    const key = `${token.kind}:${index}`
    if (token.kind === 'text') {
      return presentProjectPaths(token.value, projectRootPath)
    }
    if (token.kind === 'code') {
      return (
        <code
          key={key}
          className="rounded-xs bg-surface-code px-1 py-0.5 font-mono text-[0.9em] text-text-secondary"
        >
          {presentProjectPaths(token.value, projectRootPath)}
        </code>
      )
    }
    if (token.kind === 'strong') {
      return (
        <strong key={key} className="font-semibold text-text-primary">
          <InlineContent
            tokens={token.children}
            projectRootPath={projectRootPath}
          />
        </strong>
      )
    }
    return (
      <a
        key={key}
        href={token.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/40 underline-offset-2 hover:text-primary-hover focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <InlineContent
          tokens={token.children}
          projectRootPath={projectRootPath}
        />
      </a>
    )
  })
}
