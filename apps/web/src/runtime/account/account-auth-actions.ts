import type { Session, SupabaseClient } from '@supabase/supabase-js'

type AccountAuthClient = Pick<SupabaseClient, 'auth'>

export interface AccountSessionSummary {
  readonly userId: string
  readonly email?: string
}

export function presentAccountSession(
  session: Pick<Session, 'user'> | null,
): AccountSessionSummary | null {
  return session === null
    ? null
    : {
        userId: session.user.id,
        ...(session.user.email === undefined
          ? {}
          : { email: session.user.email }),
      }
}

export function normalizeAccountEmail(value: string): string {
  const email = value.trim()
  if (!/^\S+@\S+\.\S+$/u.test(email) || email.length > 320)
    throw new Error('account_email_invalid')
  return email
}

export function normalizeAccountOtp(value: string): string {
  const otp = value.trim()
  if (!/^\d{6,10}$/u.test(otp)) throw new Error('account_otp_invalid')
  return otp
}

export async function requestAccountSignInCode(
  client: AccountAuthClient,
  email: string,
) {
  const result = await client.auth.signInWithOtp({
    email: normalizeAccountEmail(email),
    options: { shouldCreateUser: false },
  })
  if (result.error) throw result.error
}

export async function verifyAccountSignInCode(
  client: AccountAuthClient,
  email: string,
  otp: string,
) {
  const result = await client.auth.verifyOtp({
    email: normalizeAccountEmail(email),
    token: normalizeAccountOtp(otp),
    type: 'email',
  })
  if (result.error) throw result.error
}

export function accountSignInErrorMessage(
  error: unknown,
  stage: 'email' | 'otp',
) {
  if (error instanceof Error && error.message === 'account_email_invalid')
    return '请输入有效的邮箱地址。'
  if (error instanceof Error && error.message === 'account_otp_invalid')
    return '请输入邮件中的 6 到 10 位数字登录码。'
  return stage === 'email'
    ? '暂时无法发送登录码。请稍后重试；如果请求过于频繁，请等待后再发送。'
    : '登录码验证失败，请检查邮箱和登录码后重试。'
}
