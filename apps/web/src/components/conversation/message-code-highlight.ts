import type { CodeBlockToken } from '@codetether/ui/components/product/code-block'

const languages = {
  javascript: {
    label: 'JavaScript',
    load: () => import('refractor/javascript'),
  },
  typescript: {
    label: 'TypeScript',
    load: () => import('refractor/typescript'),
  },
  python: { label: 'Python', load: () => import('refractor/python') },
  rust: { label: 'Rust', load: () => import('refractor/rust') },
  go: { label: 'Go', load: () => import('refractor/go') },
  markup: { label: 'HTML', load: () => import('refractor/markup') },
  css: { label: 'CSS', load: () => import('refractor/css') },
  json: { label: 'JSON', load: () => import('refractor/json') },
  bash: { label: 'Shell', load: () => import('refractor/bash') },
  sql: { label: 'SQL', load: () => import('refractor/sql') },
} as const

type MessageCodeLanguage = keyof typeof languages

const aliases = new Map<string, MessageCodeLanguage>([
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['cjs', 'javascript'],
  ['mjs', 'javascript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'typescript'],
  ['py', 'python'],
  ['rs', 'rust'],
  ['html', 'markup'],
  ['htm', 'markup'],
  ['shell', 'bash'],
  ['sh', 'bash'],
  ['zsh', 'bash'],
])

function matchLanguage(value: string): MessageCodeLanguage | undefined {
  if (Object.hasOwn(languages, value)) return value as MessageCodeLanguage
  return aliases.get(value)
}

export function messageCodeLanguage(
  fence: string | undefined,
): MessageCodeLanguage | undefined {
  const value = fence?.toLowerCase().trim() ?? ''
  const lastDot = value.lastIndexOf('.')
  return (
    matchLanguage(value) ??
    (lastDot >= 0 ? matchLanguage(value.slice(lastDot + 1)) : undefined)
  )
}

export function messageCodeLanguageLabel(
  language: MessageCodeLanguage | undefined,
): string | undefined {
  return language === undefined ? undefined : languages[language].label
}

type HighlightNode = ReturnType<
  typeof import('refractor/core').refractor.highlight
>['children'][number]
type TokenTone = NonNullable<CodeBlockToken['tone']>

const tokenTones = new Map<string, TokenTone>([
  ['comment', 'muted'],
  ['prolog', 'muted'],
  ['doctype', 'muted'],
  ['keyword', 'keyword'],
  ['atrule', 'keyword'],
  ['operator', 'keyword'],
  ['tag', 'keyword'],
  ['selector', 'keyword'],
  ['string', 'string'],
  ['attr-value', 'string'],
  ['char', 'string'],
  ['regex', 'string'],
  ['function', 'name'],
  ['class-name', 'name'],
  ['property', 'name'],
  ['attr-name', 'name'],
  ['builtin', 'name'],
  ['variable', 'name'],
  ['number', 'value'],
  ['boolean', 'value'],
  ['constant', 'value'],
])

export async function highlightMessageCode(
  source: string,
  language: MessageCodeLanguage,
): Promise<readonly (readonly CodeBlockToken[])[]> {
  const [{ refractor }, { default: syntax }] = await Promise.all([
    import('refractor/core'),
    languages[language].load(),
  ])
  refractor.register(syntax)
  const result = refractor.highlight(source, language)

  let line: CodeBlockToken[] = []
  const lines = [line]
  function visit(node: HighlightNode, tone?: TokenTone) {
    if (node.type === 'text') {
      const parts = node.value.split('\n')
      for (const [index, text] of parts.entries()) {
        if (index > 0) {
          line = []
          lines.push(line)
        }
        if (text.length > 0)
          line.push(tone === undefined ? { text } : { text, tone })
      }
      return
    }
    if (node.type === 'element') {
      // Only text and fixed semantic colors survive the tokenizer boundary.
      const classes = node.properties.className
      if (Array.isArray(classes)) {
        for (const name of classes) {
          if (typeof name !== 'string') continue
          const nextTone = tokenTones.get(name)
          if (nextTone !== undefined) {
            tone = nextTone
            break
          }
        }
      }
      for (const child of node.children) visit(child, tone)
    }
  }
  for (const node of result.children) visit(node)
  return lines
}
