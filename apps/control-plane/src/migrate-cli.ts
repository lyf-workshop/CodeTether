import { readControlPlaneConfiguration } from './configuration.js'
import { runMigrations } from './persistence/migrations.js'
import { PostgresDatabase } from './persistence/postgres-database.js'

async function migrate(): Promise<void> {
  const configuration = readControlPlaneConfiguration(process.env)
  const database = new PostgresDatabase({
    connectionString: configuration.databaseUrl,
    maxConnections: configuration.databasePoolMax,
    connectionTimeoutMilliseconds:
      configuration.databaseConnectTimeoutMilliseconds,
    idleTimeoutMilliseconds: configuration.databaseIdleTimeoutMilliseconds,
    statementTimeoutMilliseconds:
      configuration.databaseStatementTimeoutMilliseconds,
  })
  try {
    const result = await runMigrations(database)
    process.stdout.write(
      `${JSON.stringify({
        component: 'control-plane',
        event: 'migrations_complete',
        appliedCount: result.applied.length,
        alreadyAppliedCount: result.alreadyApplied.length,
      })}\n`,
    )
  } finally {
    await database.close()
  }
}

migrate().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      component: 'control-plane',
      event: 'migrations_failed',
    })}\n`,
  )
  process.exitCode = 1
})
