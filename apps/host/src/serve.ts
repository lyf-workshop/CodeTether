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
  resolveRemoteMachineTransportPolicy,
} from './serve-config.js'

declare const __CODETETHER_PRODUCT_VERSION__: string | undefined

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
        version:
          typeof __CODETETHER_PRODUCT_VERSION__ === 'string'
            ? __CODETETHER_PRODUCT_VERSION__
            : 'development',
        build: await resolveHostVersion(),
        platform: process.platform,
        architecture: process.arch,
      })}\n`,
    )
    return
  }
  const desktopManaged = isDesktopManaged()
  let host: RunningLocalCodexHost | undefined
  const signer = new HostPresenceSigningBridge((line) =>
    process.stdout.write(line),
  )
  const lifecycle = createHostProcessLifecycle({
    desktopManaged,
    onNetworkRestored: () => {
      host?.service.requestNetworkRecovery('desktop_resume')
      host?.requestPresenceRenewal?.()
    },
    onPresenceSignature: (line) => signer.receive(line),
  })
  try {
    if (!(await lifecycle.activated) || lifecycle.isRequested) return
    const arguments_ = parseServeArguments(process.argv.slice(2), {
      desktopManaged,
    })
    const hostVersion = await resolveHostVersion()
    host = await startLocalCodexHost({
      allowedWorkspaceRoots: arguments_.workspaces,
      allowedOrigins: arguments_.origins,
      hostVersion,
      startupTimeline,
      port: arguments_.port,
      desktopManaged,
      // The existing --port 0 smoke-test mode must isolate BOTH listeners and
      // never inherit production Relay registration. Normal Desktop stays 4317/4318.
      ...(arguments_.port === 0
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
    if (desktopManaged) {
      process.stderr.write(
        `[codetether:host] managed shutdown requested (${shutdownReason})\n`,
      )
    }
  } finally {
    lifecycle.dispose()
    await host?.close()
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codetether:host] ${message}\n`)
  process.exitCode = 1
})
