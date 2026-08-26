import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import { CodeTetherClient } from '@codetether/client'
import {
  ActionIdSchema,
  ConversationIdSchema,
  type CreateConversationRequest,
} from '@codetether/protocol'

const DEFAULT_BASE_URL = 'http://127.0.0.1:4317'

type ObserveCommand =
  | {
      readonly kind: 'create'
      readonly baseUrl: string
      readonly cwd: string
      readonly model?: string
      readonly reasoning?: string
    }
  | {
      readonly kind: 'turn'
      readonly baseUrl: string
      readonly conversationId: ReturnType<typeof ConversationIdSchema.parse>
      readonly input: string
    }

async function main(): Promise<void> {
  const command = parseArguments(process.argv.slice(2))
  const client = new CodeTetherClient({ baseUrl: command.baseUrl })

  if (command.kind === 'create') {
    const request: CreateConversationRequest = {
      actionId: actionId(),
      provider: 'codex',
      cwd: command.cwd,
      ...(command.model === undefined ? {} : { model: command.model }),
      ...(command.reasoning === undefined
        ? {}
        : { reasoning: command.reasoning }),
    }
    const response = await client.createConversation(request)
    process.stdout.write(
      `${JSON.stringify({
        kind: 'conversation.created',
        conversationId: response.data.conversation.conversationId,
        route: `/conversations/${response.data.conversation.conversationId}`,
        conversation: response.data.conversation,
      })}\n`,
    )
    return
  }

  const response = await client.startTurn(command.conversationId, {
    actionId: actionId(),
    input: { type: 'text', text: command.input },
  })
  process.stdout.write(
    `${JSON.stringify({
      kind: 'turn.accepted',
      conversationId: response.data.turn.conversationId,
      turnId: response.data.turn.turnId,
      turn: response.data.turn,
    })}\n`,
  )
}

function parseArguments(arguments_: readonly string[]): ObserveCommand {
  const kind = arguments_[0]
  if (kind !== 'create' && kind !== 'turn') {
    throw new Error('Usage: host:observe <create|turn> [options]')
  }

  const options = readOptions(arguments_.slice(1))
  const baseUrl = options.get('base-url') ?? DEFAULT_BASE_URL
  if (kind === 'create') {
    const cwd = requiredOption(options, 'cwd')
    if (!isAbsolute(cwd)) throw new Error('--cwd must be an absolute path')
    return {
      kind,
      baseUrl,
      cwd,
      ...(options.get('model') === undefined
        ? {}
        : { model: options.get('model') }),
      ...(options.get('reasoning') === undefined
        ? {}
        : { reasoning: options.get('reasoning') }),
    }
  }

  return {
    kind,
    baseUrl,
    conversationId: ConversationIdSchema.parse(
      requiredOption(options, 'conversation'),
    ),
    input: requiredOption(options, 'input'),
  }
}

function readOptions(
  arguments_: readonly string[],
): ReadonlyMap<string, string> {
  const options = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error(`Invalid observe argument near ${flag ?? '<end>'}`)
    }
    const name = flag.slice(2)
    if (options.has(name)) throw new Error(`Duplicate --${name}`)
    options.set(name, value)
  }
  return options
}

function requiredOption(
  options: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = options.get(name)
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} is required`)
  }
  return value
}

function actionId(): ReturnType<typeof ActionIdSchema.parse> {
  return ActionIdSchema.parse(`act_${randomUUID().replaceAll('-', '')}`)
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codetether:observe] ${message}\n`)
  process.exitCode = 1
})
