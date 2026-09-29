import { z } from 'zod'

const positiveInteger = z.coerce.number().int().positive()

const supabaseUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !local) {
      context.addIssue({
        code: 'custom',
        message: 'Supabase URL must use HTTPS outside local development',
      })
    }
    if (
      url.pathname !== '/' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Supabase URL must contain only the project origin',
      })
    }
  })

const databaseEnvironmentSchema = z.object({
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
  CODETETHER_CONTROL_PLANE_DATABASE_TLS: z
    .enum(['verify-full', 'disable'])
    .default('verify-full'),
  CODETETHER_CONTROL_PLANE_ALLOWED_ORIGINS: z.string().max(4_096).optional(),
})

const environmentSchema = databaseEnvironmentSchema.extend({
  SUPABASE_URL: supabaseUrlSchema,
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(32)
    .max(512)
    .startsWith('sb_publishable_'),
})

export interface ControlPlaneDatabaseConfiguration {
  readonly databaseUrl: string
  readonly environment: 'development' | 'test' | 'production'
  readonly listenHost: '127.0.0.1' | '::1' | 'localhost'
  readonly listenPort: number
  readonly databasePoolMax: number
  readonly databaseConnectTimeoutMilliseconds: number
  readonly databaseIdleTimeoutMilliseconds: number
  readonly databaseStatementTimeoutMilliseconds: number
  readonly databaseTls: 'verify-full' | 'disable'
  readonly allowedOrigins: readonly string[]
}

export interface ControlPlaneConfiguration extends ControlPlaneDatabaseConfiguration {
  readonly supabaseUrl: string
  readonly supabasePublishableKey: string
}

function databaseConfiguration(
  value: z.infer<typeof databaseEnvironmentSchema>,
): ControlPlaneDatabaseConfiguration {
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
    databaseTls: value.CODETETHER_CONTROL_PLANE_DATABASE_TLS,
    allowedOrigins: parseAllowedOrigins(
      value.CODETETHER_CONTROL_PLANE_ALLOWED_ORIGINS,
      value.CODETETHER_CONTROL_PLANE_ENVIRONMENT,
    ),
  }
}

function parseAllowedOrigins(
  configured: string | undefined,
  environment: 'development' | 'test' | 'production',
): readonly string[] {
  const defaults =
    environment === 'development'
      ? ['http://tauri.localhost', 'http://127.0.0.1:5173']
      : ['tauri://localhost', 'http://tauri.localhost']
  const candidates = configured?.split(',') ?? defaults
  return candidates.map((candidate) => {
    const value = candidate.trim()
    const url = new URL(value)
    const isMacTauriOrigin = value === 'tauri://localhost'
    const isWebOrigin =
      url.origin === value &&
      url.username === '' &&
      url.password === '' &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === 'tauri.localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === 'localhost')))
    if (
      value.length === 0 ||
      value.length > 512 ||
      (!isMacTauriOrigin && !isWebOrigin)
    ) {
      throw new Error('Control Plane allowed origins contain an invalid origin')
    }
    return value
  })
}

export function readControlPlaneDatabaseConfiguration(
  environment: NodeJS.ProcessEnv,
): ControlPlaneDatabaseConfiguration {
  return databaseConfiguration(databaseEnvironmentSchema.parse(environment))
}

export function readControlPlaneConfiguration(
  environment: NodeJS.ProcessEnv,
): ControlPlaneConfiguration {
  const value = environmentSchema.parse(environment)
  return {
    ...databaseConfiguration(value),
    supabaseUrl: value.SUPABASE_URL,
    supabasePublishableKey: value.SUPABASE_PUBLISHABLE_KEY,
  }
}
