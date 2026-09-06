import type { AgentProvider } from '@codetether/agent-core'
import { MachineIdSchema, type MachineId } from '@codetether/protocol'

const REMOTE_CODEX_SESSION_PREFIX = 'remote-codex-v1:'
const REMOTE_CLAUDE_SESSION_PREFIX = 'remote-claude-v1:'
const MAXIMUM_NATIVE_SESSION_ID_CODE_UNITS = 2_048

export class RemoteProviderSessionBindingError extends Error {
  constructor() {
    super('Remote Provider Session identity is malformed')
    this.name = 'RemoteProviderSessionBindingError'
  }
}

/**
 * Materializes the existing frozen private remote-runtime identity format.
 * The raw Node-native identity remains only in the short-lived discovery
 * candidate; SQLite receives this exact Machine- and Provider-bound value.
 */
export function encodeRemoteProviderSessionBinding(
  provider: AgentProvider,
  machineId: MachineId,
  nativeSessionId: string,
): string {
  const machine = MachineIdSchema.parse(machineId)
  const native = validateNativeSessionId(nativeSessionId)
  switch (provider) {
    case 'codex':
      return `${REMOTE_CODEX_SESSION_PREFIX}${encode({
        version: 1,
        machineId: machine,
        providerThreadId: native,
      })}`
    case 'claude-code':
      return `${REMOTE_CLAUDE_SESSION_PREFIX}${encode({
        version: 1,
        machineId: machine,
        providerSessionId: native,
      })}`
  }
}

export function decodeRemoteProviderSessionBinding(
  provider: AgentProvider,
  machineId: MachineId,
  binding: string,
): string {
  const machine = MachineIdSchema.parse(machineId)
  const prefix =
    provider === 'codex'
      ? REMOTE_CODEX_SESSION_PREFIX
      : REMOTE_CLAUDE_SESSION_PREFIX
  if (!binding.startsWith(prefix)) throw new RemoteProviderSessionBindingError()
  let parsed: unknown
  try {
    parsed = JSON.parse(
      Buffer.from(binding.slice(prefix.length), 'base64url').toString('utf8'),
    )
  } catch {
    throw new RemoteProviderSessionBindingError()
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('machineId' in parsed) ||
    parsed.machineId !== machine
  ) {
    throw new RemoteProviderSessionBindingError()
  }
  const native =
    provider === 'codex'
      ? 'providerThreadId' in parsed
        ? parsed.providerThreadId
        : undefined
      : 'providerSessionId' in parsed
        ? parsed.providerSessionId
        : undefined
  if (typeof native !== 'string') throw new RemoteProviderSessionBindingError()
  return validateNativeSessionId(native)
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function validateNativeSessionId(value: string): string {
  if (
    value.trim().length === 0 ||
    value.length > MAXIMUM_NATIVE_SESSION_ID_CODE_UNITS ||
    value.includes('\0')
  ) {
    throw new RemoteProviderSessionBindingError()
  }
  return value
}
