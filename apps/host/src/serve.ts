import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'
import { createHostProcessLifecycle } from './host-process-lifecycle.js'
import { HostPresenceSigningBridge } from './host-presence-signing.js'
import type { SupervisorHostPresencePayload } from '@codetether/supervisor-transport'
import { HostStartupTimeline } from './api/startup-timeline.js'
import {
  isDesktopManaged,
  parseServeArguments,
  resolveHostVersion,
  resolveProductVersion,
  resolveRemoteMachineTransportPolicy,
} from './serve-config.js'
import { UnsupportedSqliteSchemaMigrationError } from './persistence/migrations.js'
import { resolveCodeTetherDatabasePath } from './persistence/data-directory.js'
import { HostRuntimeDiagnostics } from './api/host-runtime-diagnostics.js'

export const UNSUPPORTED_SCHEMA_EXIT_CODE = 42
export const UNSUPPORTED_SCHEMA_STDERR =
  '[codetether:host] UNSUPPORTED_SQLITE_SCHEMA_MIGRATION\n'
export const STARTUP_FAILURE_STDERR = '[codetether:host] STARTUP_FAILURE\n'

let diagnostics: HostRuntimeDiagnostics | undefined

async function main(): Promise<void> {
  const startupTimeline = new HostStartupTimeline((phase, elapsedMs) => {
    process.stderr.write(
      `${JSON.stringify({ component: 'host', event: 'startup.phase', phase, elapsedMs })}\n`,
    )
  })
  startupTimeline.mark('PROCESS_START')
  if (process.argv.length === 3 && process.argv[2] === '--version') {
    process.stdout.write(
      `${JSON.stringify({
        product: 'CodeTether',
        component: 'host',
        version: await resolveProductVersion(),
        build: await resolveHostVersion(),
        platform: process.platform,
        architecture: process.arch,
      })}\n`,
    )
    return
  }
  const desktopManaged = isDesktopManaged()
  let host: RunningLocalCodexHost | undefined
  let cleanShutdownRequested = false
  const signer = new HostPresenceSigningBridge((line) =>
    process.stdout.write(line),
  )
  const lifecycle = createHostProcessLifecycle({
    desktopManaged,
    onNetworkRestored: () => {
      host?.service.requestNetworkRecovery('desktop_resume')
      host?.requestTransportRecovery?.()
    },
    onPresenceSignature: (line) => signer.receive(line),
  })
  try {
    if (!(await lifecycle.activated) || lifecycle.isRequested) return
    // Establish a safe sink before argument and version parsing so their
    // failures leave a structured record whenever the data root is valid.
    let databasePath: string | undefined
    try {
      databasePath = resolveCodeTetherDatabasePath()
      diagnostics = new HostRuntimeDiagnostics({
        databasePath,
        productVersion: 'unknown',
        hostVersion: 'unknown',
      })
    } catch {
      // An invalid data root has no safe location for a local log.
    }
    const arguments_ = parseServeArguments(process.argv.slice(2), {
      desktopManaged,
    })
    const hostVersion = await resolveHostVersion()
    const productVersion = await resolveProductVersion()
    diagnostics = new HostRuntimeDiagnostics({
      databasePath,
      productVersion,
      hostVersion,
    })
    process.on('uncaughtExceptionMonitor', (error) => {
      diagnostics?.recordHostUnhandled({ kind: 'uncaught_exception', error })
    })
    process.on('unhandledRejection', (error: unknown) => {
      diagnostics?.recordHostUnhandled({ kind: 'unhandled_rejection', error })
      process.exit(1)
    })
    diagnostics.recordHostStart({ port: arguments_.port })
    host = await startLocalCodexHost({
      allowedWorkspaceRoots: arguments_.workspaces,
      allowedOrigins: arguments_.origins,
      hostVersion,
      productVersion,
      diagnostics,
      startupTimeline,
      port: arguments_.port,
      desktopManaged,
      // Isolated development Hosts use their own Product API port and a
      // dynamic Supervisor listener without production Relay registration.
      // The installed Desktop still uses 4317/4318.
      ...(arguments_.port !== 4317
        ? { supervisorPort: 0, supervisorRelay: null }
        : {}),
      ...(desktopManaged
        ? {
            signHostPresence: (
              keyHandle: string,
              payload: SupervisorHostPresencePayload,
              signal: AbortSignal,
            ) => signer.sign(keyHandle, payload, signal),
          }
        : {}),
      remoteMachineTransportPolicy: resolveRemoteMachineTransportPolicy(),
    })
    diagnostics.recordHostReady({ port: Number(new URL(host.baseUrl).port) })
    if (!lifecycle.isRequested) {
      process.stdout.write(
        `${JSON.stringify({
          host: '127.0.0.1',
          baseUrl: host.baseUrl,
          epoch: host.epoch,
          databasePath: host.databasePath,
          allowedWorkspaceRoots: arguments_.workspaces,
          allowedOrigins: arguments_.origins,
        })}\n`,
      )
    }
    const shutdownReason = await lifecycle.requested
    cleanShutdownRequested = true
    if (desktopManaged) {
      process.stderr.write(
        `[codetether:host] managed shutdown requested (${shutdownReason})\n`,
      )
    }
  } finally {
    lifecycle.dispose()
    await host?.close()
    if (host !== undefined && cleanShutdownRequested) {
      diagnostics?.recordHostShutdown()
    }
  }
}

await main().catch((error: unknown) => {
  diagnostics?.recordHostStartupFailure(error)
  if (error instanceof UnsupportedSqliteSchemaMigrationError) {
    process.stderr.write(UNSUPPORTED_SCHEMA_STDERR)
    process.exitCode = UNSUPPORTED_SCHEMA_EXIT_CODE
    return
  }
  process.stderr.write(STARTUP_FAILURE_STDERR)
  process.exitCode = 1
})
