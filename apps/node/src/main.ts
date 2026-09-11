import { arch, platform } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { isSea } from 'node:sea'
import { pathToFileURL } from 'node:url'

import { formatPairingCode } from '@codetether/machine-transport'

import { CodeTetherNodeService } from './node-service.js'
import { NodeRelayManager } from './node-relay-manager.js'
import {
  isProviderGuardianInvocation,
  runProviderProcessGuardian,
} from './provider-process-guardian.js'
import { NodeStateStore } from './state-store.js'
import { readNodeRelayConfiguration } from './relay-state.js'
import { runServiceCommand } from './service-installation.js'
import { resolveNodeDataDirectory } from './data-directory.js'
import {
  LocalControllerRecoveryError,
  parseLocalControllerCommand,
  runLocalControllerCommand,
  writeLocalControllerCommandResult,
} from './local-controller-recovery.js'

declare const __CODETETHER_NODE_VERSION__: string | undefined
declare const __CODETETHER_PRODUCT_VERSION__: string | undefined

export interface NodeCliOptions {
  readonly bindAddress: string
  readonly port: number
  readonly dataDirectory: string
  readonly displayName: string
  readonly pairing: boolean
  readonly json: boolean
}

export function parseNodeCli(arguments_: readonly string[]): NodeCliOptions {
  let bindAddress = '127.0.0.1'
  let port = 4318
  let dataDirectory: string | undefined
  let displayName = 'CodeTether Node'
  let pairing = false
  let json = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--pair') pairing = true
    else if (argument === '--json') json = true
    else if (argument === '--bind')
      bindAddress = requiredValue(arguments_, ++index, argument)
    else if (argument === '--port') {
      const value = Number(requiredValue(arguments_, ++index, argument))
      if (!Number.isInteger(value) || value < 0 || value > 65_535) {
        throw new Error('--port must be an integer from 0 through 65535')
      }
      port = value
    } else if (argument === '--data-dir') {
      dataDirectory = requiredValue(arguments_, ++index, argument)
    } else if (argument === '--name') {
      displayName = requiredValue(arguments_, ++index, argument)
    } else if (argument === '--help') {
      process.stdout.write(helpText())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  dataDirectory ??= resolveNodeDataDirectory()
  if (!isAbsolute(dataDirectory)) {
    throw new Error('--data-dir must be an absolute path')
  }
  if (bindAddress.trim().length === 0 || bindAddress.length > 253) {
    throw new Error('--bind must be a bounded IP address or host name')
  }
  if (displayName.trim().length === 0 || displayName.length > 240) {
    throw new Error('--name must contain 1 through 240 characters')
  }
  return {
    bindAddress,
    port,
    dataDirectory,
    displayName: displayName.trim(),
    pairing,
    json,
  }
}

export async function runNode(
  options: NodeCliOptions,
): Promise<CodeTetherNodeService> {
  const state = await NodeStateStore.open({
    dataDirectory: options.dataDirectory,
    displayName: options.displayName,
    platform: presentationPlatform(platform()),
    architecture: arch(),
  })
  let service: CodeTetherNodeService | undefined
  let relayManager: NodeRelayManager | undefined
  let relayConfigurationInvalid = false
  try {
    const buildIdentity =
      typeof __CODETETHER_NODE_VERSION__ === 'string'
        ? __CODETETHER_NODE_VERSION__
        : 'development'
    try {
      const relayConfiguration = await readNodeRelayConfiguration(
        options.dataDirectory,
      )
      if (relayConfiguration?.enabled === true) {
        relayManager = new NodeRelayManager({
          state,
          configuration: relayConfiguration,
          clientBuildIdentity: buildIdentity,
          onStatus: (observation) =>
            writeStatus(options.json, {
              event: 'relay.status',
              ...observation,
            }),
        })
      }
    } catch {
      // Relay is additive. A malformed Relay configuration fails that control
      // connection closed without disabling the direct Node listener.
      relayConfigurationInvalid = true
    }
    service = new CodeTetherNodeService({
      state,
      bindAddress: options.bindAddress,
      port: options.port,
      ...(relayManager === undefined ? {} : { relayControl: relayManager }),
    })
    const runningService = service
    relayManager?.setMachineChannelHandler(
      async (channel) =>
        await runningService.acceptRelayMachineChannel(channel),
    )
    const address = await service.listen()
    writeStatus(options.json, {
      event: 'node.ready',
      buildIdentity,
      machineId: state.machine.machineId,
      nodeId: state.machine.nodeId,
      displayName: state.machine.displayName,
      platform: state.machine.platform,
      architecture: state.machine.architecture,
      bindAddress: address.address,
      port: address.port,
      trustedControllerCount: state.trustedControllerCount,
    })
    if (relayConfigurationInvalid) {
      writeStatus(options.json, {
        event: 'relay.status',
        status: 'configuration_invalid',
        observedAt: new Date().toISOString(),
      })
    }
    if (options.pairing) {
      const pairing = await service.enablePairing()
      writeStatus(options.json, {
        event: 'pairing.enabled',
        code: formatPairingCode(pairing.code),
        expiresAt: pairing.expiresAt.toISOString(),
      })
    }
    service.on('paired', () => {
      relayManager?.synchronizeMachineTrust()
      writeStatus(options.json, {
        event: 'pairing.completed',
        machineId: state.machine.machineId,
      })
    })
    service.on('pairingVerification', (value: unknown) => {
      const event = value as { readonly verificationCode: string }
      writeStatus(options.json, {
        event: 'pairing.verification',
        verificationCode: formatPairingCode(event.verificationCode),
      })
    })
    service.on('unpaired', () => {
      relayManager?.synchronizeMachineTrust()
      writeStatus(options.json, {
        event: 'trust.revoked',
        machineId: state.machine.machineId,
      })
    })
    relayManager?.start()
    return service
  } catch (error) {
    try {
      if (service === undefined) await state.close()
      else await service.close()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'CodeTether Node startup and cleanup both failed',
        { cause: cleanupError },
      )
    }
    throw error
  }
}

function requiredValue(
  arguments_: readonly string[],
  index: number,
  argument: string,
): string {
  const value = arguments_[index]
  if (value === undefined) throw new Error(`${argument} requires a value`)
  return value
}

function presentationPlatform(value: NodeJS.Platform): string {
  if (value === 'win32') return 'Windows'
  if (value === 'darwin') return 'macOS'
  if (value === 'linux') return 'Linux'
  return value
}

function writeStatus(json: boolean, value: Record<string, unknown>): void {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`)
  else if (value.event === 'pairing.enabled') {
    process.stdout.write(
      `Pairing code: ${String(value.code)}\nExpires: ${String(value.expiresAt)}\n`,
    )
  } else if (value.event === 'node.ready') {
    process.stdout.write(
      `CodeTether Node ready on ${String(value.bindAddress)}:${String(value.port)}\n` +
        `Machine: ${String(value.displayName)} (${String(value.machineId)})\n`,
    )
  } else if (value.event === 'pairing.completed') {
    process.stdout.write(
      'Pairing completed; the one-time code is no longer valid.\n',
    )
  } else if (value.event === 'trust.revoked') {
    process.stdout.write('Controller trust was revoked.\n')
  } else if (value.event === 'pairing.verification') {
    process.stdout.write(
      `Verify this code is also shown by CodeTether: ${String(value.verificationCode)}\n`,
    )
  } else if (value.event === 'relay.status') {
    process.stdout.write(`Internet Relay: ${String(value.status)}\n`)
  }
}

function helpText(): string {
  return [
    'CodeTether Node',
    '',
    'Usage: codetether-node [options]',
    '       codetether-node controller list|recover [options]',
    '',
    '  --bind <address>   Listen address (default 127.0.0.1)',
    '  --port <port>      Listen port; 0 chooses an ephemeral port (default 4318)',
    '  --data-dir <path>  Absolute private Node state directory',
    '  --name <name>      Presentation-safe Machine name',
    '  --pair             Enable one short-lived pairing session at startup',
    '  --json             Emit bounded machine-readable lifecycle lines',
    '  --help             Show this help',
    '',
    'Local Controller recovery requires the Node service to be stopped and explicit interactive confirmation.',
    '',
    'The Node exposes identity, pairing, liveness, bounded Provider discovery, trust revocation, and optional outbound Relay transport for the same authenticated Machine protocol.',
    '',
  ].join('\n')
}

export function isNodeCliEntry(
  sea = isSea(),
  moduleUrl = import.meta.url,
  argument = process.argv[1],
): boolean {
  return (
    sea ||
    (argument !== undefined &&
      moduleUrl === pathToFileURL(resolve(argument)).href)
  )
}

if (isNodeCliEntry()) {
  const arguments_ = process.argv.slice(2)
  if (arguments_.length === 1 && arguments_[0] === '--version') {
    process.stdout.write(
      `${JSON.stringify({
        product: 'CodeTether',
        component: 'node',
        version:
          typeof __CODETETHER_PRODUCT_VERSION__ === 'string'
            ? __CODETETHER_PRODUCT_VERSION__
            : 'development',
        build:
          typeof __CODETETHER_NODE_VERSION__ === 'string'
            ? __CODETETHER_NODE_VERSION__
            : 'development',
        platform: platform(),
        architecture: arch(),
      })}\n`,
    )
  } else if (arguments_[0] === 'service') {
    await runServiceCommand(arguments_.slice(1)).catch(() => {
      process.stderr.write(
        'CodeTether user-service operation failed. Check the installation instructions and user service status.\n',
      )
      process.exitCode = 1
    })
  } else if (arguments_[0] === 'controller') {
    try {
      const options = parseLocalControllerCommand(arguments_.slice(1))
      const result = await runLocalControllerCommand(options)
      writeLocalControllerCommandResult(options.json, result)
    } catch (error) {
      const code =
        error instanceof LocalControllerRecoveryError
          ? error.code
          : 'controller_command_failed'
      process.stderr.write(
        `CodeTether Controller operation failed (${code}).\n`,
      )
      process.exitCode = 1
    }
  } else if (isProviderGuardianInvocation(arguments_)) {
    try {
      await runProviderProcessGuardian()
    } catch {
      // Internal failures are deliberately presentation-safe. Provider stderr,
      // executable details, environment, and credentials are never emitted.
      process.stderr.write('Provider guardian cleanup did not complete\n')
      process.exitCode = 1
    }
  } else {
    let service: CodeTetherNodeService | undefined
    let stopping = false
    let stopRequested = false
    const stop = () => {
      stopRequested = true
      if (service === undefined || stopping) return
      stopping = true
      void service.close().then(
        () => process.exit(0),
        () => {
          process.stderr.write('CodeTether Node cleanup did not complete\n')
          process.exit(1)
        },
      )
    }
    // A service manager may stop us as soon as node.ready is published. Own
    // termination before startup; defer only cleanup until its service exists.
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      const options = parseNodeCli(arguments_)
      service = await runNode(options)
      if (stopRequested) stop()
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'CodeTether Node failed to start'}\n`,
      )
      await service?.close().catch(() => undefined)
      process.exitCode = 1
    }
  }
}
