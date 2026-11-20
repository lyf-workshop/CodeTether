import { memo, useEffect, useState, type ReactNode } from 'react'

import {
  CodeBlock,
  type CodeBlockToken,
} from '@codetether/ui/components/product/code-block'

import {
  highlightMessageCode,
  messageCodeLanguage,
  messageCodeLanguageLabel,
} from './message-code-highlight'

import {
  parseMessageMarkdown,
  type MessageMarkdownInline,
} from './message-markdown-model'
import { presentProjectPaths } from './message-presentation'

interface MessageMarkdownProps {
  readonly children: string
  readonly messageId?: string
  readonly projectRootPath?: string
}

export const MessageMarkdown = memo(function MessageMarkdown({
  children,
  messageId,
  projectRootPath,
}: MessageMarkdownProps) {
  const blocks = parseMessageMarkdown(children)

  return (
    <div className="mt-2 min-w-0 space-y-3 break-words text-timeline-message-size font-regular leading-normal text-text-primary [overflow-wrap:anywhere]">
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
          <MessageCodeBlock
            key={key}
            code={presentProjectPaths(block.value, projectRootPath)}
            fence={block.language}
            expansionKey={
              messageId === undefined ? undefined : messageId + ':' + index
            }
          />
        )
      })}
    </div>
  )
})

function MessageCodeBlock({
  code,
  fence,
  expansionKey,
}: {
  readonly code: string
  readonly fence?: string
  readonly expansionKey?: string
}) {
  const language = messageCodeLanguage(fence)
  const [highlight, setHighlight] = useState<{
    readonly code: string
    readonly language: typeof language
    readonly lines: readonly (readonly CodeBlockToken[])[]
  }>()

  useEffect(() => {
    if (language === undefined) return
    let active = true
    void highlightMessageCode(code, language).then(
      (lines) => {
        if (active) setHighlight({ code, language, lines })
      },
      () => {
        // Plain text stays readable if a grammar cannot load or tokenize.
      },
    )
    return () => {
      active = false
    }
  }, [code, language])

  return (
    <CodeBlock
      appearance="message"
      code={code}
      language={messageCodeLanguageLabel(language)}
      expansionKey={expansionKey}
      highlightedLines={
        highlight?.code === code && highlight.language === language
          ? highlight.lines
          : undefined
      }
    />
  )
}

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
