import type { ControlPlaneDatabaseConfiguration } from './configuration.js'
import {
  NativePostgresSmokeError,
  type NativePostgresSmokeStage,
} from './native-postgres-smoke.js'

export type NativePostgresSmokeCliStage =
  | 'environment'
  | 'safety_guard'
  | 'database_initialization'
  | NativePostgresSmokeStage
  | 'database_close'

export class NativePostgresSmokeCliError extends Error {
  public readonly stage: NativePostgresSmokeCliStage
  public readonly reason?: string

  public constructor(
    stage: NativePostgresSmokeCliStage,
    options: { readonly cause: unknown; readonly reason?: string },
  ) {
    super('Native PostgreSQL smoke CLI failed', { cause: options.cause })
    this.name = 'NativePostgresSmokeCliError'
    this.stage = stage
    this.reason = options.reason
  }
}

export interface NativePostgresSmokeFailureDiagnostic {
  readonly component: 'control-plane'
  readonly event: 'native_postgres_smoke_failed'
  readonly stage: NativePostgresSmokeCliStage | 'unknown'
  readonly errorClass: string
  readonly code?: string
  readonly migration?: string
  readonly reason?: string
}

const safeIdentifier = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const safeErrorCode = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const safeMigrationName = /^\d{4}_[a-z0-9_]+\.sql$/
const safeReason = /^[a-z][a-z0-9_]{0,63}$/

function causes(error: unknown): readonly unknown[] {
  const values: unknown[] = []
  let current = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current) && values.length < 8) {
    seen.add(current)
    values.push(current)
    if (typeof current !== 'object' || !('cause' in current)) break
    current = current.cause
  }
  return values
}

function safeErrorClass(error: unknown): string {
  for (const value of causes(error).toReversed()) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'constructor' in value &&
      typeof value.constructor === 'function' &&
      safeIdentifier.test(value.constructor.name)
    ) {
      return value.constructor.name
    }
  }
  return 'Error'
}

function postgresErrorCode(error: unknown): string | undefined {
  for (const value of causes(error).toReversed()) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      typeof value.code === 'string' &&
      safeErrorCode.test(value.code)
    ) {
      return value.code
    }
  }
  return undefined
}

export function assertManagedDevelopmentSmokeSafety(
  configuration: ControlPlaneDatabaseConfiguration,
): void {
  if (configuration.environment !== 'development') {
    throw new NativePostgresSmokeCliError('safety_guard', {
      cause: new Error('Managed smoke environment is not development'),
      reason: 'managed_smoke_requires_development_environment',
    })
  }
  if (configuration.databaseTls !== 'verify-full') {
    throw new NativePostgresSmokeCliError('safety_guard', {
      cause: new Error('Managed smoke TLS mode is not verify-full'),
      reason: 'managed_smoke_requires_verified_tls',
    })
  }

  const databaseUrl = new URL(configuration.databaseUrl)
  const databaseName = databaseUrl.pathname.slice(1).split('/')[0]
  if (!databaseName) {
    throw new NativePostgresSmokeCliError('safety_guard', {
      cause: new Error('Managed smoke database name is absent'),
      reason: 'database_name_missing',
    })
  }

  const connectionTlsParameters = [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
  ]
  if (
    connectionTlsParameters.some((parameter) =>
      databaseUrl.searchParams.has(parameter),
    )
  ) {
    throw new NativePostgresSmokeCliError('safety_guard', {
      cause: new Error('Database URL contains TLS configuration'),
      reason: 'database_url_tls_parameters_not_allowed',
    })
  }
}

export function nativePostgresSmokeFailureDiagnostic(
  error: unknown,
): NativePostgresSmokeFailureDiagnostic {
  const smokeError = causes(error).find(
    (value): value is NativePostgresSmokeError =>
      value instanceof NativePostgresSmokeError,
  )
  const cliError = causes(error).find(
    (value): value is NativePostgresSmokeCliError =>
      value instanceof NativePostgresSmokeCliError,
  )
  const migration =
    smokeError?.migration && safeMigrationName.test(smokeError.migration)
      ? smokeError.migration
      : undefined
  const reasonValue = cliError?.reason ?? smokeError?.reason
  const reason =
    reasonValue && safeReason.test(reasonValue) ? reasonValue : undefined

  return {
    component: 'control-plane',
    event: 'native_postgres_smoke_failed',
    stage: cliError?.stage ?? smokeError?.stage ?? 'unknown',
    errorClass: safeErrorClass(error),
    ...(postgresErrorCode(error) ? { code: postgresErrorCode(error) } : {}),
    ...(migration ? { migration } : {}),
    ...(reason ? { reason } : {}),
  }
}
