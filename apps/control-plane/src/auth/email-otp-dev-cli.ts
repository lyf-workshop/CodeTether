import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { readControlPlaneConfiguration } from '../configuration.js'
import { runMigrations } from '../persistence/migrations.js'
import { PostgresDatabase } from '../persistence/postgres-database.js'
import { AuthenticatedAccountService } from '../services/authenticated-account-service.js'
import { SupabaseHumanAuthVerifier } from './supabase-human-auth-verifier.js'

const emailSchema = z.string().trim().email().max(320)
const otpSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6,10}$/)

async function readEmail(): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    return emailSchema.parse(await prompt.question('Supabase email: '))
  } finally {
    prompt.close()
  }
}

async function readHiddenOtp(): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error('OTP verification requires an interactive local terminal')
  }
  stdout.write('Email OTP (input hidden): ')
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()
  let value = ''
  try {
    return await new Promise<string>((resolve, reject) => {
      const onKeypress = (
        character: string,
        key: { readonly name?: string; readonly ctrl?: boolean },
      ): void => {
        if (key.ctrl && key.name === 'c') {
          stdin.off('keypress', onKeypress)
          reject(new Error('OTP entry cancelled'))
          return
        }
        if (key.name === 'return' || key.name === 'enter') {
          stdin.off('keypress', onKeypress)
          stdout.write('\n')
          try {
            resolve(otpSchema.parse(value))
          } catch (error) {
            reject(error)
          }
          return
        }
        if (key.name === 'backspace') {
          value = value.slice(0, -1)
          return
        }
        if (/^[0-9]$/.test(character) && value.length < 10) {
          value += character
        }
      }
      stdin.on('keypress', onKeypress)
    })
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
  }
}

async function runEmailOtpDevelopmentFlow(): Promise<void> {
  const configuration = readControlPlaneConfiguration(process.env)
  const supabase = createClient(
    configuration.supabaseUrl,
    configuration.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  )
  const email = await readEmail()
  const requested = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (requested.error) throw new Error('Supabase OTP request failed')
  stdout.write('OTP requested. Check the configured email inbox.\n')

  const token = await readHiddenOtp()
  const verified = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  const accessToken = verified.data.session?.access_token
  if (verified.error || !accessToken) {
    throw new Error('Supabase OTP verification failed')
  }

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
    await runMigrations(database)
    const verifier = new SupabaseHumanAuthVerifier({
      supabaseUrl: configuration.supabaseUrl,
    })
    const service = new AuthenticatedAccountService(database)
    const first = await service.verifyAndResolve(verifier, accessToken)
    const repeated = await service.verifyAndResolve(verifier, accessToken)
    const spaces = await database.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM control_plane.spaces
        WHERE kind = 'personal' AND personal_owner_user_id = $1`,
      [first.userId],
    )
    if (
      first.userId !== repeated.userId ||
      first.personalSpaceId !== repeated.personalSpaceId ||
      spaces.rows[0]?.count !== '1'
    ) {
      throw new Error('Authenticated account bootstrap was not idempotent')
    }
    stdout.write(
      `${JSON.stringify({
        component: 'control-plane',
        event: 'email_otp_auth_complete',
        userId: first.userId,
        personalSpaceId: first.personalSpaceId,
        repeatedIdentityStable: true,
        personalSpaceCount: 1,
        deviceAuthentication: 'not_implemented_phase9a4',
      })}\n`,
    )
  } finally {
    await database.close()
  }
}

runEmailOtpDevelopmentFlow().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      component: 'control-plane',
      event: 'email_otp_auth_failed',
    })}\n`,
  )
  process.exitCode = 1
})
