import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'

import { Button, Notice, SectionState, SettingsRow } from '@codetether/ui'
import { useAccountSession } from '../../runtime/account/use-account-session'

export function AccountSettings() {
  const { supabase, query } = useAccountSession()
  const signOut = useMutation({
    mutationFn: async () => {
      if (supabase === undefined)
        throw new Error('account_service_unconfigured')
      const result = await supabase.auth.signOut()
      if (result.error) throw new Error('account_signout_failed')
    },
    onSuccess: async () => {
      await query.refetch()
    },
  })
  return (
    <>
      <h2 className="mb-5 text-xl font-semibold">账号</h2>
      {supabase === undefined ? (
        <AccountConfigurationNotice />
      ) : query.isError ? (
        <SectionState
          state="error"
          title="暂时无法读取登录状态"
          description="这台电脑和配对的设备仍可正常使用。"
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
      ) : query.data === null ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <SettingsRow
            title="未登录"
            description="这台电脑和配对的设备不需要账号也能使用。"
            control={
              <Button asChild>
                <Link to="/signin">登录</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <SettingsRow
            title={
              <span className="flex min-w-0 items-center gap-3">
                <UserRound
                  aria-hidden="true"
                  className="size-5 shrink-0 text-text-muted"
                />
                <span className="min-w-0 break-all">
                  {query.data.email ?? '已登录'}
                </span>
              </span>
            }
            description="邮箱登录码登录"
            control={
              <Button
                variant="secondary"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                <LogOut aria-hidden="true" />
                {signOut.isPending ? '正在退出…' : '退出登录'}
              </Button>
            }
          />
        </div>
      )}
      {signOut.isError ? (
        <div className="mt-4">
          <Notice tone="err" title="暂时无法退出登录">
            登录状态没有更改，请稍后重试。
          </Notice>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-text-muted">
        用同一账号登录的其他 Mac 或 Windows
        电脑，目前还不能出现在“设备”里。账号登录不会开启其他电脑的查看或控制权限。
        <Link
          to="/roadmap"
          className="ml-1 text-primary underline underline-offset-4"
        >
          查看后续规划
        </Link>
      </p>
    </>
  )
}

export function AccountConfigurationNotice() {
  return (
    <Notice title="这个版本没有配置账号服务">
      这台电脑和配对的设备仍可正常使用。不需要登录，也不需要修改设备或项目设置。
    </Notice>
  )
}
