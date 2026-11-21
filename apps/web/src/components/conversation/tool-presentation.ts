import type { ToolKind } from '@codetether/protocol'

export type ToolPresentationKind =
  | 'git-status'
  | 'read-file'
  | 'edit-file'
  | 'search'
  | 'test'
  | 'command'
  | 'generic'

export interface ToolPresentation {
  readonly kind: ToolPresentationKind
  readonly title: string
  readonly subtitle?: string
  /** The exact normalized Host command. It is never evaluated by this module. */
  readonly rawCommand: string
}

export interface ToolPresentationInput {
  readonly command: string
  readonly kind?: ToolKind
  readonly status: 'idle' | 'running' | 'completed' | 'failed'
  readonly outputSummary?: string
}

export interface TimelineToolPresentation extends ToolPresentation {
  /** Full display-only command after removing a recognized PowerShell wrapper. */
  readonly displayCommand: string
  readonly subject?: string
  readonly failureSummary?: string
}

const MAX_SUBTITLE_CHARACTERS = 80

/**
 * Builds the small, provider-neutral label shown by the frozen Tool row.
 * Parsing is deliberately lexical: wrapper text is inspected but never run.
 */
export function createToolPresentation(
  input: ToolPresentationInput,
): ToolPresentation {
  const { rawCommand, classification } = inspectToolCommand(input)
  const failure =
    input.status === 'failed'
      ? summarizeToolFailure(
          input.outputSummary,
          input.kind === 'shell' || input.kind === undefined,
        )
      : undefined
  return presentTool(classification, rawCommand, failure)
}

/** Timeline labels keep the operation and failure detail separate. */
export function createTimelineToolPresentation(
  input: ToolPresentationInput,
): TimelineToolPresentation {
  const { rawCommand, displayCommand, classification } =
    inspectToolCommand(input)
  const failureSummary =
    input.status === 'failed'
      ? summarizeToolFailure(
          input.outputSummary,
          input.kind === 'shell' || input.kind === undefined,
          false,
        )
      : undefined
  let subject = classification.subtitle
  if (classification.kind === 'edit-file') {
    subject = canonicalToolSubject(displayCommand, 'Edit')
  }
  if (
    classification.kind === 'command' ||
    classification.kind === 'git-status' ||
    classification.kind === 'test'
  ) {
    subject = summarizeCommand(displayCommand)
  }

  return {
    ...presentTool(classification, rawCommand, failureSummary),
    displayCommand,
    ...(subject === undefined ? {} : { subject }),
    ...(failureSummary === undefined ? {} : { failureSummary }),
  }
}

function inspectToolCommand({
  command,
  kind,
}: Pick<ToolPresentationInput, 'command' | 'kind'>) {
  const rawCommand = command.trim() || '执行命令'
  const displayCommand = displayToolCommand(rawCommand)
  const tokens = tokenizeCommandPrefix(displayCommand, 6)
  const executable = normalizeExecutable(tokens[0]?.value)
  const classification =
    kind === undefined
      ? hasCompoundCommandSyntax(displayCommand)
        ? ({ kind: 'command', title: '执行命令' } as const)
        : classifyCommand(executable, tokens)
      : classifyCanonicalTool(kind, displayCommand)
  return { rawCommand, displayCommand, classification }
}

function presentTool(
  classification: CommandClassification,
  rawCommand: string,
  failure: string | undefined,
): ToolPresentation {
  const subtitle = failure ?? classification.subtitle
  return {
    kind: classification.kind,
    title: classification.title,
    ...(subtitle === undefined ? {} : { subtitle }),
    rawCommand,
  }
}

function classifyCanonicalTool(
  kind: ToolKind,
  command: string,
): CommandClassification {
  switch (kind) {
    case 'read': {
      const path = canonicalToolSubject(command, 'Read')
      return {
        kind: 'read-file',
        title: '读取文件',
        ...(path === undefined ? {} : { subtitle: path }),
      }
    }
    case 'edit':
      return { kind: 'edit-file', title: '编辑文件' }
    case 'search': {
      const clue =
        canonicalToolSubject(command, 'Glob') ??
        canonicalToolSubject(command, 'Grep')
      return {
        kind: 'search',
        title: '搜索',
        ...(clue === undefined ? {} : { subtitle: clue }),
      }
    }
    case 'shell':
      return { kind: 'command', title: '执行命令' }
    case 'generic':
      return { kind: 'generic', title: '使用工具' }
  }
}

/** Extracts only the bounded, presentation-safe clue emitted by a canonical adapter. */
function canonicalToolSubject(
  command: string,
  prefix: 'Glob' | 'Grep' | 'Read' | 'Edit',
): string | undefined {
  if (!command.startsWith(`${prefix} `)) return undefined
  const subject = command.slice(prefix.length + 1).trim()
  return subject.length === 0 ? undefined : compactSubtitle(subject)
}

/** Compact, wrapper-free command text suitable for a secondary UI label. */
export function createToolCommandSubtitle(command: string): string {
  const normalized = command.trim() || '执行命令'
  return compactSubtitle(displayToolCommand(normalized))
}

/** Display-only shell text; never used to execute or authorize a command. */
export function displayToolCommand(command: string): string {
  return unwrapPowerShellCommand(unwrapWholeQuotedValue(command.trim()))
}

interface CommandClassification {
  readonly kind: ToolPresentationKind
  readonly title: string
  readonly subtitle?: string
}

function classifyCommand(
  executable: string | undefined,
  tokens: readonly CommandToken[],
): CommandClassification {
  if (executable === 'git' && normalizedToken(tokens[1]) === 'status') {
    return { kind: 'git-status', title: 'Git 状态' }
  }

  if (executable === 'get-content' || executable === 'cat') {
    const path = readFileTarget(tokens.slice(1))
    return {
      kind: 'read-file',
      title: '读取文件',
      ...(path === undefined ? {} : { subtitle: compactSubtitle(path) }),
    }
  }

  if (isTestCommand(executable, tokens)) {
    return { kind: 'test', title: '运行测试' }
  }

  return { kind: 'command', title: '执行命令' }
}

function isTestCommand(
  executable: string | undefined,
  tokens: readonly CommandToken[],
): boolean {
  if (
    executable === 'vitest' ||
    executable === 'jest' ||
    executable === 'pytest' ||
    executable === 'invoke-pester'
  ) {
    return true
  }

  const second = normalizedToken(tokens[1])
  const third = normalizedToken(tokens[2])
  const isNamedTest = (value: string | undefined): boolean =>
    value === 'test' || value?.startsWith('test:') === true
  const isTestRunner = (value: string | undefined): boolean =>
    value === 'vitest' || value === 'jest' || value === 'pytest'
  if (
    executable === 'cargo' ||
    executable === 'go' ||
    executable === 'dotnet' ||
    executable === 'deno' ||
    executable === 'mvn' ||
    executable === 'gradle' ||
    executable === 'gradlew'
  ) {
    return isNamedTest(second)
  }
  if (
    executable === 'pnpm' ||
    executable === 'npm' ||
    executable === 'yarn' ||
    executable === 'bun'
  ) {
    return (
      isNamedTest(second) ||
      (second === 'run' && isNamedTest(third)) ||
      (second === 'exec' && isTestRunner(third)) ||
      isTestRunner(second)
    )
  }
  if (executable === 'npx' || executable === 'pnpx') {
    return isTestRunner(second)
  }
  if (executable === 'node')
    return tokens.some((token) => token.value === '--test')
  if (executable === 'python' || executable === 'python3') {
    return second === '-m' && third === 'pytest'
  }
  return false
}

function readFileTarget(tokens: readonly CommandToken[]): string | undefined {
  const pathFlags = new Set(['-path', '-literalpath'])
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    const normalized = token.value.toLocaleLowerCase('en-US')
    if (pathFlags.has(normalized)) {
      return tokens[index + 1]?.value
    }
    if (normalized === '--') return tokens[index + 1]?.value
    if (!normalized.startsWith('-')) return token.value
  }
  return undefined
}

function summarizeToolFailure(
  output: string | undefined,
  command: boolean,
  includeOutputExitText = true,
): string {
  const normalized = output?.replace(/\s+/gu, ' ').trim() ?? ''
  if (
    command &&
    normalized ===
      'Failed to create unified exec process: registered Core process has no package identity'
  ) {
    return 'Windows 沙箱无法启动命令'
  }
  if (normalized.length === 0) return '命令执行失败'
  if (
    /cannot find (?:the )?path|path (?:was )?not found|pathnotfound|no such file|\benoent\b/iu.test(
      normalized,
    )
  ) {
    return '找不到路径'
  }
  if (
    /command not found|commandnotfoundexception|is not recognized as (?:the name of |an )?(?:a )?cmdlet|not recognized as an internal or external command/iu.test(
      normalized,
    )
  ) {
    return '找不到命令'
  }
  if (
    /permission denied|access (?:is )?denied|unauthorizedaccessexception/iu.test(
      normalized,
    )
  ) {
    return '没有访问权限'
  }
  if (/timed out|timeout/iu.test(normalized)) return '操作超时'
  if (/tests? failed|failed tests?/iu.test(normalized)) return '测试未通过'

  if (!includeOutputExitText) return '命令执行失败'

  const exitCode =
    /(?:exit(?:ed)?(?: with)?(?: code)?|process exited with code)\s*[:=]?\s*(-?\d+)/iu.exec(
      normalized,
    )?.[1]
  if (exitCode !== undefined) return `命令已退出，退出码 ${exitCode}`

  return '命令执行失败'
}

function unwrapPowerShellCommand(command: string): string {
  const wrapperTokens = tokenizeCommandPrefix(command, 16)
  let executableIndex = 0
  if (wrapperTokens[0]?.value === '&') executableIndex = 1
  const executable = normalizeExecutable(wrapperTokens[executableIndex]?.value)
  if (executable !== 'powershell' && executable !== 'pwsh') return command

  for (
    let index = executableIndex + 1;
    index < wrapperTokens.length;
    index += 1
  ) {
    const token = wrapperTokens[index]
    if (token === undefined) continue
    const flag = token.value.toLocaleLowerCase('en-US')
    if (flag === '-encodedcommand' || flag === '-enc') return command
    if (flag !== '-command' && flag !== '-c') continue

    const wrapped = command.slice(token.end).trim()
    if (wrapped.length === 0) return command
    let unwrapped = unwrapWholeQuotedValue(wrapped)
    if (
      unwrapped === wrapped &&
      wrapped.startsWith('"') &&
      wrapped.endsWith('"')
    ) {
      // Codex's Windows launcher encodes an inner " as the triplet '"'.
      // Convert it only when the result is one valid outer quoted argument.
      const normalized = wrapped.replace(/'"'/gu, '""')
      if (normalized !== wrapped) {
        const decoded = unwrapWholeQuotedValue(normalized)
        if (decoded !== normalized) unwrapped = decoded
      }
    }
    return unwrapPowerShellScriptBlock(unwrapped)
  }
  return command
}

/** Lexically summarizes top-level commands without evaluating shell syntax. */
function summarizeCommand(command: string): string {
  let first = ''
  let count = 0
  let start = 0
  let quote: "'" | '"' | undefined
  const nested: string[] = []

  const record = (end: number): void => {
    const part = command.slice(start, end).trim()
    if (part.length === 0) return
    if (count === 0) first = part
    count += 1
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    const next = command[index + 1]
    if (
      quote !== "'" &&
      (character === '\x60' ||
        (character === '\\' &&
          next !== undefined &&
          /[\\ "';&|\n]/u.test(next)))
    ) {
      index += 1
      continue
    }
    if (quote !== undefined) {
      if (character === quote) {
        if (quote === "'" && next === "'") index += 1
        else quote = undefined
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '(' || character === '{') {
      nested.push(character === '(' ? ')' : '}')
      continue
    }
    if (nested.length > 0) {
      if (character === nested.at(-1)) nested.pop()
      continue
    }
    if (
      character === '&' &&
      next !== '&' &&
      command.slice(start, index).trim() === ''
    ) {
      continue
    }
    if (
      character === ';' ||
      character === '|' ||
      character === '&' ||
      character === '\n' ||
      character === '\r'
    ) {
      record(index)
      if ((character === '&' || character === '|') && next === character)
        index += 1
      start = index + 1
    }
  }
  record(command.length)
  return count < 2
    ? compactSubtitle(command)
    : `${compactSubtitle(first)} 等 ${count} 条`
}

/** Avoids giving a compound command a narrower, potentially misleading label. */
function hasCompoundCommandSyntax(command: string): boolean {
  let quote: "'" | '"' | undefined
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (quote !== undefined) {
      if (quote === '"' && character === '$' && command[index + 1] === '(') {
        return true
      }
      if (quote === '"' && character === '`') {
        index += 1
        continue
      }
      if (character === quote) {
        if (quote === "'" && command[index + 1] === "'") index += 1
        else quote = undefined
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (
      character === ';' ||
      character === '|' ||
      character === '&' ||
      character === '\n' ||
      character === '\r' ||
      (character === '$' && command[index + 1] === '(')
    ) {
      return true
    }
  }
  return false
}

function unwrapPowerShellScriptBlock(value: string): string {
  const trimmed = value.trim()
  const withoutCallOperator = trimmed.startsWith('&')
    ? trimmed.slice(1).trimStart()
    : trimmed
  if (
    !withoutCallOperator.startsWith('{') ||
    !withoutCallOperator.endsWith('}')
  ) {
    return trimmed
  }
  if (!hasOneBalancedOuterBlock(withoutCallOperator)) return trimmed
  return withoutCallOperator.slice(1, -1).trim()
}

function hasOneBalancedOuterBlock(value: string): boolean {
  let depth = 0
  let quote: "'" | '"' | undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote !== undefined) {
      if (quote === '"' && character === '`') {
        index += 1
        continue
      }
      if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1
        } else {
          quote = undefined
        }
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0 && index !== value.length - 1) return false
      if (depth < 0) return false
    }
  }
  return depth === 0 && quote === undefined
}

function unwrapWholeQuotedValue(value: string): string {
  if (value.length < 2) return value
  const quote = value[0]
  if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) return value

  let escaped = false
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]
    if (quote === '"' && character === '`') {
      escaped = !escaped
      continue
    }
    if (character === quote && !escaped) {
      if (quote === "'" && value[index + 1] === "'") {
        index += 1
        continue
      }
      if (quote === '"' && value[index + 1] === '"') {
        index += 1
        continue
      }
      return value
    }
    escaped = false
  }

  const inner = value.slice(1, -1)
  return quote === "'"
    ? inner.replace(/''/gu, "'")
    : inner.replace(/""/gu, '"').replace(/`([`"$])/gu, '$1')
}

interface CommandToken {
  readonly value: string
  readonly end: number
}

function tokenizeCommandPrefix(
  command: string,
  maxTokens: number,
): readonly CommandToken[] {
  const tokens: CommandToken[] = []
  let index = 0
  while (index < command.length && tokens.length < maxTokens) {
    while (/\s/u.test(command[index] ?? '')) index += 1
    if (index >= command.length) break

    const start = index
    let value = ''
    let quote: "'" | '"' | undefined
    while (index < command.length) {
      const character = command[index]
      if (quote === undefined && /\s/u.test(character ?? '')) break
      if (quote === undefined && (character === "'" || character === '"')) {
        quote = character
        index += 1
        continue
      }
      if (quote !== undefined && character === quote) {
        if (quote === "'" && command[index + 1] === "'") {
          value += "'"
          index += 2
          continue
        }
        quote = undefined
        index += 1
        continue
      }
      if (quote === '"' && character === '`' && index + 1 < command.length) {
        value += command[index + 1]
        index += 2
        continue
      }
      value += character
      index += 1
    }
    if (index === start) index += 1
    tokens.push({ value, end: index })
  }
  return tokens
}

function normalizeExecutable(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  const basename = value.replace(/\\/gu, '/').split('/').at(-1)
  return basename?.replace(/\.exe$/iu, '').toLocaleLowerCase('en-US')
}

function normalizedToken(token: CommandToken | undefined): string | undefined {
  return token?.value.toLocaleLowerCase('en-US')
}

function compactSubtitle(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= MAX_SUBTITLE_CHARACTERS
    ? normalized
    : `${normalized.slice(0, MAX_SUBTITLE_CHARACTERS - 1)}…`
}
