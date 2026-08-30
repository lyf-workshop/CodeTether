import {
  startLocalCodexHost,
  type RunningLocalCodexHost,
} from './api/local-codex-host.js'
import { createHostProcessLifecycle } from './host-process-lifecycle.js'
import {
  isDesktopManaged,
  parseServeArguments,
  resolveHostVersion,
} from './serve-config.js'

async function main(): Promise<void> {
  const desktopManaged = isDesktopManaged()
  const lifecycle = createHostProcessLifecycle({ desktopManaged })
  let host: RunningLocalCodexHost | undefined
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
