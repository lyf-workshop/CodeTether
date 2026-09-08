import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'
import { createHostProcessLifecycle } from './host-process-lifecycle.js'
import {
  isDesktopManaged,
  parseServeArguments,
  resolveHostVersion,
  resolveRemoteMachineTransportPolicy,
} from './serve-config.js'

declare const __CODETETHER_PRODUCT_VERSION__: string | undefined

async function main(): Promise<void> {
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
  const lifecycle = createHostProcessLifecycle({
    desktopManaged,
    onNetworkRestored: () => {
      host?.service.requestNetworkRecovery('desktop_resume')
    },
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
      port: arguments_.port,
      desktopManaged,
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
