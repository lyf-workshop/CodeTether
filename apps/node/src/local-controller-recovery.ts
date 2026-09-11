import { lstat } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline/promises'

import {
  ControllerIdSchema,
  type ControllerId,
} from '@codetether/machine-transport'

import { resolveNodeDataDirectory } from './data-directory.js'
import { NodeStateStore, type TrustedController } from './state-store.js'

export type LocalControllerRecoveryErrorCode =
  | 'active_node_operations'
  | 'confirmation_rejected'
  | 'existing_state_required'
  | 'local_owner_required'
  | 'multiple_controllers_require_target'
  | 'no_trusted_controller'
  | 'state_write_failed'
  | 'target_controller_not_found'

export class LocalControllerRecoveryError extends Error {
  constructor(
    readonly code: LocalControllerRecoveryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LocalControllerRecoveryError'
  }
}

export interface LocalControllerRecoveryTarget {
  readonly machineId: string
  readonly controllerId: ControllerId
  readonly publicKeyFingerprint: string
  readonly pairedAt: string
  readonly confirmation: string
}

export interface LocalControllerRecoveryResult {
  readonly status: 'already_revoked' | 'revoked'
  readonly target: LocalControllerRecoveryTarget
}

export interface LocalControllerCommandOptions {
  readonly action: 'list' | 'recover'
  readonly dataDirectory: string
  readonly controllerId?: ControllerId
  readonly json: boolean
}

export function parseLocalControllerCommand(
  arguments_: readonly string[],
): LocalControllerCommandOptions {
  const action = arguments_[0]
  if (action !== 'list' && action !== 'recover') {
    throw new Error(
      'Usage: codetether-node controller list|recover [--controller <id>] [--data-dir <path>] [--json]',
    )
  }
  let dataDirectory = resolveNodeDataDirectory()
  let controllerId: ControllerId | undefined
  let json = false
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--json') json = true
    else if (argument === '--data-dir') {
      const value = arguments_[++index]
      if (value === undefined) throw new Error('--data-dir requires a value')
      dataDirectory = value
    } else if (argument === '--controller') {
      const value = arguments_[++index]
      if (value === undefined) throw new Error('--controller requires a value')
      controllerId = ControllerIdSchema.parse(value)
    } else throw new Error(`Unknown controller argument: ${argument}`)
  }
  if (!isAbsolute(dataDirectory)) {
    throw new Error('--data-dir must be an absolute path')
  }
  if (action === 'recover' && controllerId === undefined) {
    throw new LocalControllerRecoveryError(
      'multiple_controllers_require_target',
      'Controller recovery requires an explicit --controller target',
    )
  }
  return {
    action,
    dataDirectory,
    ...(controllerId === undefined ? {} : { controllerId }),
    json,
  }
}

export async function runLocalControllerCommand(
  options: LocalControllerCommandOptions,
  dependencies: {
    readonly confirm?: (
      target: LocalControllerRecoveryTarget,
    ) => Promise<string>
    readonly now?: () => Date
    readonly writeTrustState?: (path: string, value: unknown) => Promise<void>
  } = {},
): Promise<
  LocalControllerRecoveryResult | readonly LocalControllerRecoveryTarget[]
> {
  if (!isAbsolute(options.dataDirectory)) {
    throw new LocalControllerRecoveryError(
      'existing_state_required',
      'Controller recovery requires an absolute Node state path',
    )
  }
  await assertLocalOwner(options.dataDirectory)
  let state: NodeStateStore
  try {
    state = await NodeStateStore.open({
      dataDirectory: options.dataDirectory,
      displayName: 'CodeTether Node',
      platform: presentationPlatform(platform()),
      architecture: arch(),
      requireExisting: true,
      ...(dependencies.writeTrustState === undefined
        ? {}
        : { writeTrustState: dependencies.writeTrustState }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/already in use|remained busy/u.test(message)) {
      throw new LocalControllerRecoveryError(
        'active_node_operations',
        'Stop the CodeTether Node service and wait for active work to finish before recovery',
        { cause: error },
      )
    }
    if (/Existing Node state is required/u.test(message)) {
      throw new LocalControllerRecoveryError(
        'existing_state_required',
        'Controller recovery requires existing Node state',
        { cause: error },
      )
    }
    throw error
  }
  try {
    const controllers = state.trustedControllers()
    const targets = controllers.map((controller) =>
      recoveryTarget(state.machine.machineId, controller),
    )
    if (options.action === 'list') return targets
    const controllerId = options.controllerId!
    const target = targets.find((entry) => entry.controllerId === controllerId)
    if (target === undefined) {
      const prior = state.controllerRecoveryAudit(controllerId)
      if (prior !== undefined) {
        return {
          status: 'already_revoked',
          target: recoveryTarget(prior.machineId, {
            controllerId: prior.controllerId,
            publicKeyFingerprint: prior.publicKeyFingerprint,
            pairedAt: prior.pairedAt,
          }),
        }
      }
      throw new LocalControllerRecoveryError(
        controllers.length === 0
          ? 'no_trusted_controller'
          : 'target_controller_not_found',
        controllers.length === 0
          ? 'No trusted Controller exists'
          : 'The selected Controller was not found',
      )
    }
    const answer = await (dependencies.confirm ?? interactiveConfirmation)(
      target,
    )
    if (answer !== target.confirmation) {
      throw new LocalControllerRecoveryError(
        'confirmation_rejected',
        'Controller recovery confirmation was rejected',
      )
    }
    let audit
    try {
      audit = await state.recoverControllerLocally(
        controllerId,
        (dependencies.now ?? (() => new Date()))().toISOString(),
      )
    } catch (error) {
      throw new LocalControllerRecoveryError(
        'state_write_failed',
        'Controller recovery state write failed',
        { cause: error },
      )
    }
    if (audit === undefined) {
      throw new LocalControllerRecoveryError(
        'target_controller_not_found',
        'The selected Controller was not found',
      )
    }
    return { status: 'revoked', target }
  } finally {
    await state.close()
  }
}

export function writeLocalControllerCommandResult(
  json: boolean,
  result:
    LocalControllerRecoveryResult | readonly LocalControllerRecoveryTarget[],
): void {
  if (isTargetList(result)) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ event: 'controller.list', controllers: result.map(withoutConfirmation) })}\n`,
      )
      return
    }
    if (result.length === 0) process.stdout.write('No trusted Controller.\n')
    for (const target of result) {
      process.stdout.write(
        `Controller: ${target.controllerId}\nFingerprint: ${target.publicKeyFingerprint}\nPaired: ${target.pairedAt}\nMachine: ${target.machineId}\n`,
      )
    }
    return
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ event: 'controller.recovery', status: result.status, controller: withoutConfirmation(result.target) })}\n`,
    )
    return
  }
  process.stdout.write(
    result.status === 'revoked'
      ? 'Controller trust revoked locally. Start the existing one-time pairing flow to authorize a new Controller.\n'
      : 'Controller trust was already revoked locally.\n',
  )
}

function isTargetList(
  result:
    LocalControllerRecoveryResult | readonly LocalControllerRecoveryTarget[],
): result is readonly LocalControllerRecoveryTarget[] {
  return Array.isArray(result)
}

async function interactiveConfirmation(
  target: LocalControllerRecoveryTarget,
): Promise<string> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new LocalControllerRecoveryError(
      'confirmation_rejected',
      'Controller recovery requires an interactive local terminal',
    )
  }
  process.stdout.write(
    `Machine: ${target.machineId}\nController: ${target.controllerId}\nFingerprint: ${target.publicKeyFingerprint}\nPaired: ${target.pairedAt}\n`,
  )
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await input.question(
      `Type "${target.confirmation}" to revoke this Controller: `,
    )
  } finally {
    input.close()
  }
}

async function assertLocalOwner(dataDirectory: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(dataDirectory)
  } catch (error) {
    throw new LocalControllerRecoveryError(
      'existing_state_required',
      'Controller recovery requires existing Node state',
      { cause: error },
    )
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new LocalControllerRecoveryError(
      'existing_state_required',
      'Controller recovery requires a regular Node state directory',
    )
  }
  const effectiveUserId = process.geteuid?.()
  if (effectiveUserId !== undefined && metadata.uid !== effectiveUserId) {
    throw new LocalControllerRecoveryError(
      'local_owner_required',
      'Controller recovery must run as the OS user that owns the Node state',
    )
  }
}

function recoveryTarget(
  machineId: string,
  controller: TrustedController,
): LocalControllerRecoveryTarget {
  return {
    machineId,
    controllerId: controller.controllerId,
    publicKeyFingerprint: controller.publicKeyFingerprint,
    pairedAt: controller.pairedAt,
    confirmation: `RECOVER ${machineId} ${controller.publicKeyFingerprint.slice(-8)}`,
  }
}

function withoutConfirmation(target: LocalControllerRecoveryTarget) {
  return {
    machineId: target.machineId,
    controllerId: target.controllerId,
    publicKeyFingerprint: target.publicKeyFingerprint,
    pairedAt: target.pairedAt,
  }
}

function presentationPlatform(value: NodeJS.Platform): string {
  if (value === 'win32') return 'Windows'
  if (value === 'darwin') return 'macOS'
  if (value === 'linux') return 'Linux'
  return value
}
