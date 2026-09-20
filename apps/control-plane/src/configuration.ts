import { z } from 'zod'

const positiveInteger = z.coerce.number().int().positive()

const environmentSchema = z.object({
  CODETETHER_CONTROL_PLANE_DATABASE_URL: z
    .string()
    .min(1)
    .max(4_096)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'Database URL must use PostgreSQL',
    ),
  CODETETHER_CONTROL_PLANE_ENVIRONMENT: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  CODETETHER_CONTROL_PLANE_LISTEN_HOST: z
    .enum(['127.0.0.1', '::1', 'localhost'])
    .default('127.0.0.1'),
  CODETETHER_CONTROL_PLANE_LISTEN_PORT: positiveInteger
    .max(65_535)
    .default(4320),
  CODETETHER_CONTROL_PLANE_DATABASE_POOL_MAX: positiveInteger
    .max(100)
    .default(10),
  CODETETHER_CONTROL_PLANE_DATABASE_CONNECT_TIMEOUT_MS: positiveInteger
    .max(60_000)
    .default(5_000),
  CODETETHER_CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS: positiveInteger
    .max(600_000)
    .default(30_000),
  CODETETHER_CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS: positiveInteger
    .max(120_000)
    .default(15_000),
})

export interface ControlPlaneConfiguration {
  readonly databaseUrl: string
  readonly environment: 'development' | 'test' | 'production'
  readonly listenHost: '127.0.0.1' | '::1' | 'localhost'
  readonly listenPort: number
  readonly databasePoolMax: number
  readonly databaseConnectTimeoutMilliseconds: number
  readonly databaseIdleTimeoutMilliseconds: number
  readonly databaseStatementTimeoutMilliseconds: number
}

export function readControlPlaneConfiguration(
  environment: NodeJS.ProcessEnv,
): ControlPlaneConfiguration {
  const value = environmentSchema.parse(environment)
  return {
    databaseUrl: value.CODETETHER_CONTROL_PLANE_DATABASE_URL,
    environment: value.CODETETHER_CONTROL_PLANE_ENVIRONMENT,
    listenHost: value.CODETETHER_CONTROL_PLANE_LISTEN_HOST,
    listenPort: value.CODETETHER_CONTROL_PLANE_LISTEN_PORT,
    databasePoolMax: value.CODETETHER_CONTROL_PLANE_DATABASE_POOL_MAX,
    databaseConnectTimeoutMilliseconds:
      value.CODETETHER_CONTROL_PLANE_DATABASE_CONNECT_TIMEOUT_MS,
    databaseIdleTimeoutMilliseconds:
      value.CODETETHER_CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS,
    databaseStatementTimeoutMilliseconds:
      value.CODETETHER_CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS,
  }
}
