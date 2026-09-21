import { readControlPlaneDatabaseConfiguration } from './configuration.js'
import {
  classifyManagedPostgresConnection,
  runNativePostgresSmoke,
} from './native-postgres-smoke.js'
import {
  assertManagedDevelopmentSmokeSafety,
  nativePostgresSmokeFailureDiagnostic,
  NativePostgresSmokeCliError,
} from './native-postgres-smoke-diagnostics.js'
import { PostgresDatabase } from './persistence/postgres-database.js'

async function smoke(): Promise<void> {
  let configuration
  try {
    configuration = readControlPlaneDatabaseConfiguration(process.env)
  } catch (cause) {
    throw new NativePostgresSmokeCliError('environment', {
      cause,
      reason: 'invalid_database_configuration',
    })
  }
  assertManagedDevelopmentSmokeSafety(configuration)

  let database: PostgresDatabase
  try {
    database = new PostgresDatabase({
      connectionString: configuration.databaseUrl,
      maxConnections: configuration.databasePoolMax,
      connectionTimeoutMilliseconds:
        configuration.databaseConnectTimeoutMilliseconds,
      idleTimeoutMilliseconds: configuration.databaseIdleTimeoutMilliseconds,
      statementTimeoutMilliseconds:
        configuration.databaseStatementTimeoutMilliseconds,
      tls: configuration.databaseTls,
    })
  } catch (cause) {
    throw new NativePostgresSmokeCliError('database_initialization', {
      cause,
    })
  }

  let failure: unknown
  try {
    let clientTls
    try {
      clientTls = await database.inspectClientTls()
    } catch (cause) {
      throw new NativePostgresSmokeCliError('client_tls_verification', {
        cause,
        reason: 'client_tls_connection_failed',
      })
    }
    const result = await runNativePostgresSmoke(database, {
      clientTls,
      connectionKind: classifyManagedPostgresConnection(
        configuration.databaseUrl,
      ),
    })
    process.stdout.write(
      `${JSON.stringify({
        component: 'control-plane',
        event: 'native_postgres_smoke_complete',
        tls: result.tls,
        tlsVerificationMode: clientTls.verificationMode,
        clientTlsEncrypted: clientTls.encrypted,
        clientTlsAuthorized: clientTls.authorized,
        clientTlsAuthorizationErrorPresent: clientTls.authorizationErrorPresent,
        clientTlsVerified: result.clientTlsVerified,
        backendTlsObservation: result.backendTlsObservation,
        connectionKind: result.connectionKind,
        appliedCount: result.firstMigration.applied.length,
        repeatNoOp: result.repeatedMigration.applied.length === 0,
        fixtureRolledBack: result.fixtureRolledBack,
        constraintCount: result.constraintCount,
        triggerCount: result.triggerCount,
      })}\n`,
    )
  } catch (cause) {
    failure = cause
  }

  try {
    await database.close()
  } catch (cause) {
    if (!failure) {
      failure = new NativePostgresSmokeCliError('database_close', { cause })
    }
  }

  if (failure) throw failure
}

smoke().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(nativePostgresSmokeFailureDiagnostic(error))}\n`,
  )
  process.exitCode = 1
})
