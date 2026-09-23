import { readControlPlaneConfiguration } from './configuration.js'
import { SupabaseHumanAuthVerifier } from './auth/supabase-human-auth-verifier.js'
import { runMigrations } from './persistence/migrations.js'
import { PostgresDatabase } from './persistence/postgres-database.js'
import { startControlPlaneServer } from './server.js'
import { AuthenticatedAccountService } from './services/authenticated-account-service.js'
import { ProductDeviceAuthenticationService } from './services/product-device-authentication-service.js'
import { HostIdentityService } from './services/host-identity-service.js'

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
    tls: configuration.databaseTls,
  })

  let server: Awaited<ReturnType<typeof startControlPlaneServer>> | undefined
  try {
    await runMigrations(database)
    const humanAuthVerifier = new SupabaseHumanAuthVerifier({
      supabaseUrl: configuration.supabaseUrl,
      publishableKey: configuration.supabasePublishableKey,
    })
    const authenticatedAccountService = new AuthenticatedAccountService(
      database,
    )
    server = await startControlPlaneServer({
      database,
      humanAuthVerifier,
      authenticatedAccountService,
      productDeviceAuthenticationService:
        new ProductDeviceAuthenticationService(database),
      hostIdentityService: new HostIdentityService(database),
      host: configuration.listenHost,
      port: configuration.listenPort,
      allowedOrigins: configuration.allowedOrigins,
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
