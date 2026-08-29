export type MessageMarkdownInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string }
  | {
      readonly kind: 'strong'
      readonly children: readonly MessageMarkdownInline[]
    }
  | {
      readonly kind: 'link'
      readonly href: string
      readonly children: readonly MessageMarkdownInline[]
    }

export type MessageMarkdownBlock =
  | {
      readonly kind: 'paragraph'
      readonly children: readonly MessageMarkdownInline[]
    }
  | {
      readonly kind: 'heading'
      readonly level: 1 | 2 | 3 | 4
      readonly children: readonly MessageMarkdownInline[]
    }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly start?: number
      readonly items: readonly (readonly MessageMarkdownInline[])[]
    }
  | {
      readonly kind: 'code-block'
      readonly language?: string
      readonly value: string
    }

const HEADING = /^(#{1,4})\s+(.+)$/u
const UNORDERED_LIST_ITEM = /^\s*[-+*]\s+(.+)$/u
const ORDERED_LIST_ITEM = /^\s*(\d+)[.)]\s+(.+)$/u
const CODE_FENCE = /^\s*```([^\s`]*)\s*$/u
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Parses the intentionally small Markdown subset used by Agent messages.
 * Unknown syntax and raw HTML remain inert text and are escaped by React.
 */
export function parseMessageMarkdown(
  source: string,
): readonly MessageMarkdownBlock[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: MessageMarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      index += 1
      continue
    }

    const fence = CODE_FENCE.exec(line)
    if (fence !== null) {
      const code: string[] = []
      const language = fence[1]?.trim()
      index += 1
      while (index < lines.length && !CODE_FENCE.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({
        kind: 'code-block',
        value: code.join('\n'),
        ...(language ? { language } : {}),
      })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length as 1 | 2 | 3 | 4,
        children: parseMessageMarkdownInline(heading[2] ?? ''),
      })
      index += 1
      continue
    }

    const unordered = UNORDERED_LIST_ITEM.exec(line)
    const ordered = ORDERED_LIST_ITEM.exec(line)
    if (unordered !== null || ordered !== null) {
      const orderedList = ordered !== null
      const items: (readonly MessageMarkdownInline[])[] = []
      const start = ordered?.[1] === undefined ? undefined : Number(ordered[1])
      while (index < lines.length) {
        const item = orderedList
          ? ORDERED_LIST_ITEM.exec(lines[index] ?? '')
          : UNORDERED_LIST_ITEM.exec(lines[index] ?? '')
        if (item === null) break
        items.push(parseMessageMarkdownInline(item[orderedList ? 2 : 1] ?? ''))
        index += 1
      }
      blocks.push({
        kind: 'list',
        ordered: orderedList,
        items,
        ...(orderedList && start !== undefined ? { start } : {}),
      })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (
        next.trim().length === 0 ||
        CODE_FENCE.test(next) ||
        HEADING.test(next) ||
        UNORDERED_LIST_ITEM.test(next) ||
        ORDERED_LIST_ITEM.test(next)
      ) {
        break
      }
      paragraph.push(next)
      index += 1
    }
    blocks.push({
      kind: 'paragraph',
      children: parseMessageMarkdownInline(paragraph.join('\n')),
    })
  }

  return blocks
}

export function parseMessageMarkdownInline(
  source: string,
): readonly MessageMarkdownInline[] {
  const tokens: MessageMarkdownInline[] = []
  let cursor = 0
  let textStart = 0

  const pushText = (end: number): void => {
    if (end <= textStart) return
    tokens.push({ kind: 'text', value: source.slice(textStart, end) })
  }

  while (cursor < source.length) {
    if (source[cursor] === '`') {
      const end = source.indexOf('`', cursor + 1)
      if (end > cursor + 1) {
        pushText(cursor)
        tokens.push({ kind: 'code', value: source.slice(cursor + 1, end) })
        cursor = end + 1
        textStart = cursor
        continue
      }
    }

    const strongMarker =
      source.startsWith('**', cursor) || source.startsWith('__', cursor)
        ? source.slice(cursor, cursor + 2)
        : undefined
    if (strongMarker !== undefined) {
      const end = source.indexOf(strongMarker, cursor + 2)
      if (end > cursor + 2) {
        pushText(cursor)
        tokens.push({
          kind: 'strong',
          children: parseMessageMarkdownInline(source.slice(cursor + 2, end)),
        })
        cursor = end + 2
        textStart = cursor
        continue
      }
    }

    if (source[cursor] === '[' && source[cursor - 1] !== '!') {
      const labelEnd = source.indexOf('](', cursor + 1)
      const hrefEnd =
        labelEnd < 0 ? -1 : findMarkdownLinkDestinationEnd(source, labelEnd + 2)
      if (labelEnd > cursor + 1 && hrefEnd > labelEnd + 2) {
        const href = safeMessageLink(source.slice(labelEnd + 2, hrefEnd))
        if (href !== undefined) {
          pushText(cursor)
          tokens.push({
            kind: 'link',
            href,
            children: parseMessageMarkdownInline(
              source.slice(cursor + 1, labelEnd),
            ),
          })
          cursor = hrefEnd + 1
          textStart = cursor
          continue
        }
      }
    }

    cursor += 1
  }

  pushText(source.length)
  return mergeAdjacentText(tokens)
}

function findMarkdownLinkDestinationEnd(source: string, start: number): number {
  let nestedParentheses = 0

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') {
      nestedParentheses += 1
      continue
    }
    if (character !== ')') continue
    if (nestedParentheses === 0) return index
    nestedParentheses -= 1
  }

  return -1
}

export function safeMessageLink(value: string): string | undefined {
  const candidate = value.trim()
  if (
    candidate.length === 0 ||
    [...candidate].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })
  ) {
    return undefined
  }
  try {
    const url = new URL(candidate)
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function mergeAdjacentText(
  tokens: readonly MessageMarkdownInline[],
): readonly MessageMarkdownInline[] {
  const merged: MessageMarkdownInline[] = []
  for (const token of tokens) {
    const previous = merged.at(-1)
    if (token.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = {
        kind: 'text',
        value: `${previous.value}${token.value}`,
      }
    } else {
      merged.push(token)
    }
  }
  return merged
}
