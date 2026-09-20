import { readControlPlaneDatabaseConfiguration } from './configuration.js'
import { runNativePostgresSmoke } from './native-postgres-smoke.js'
import { PostgresDatabase } from './persistence/postgres-database.js'

async function smoke(): Promise<void> {
  const configuration = readControlPlaneDatabaseConfiguration(process.env)
  const database = new PostgresDatabase({
    connectionString: configuration.databaseUrl,
    maxConnections: configuration.databasePoolMax,
    connectionTimeoutMilliseconds:
      configuration.databaseConnectTimeoutMilliseconds,
    idleTimeoutMilliseconds: configuration.databaseIdleTimeoutMilliseconds,
    statementTimeoutMilliseconds:
      configuration.databaseStatementTimeoutMilliseconds,
    tls: configuration.databaseTls,
  })
  try {
    const result = await runNativePostgresSmoke(database)
    process.stdout.write(
      `${JSON.stringify({
        component: 'control-plane',
        event: 'native_postgres_smoke_complete',
        tls: result.tls,
        appliedCount: result.firstMigration.applied.length,
        repeatNoOp: result.repeatedMigration.applied.length === 0,
        fixtureRolledBack: result.fixtureRolledBack,
        constraintCount: result.constraintCount,
        triggerCount: result.triggerCount,
      })}\n`,
    )
  } finally {
    await database.close()
  }
}

smoke().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      component: 'control-plane',
      event: 'native_postgres_smoke_failed',
    })}\n`,
  )
  process.exitCode = 1
})
