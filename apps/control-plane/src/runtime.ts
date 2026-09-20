import { readControlPlaneConfiguration } from './configuration.js'
import { runMigrations } from './persistence/migrations.js'
import { PostgresDatabase } from './persistence/postgres-database.js'
import { startControlPlaneServer } from './server.js'

export async function runControlPlane(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const configuration = readControlPlaneConfiguration(environment)
  const database = new PostgresDatabase({
    connectionString: configuration.databaseUrl,
    maxConnections: configuration.databasePoolMax,
    connectionTimeoutMilliseconds:
      configuration.databaseConnectTimeoutMilliseconds,
    idleTimeoutMilliseconds: configuration.databaseIdleTimeoutMilliseconds,
    statementTimeoutMilliseconds:
      configuration.databaseStatementTimeoutMilliseconds,
  })

  let server: Awaited<ReturnType<typeof startControlPlaneServer>> | undefined
  try {
    await runMigrations(database)
    server = await startControlPlaneServer({
      database,
      host: configuration.listenHost,
      port: configuration.listenPort,
    })
    process.stdout.write(
      `${JSON.stringify({
        component: 'control-plane',
        event: 'ready',
        host: configuration.listenHost,
        port: server.address.port,
        environment: configuration.environment,
      })}\n`,
    )

    await new Promise<void>((resolve) => {
      let closing = false
      const close = (): void => {
        if (closing) return
        closing = true
        resolve()
      }
      process.once('SIGINT', close)
      process.once('SIGTERM', close)
    })
  } finally {
    if (server) await server.close()
    await database.close()
  }
}
