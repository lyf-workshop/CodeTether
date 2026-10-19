import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, LoaderCircle } from 'lucide-react'

import { Button, CodeTetherMark, Input, SectionState } from '@codetether/ui'
import {
  accountSignInErrorMessage,
  requestAccountSignInCode,
  verifyAccountSignInCode,
} from '../../runtime/account/account-auth-actions'
import {
  accountSessionQueryKey,
  useAccountSession,
} from '../../runtime/account/use-account-session'
import { AccountConfigurationNotice } from './account-settings'

export function SignInPage() {
  const { supabase, query } = useAccountSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [stage, setStage] = useState<'email' | 'otp'>('email')
  const [error, setError] = useState<string>()
  const busyRef = useRef(false)
  const otpRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const mutation = useMutation({
    mutationFn: async (action: 'request' | 'verify') => {
      if (supabase === undefined)
        throw new Error('account_service_unconfigured')
      if (action === 'request') await requestAccountSignInCode(supabase, email)
      else await verifyAccountSignInCode(supabase, email, otp)
    },
  })
  const busy = mutation.isPending
  useEffect(() => {
    if (query.data)
      void navigate({
        to: '/settings/$section',
        params: { section: 'account' },
        replace: true,
      })
  }, [navigate, query.data])
  useEffect(() => {
    if (stage === 'otp') otpRef.current?.focus()
  }, [stage])

  async function run(action: 'request' | 'verify') {
    if (busyRef.current || supabase === undefined) return
    busyRef.current = true
    setError(undefined)
    try {
      await mutation.mutateAsync(action)
      if (action === 'request') setStage('otp')
      else
        await queryClient.invalidateQueries({
          queryKey: accountSessionQueryKey,
          exact: true,
        })
    } catch (cause) {
      setError(
        accountSignInErrorMessage(
          cause,
          action === 'request' ? 'email' : 'otp',
        ),
      )
    } finally {
      busyRef.current = false
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(stage === 'email' ? 'request' : 'verify')
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-md px-4 py-10 sm:py-14">
      <Link
        to="/settings/$section"
        params={{ section: 'account' }}
        className="mb-5 inline-flex items-center gap-2 rounded-xs text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回账号
      </Link>
      <section
        className="rounded-xl border border-border bg-surface p-6 sm:p-8"
        aria-labelledby={`${id}-heading`}
      >
        <CodeTetherMark className="size-11 rounded-xl [&_svg]:size-6" />
        <h1 id={`${id}-heading`} className="mt-5 text-page font-semibold">
          {stage === 'email' ? '登录 CodeTether' : '输入登录码'}
        </h1>
        <p className="mt-3 text-base text-text-secondary">
          只用这台电脑和配对的设备不需要登录。
        </p>
        {supabase === undefined ? (
          <div className="mt-5">
            <AccountConfigurationNotice />
            <Button asChild variant="secondary" className="mt-4 w-full">
              <Link to="/devices">知道了</Link>
            </Button>
          </div>
        ) : query.isError ? (
          <SectionState
            state="error"
            title="暂时无法读取登录状态"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void query.refetch()
                }}
              >
                重试
              </Button>
            }
          />
        ) : query.data === undefined ? (
          <SectionState state="loading" title="正在读取登录状态" />
        ) : (
          <form onSubmit={submit} aria-busy={busy} className="mt-6 space-y-4">
            <label
              htmlFor={`${id}-email`}
              className="block text-sm font-medium"
            >
              邮箱
            </label>
            <Input
              id={`${id}-email`}
              ref={emailRef}
              autoComplete="email"
              type="email"
              maxLength={320}
              value={email}
              disabled={busy || stage === 'otp'}
              aria-invalid={Boolean(error) && stage === 'email'}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
            {stage === 'otp' ? (
              <>
                <p className="text-sm text-text-secondary">
                  登录码已发送到{' '}
                  <span className="break-all font-medium text-text-primary">
                    {email.trim()}
                  </span>
                  。请输入邮件中的数字登录码；有效期以邮件和账号服务为准。
                </p>
                <label
                  htmlFor={`${id}-otp`}
                  className="block text-sm font-medium"
                >
                  登录码
                </label>
                <Input
                  id={`${id}-otp`}
                  ref={otpRef}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={10}
                  value={otp}
                  disabled={busy}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className="font-mono tracking-widest"
                  onChange={(event) => setOtp(event.currentTarget.value)}
                  required
                />
              </>
            ) : null}
            {error ? (
              <p
                id={`${id}-error`}
                role="alert"
                className="text-sm text-danger-text"
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {stage === 'email' ? '发送登录码' : '验证并登录'}
            </Button>
            {stage === 'otp' ? (
              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setStage('email')
                    setOtp('')
                    setError(undefined)
                    requestAnimationFrame(() => emailRef.current?.focus())
                  }}
                >
                  更换邮箱
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void run('request')
                  }}
                >
                  重新发送登录码
                </Button>
              </div>
            ) : null}
            <p className="text-sm text-text-muted">
              只能登录已有账号。收不到邮件时请检查垃圾邮件；账号服务可能限制重复发送的频率。
            </p>
          </form>
        )}
      </section>
    </div>
  )
}
