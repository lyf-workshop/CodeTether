import { readFile } from 'node:fs/promises'

import { startLocalCodexHost } from './api/local-codex-host.js'

interface ServeArguments {
  readonly workspaces: readonly string[]
  readonly origins: readonly string[]
  readonly port: number
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2))
  const hostVersion = await readHostVersion()
  const host = await startLocalCodexHost({
    allowedWorkspaceRoots: arguments_.workspaces,
    allowedOrigins: arguments_.origins,
    hostVersion,
    port: arguments_.port,
  })
  process.stdout.write(
    `${JSON.stringify({
      host: '127.0.0.1',
      baseUrl: host.baseUrl,
      epoch: host.epoch,
      allowedWorkspaceRoots: arguments_.workspaces,
      allowedOrigins: arguments_.origins,
    })}\n`,
  )

  await waitForShutdownSignal()
  await host.close()
}

async function readHostVersion(): Promise<string> {
  const text = await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  )
  const value = JSON.parse(text) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    value.version.trim().length === 0
  ) {
    throw new Error('Host package version is invalid')
  }
  return value.version
}

function parseArguments(arguments_: readonly string[]): ServeArguments {
  const workspaces: string[] = []
  const origins: string[] = ['http://127.0.0.1:5173', 'http://localhost:5173']
  let port = 4317
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--workspace') {
      workspaces.push(requireValue(arguments_, ++index, '--workspace'))
      continue
    }
    if (argument === '--origin') {
      origins.push(requireValue(arguments_, ++index, '--origin'))
      continue
    }
    if (argument === '--port') {
      port = Number(requireValue(arguments_, ++index, '--port'))
      continue
    }
    throw new Error(`Unknown Host argument: ${argument ?? ''}`)
  }
  if (workspaces.length === 0) {
    throw new Error(
      'At least one explicit --workspace <absolute path> is required',
    )
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be an integer from 0 to 65535')
  }
  return { workspaces, origins: [...new Set(origins)], port }
}

function requireValue(
  arguments_: readonly string[],
  index: number,
  flag: string,
): string {
  const value = arguments_[index]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[codetether:host] ${message}\n`)
  process.exitCode = 1
})
