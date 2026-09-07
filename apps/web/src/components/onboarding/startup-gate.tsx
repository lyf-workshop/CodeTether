import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@codetether/ui'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { onboardingQueryOptions } from '../../runtime/host/onboarding-query'

/** Routes only after durable Host progress is known, avoiding a Welcome flash. */
export function StartupGate() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const onboardingQuery = useQuery({
    ...onboardingQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })

  if (onboardingQuery.data !== undefined) {
    return onboardingQuery.data.step === 'ready' ? (
      <Navigate to="/inbox" replace />
    ) : (
      <Navigate to="/setup" replace />
    )
  }

  const blocked =
    onboardingQuery.isError ||
    connectionState === 'unavailable' ||
    connectionState === 'incompatible'

  return (
    <div
      className="grid min-h-[50vh] place-items-center"
      role={blocked ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="text-center text-sm text-text-secondary">
        {!blocked ? (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto mb-3 size-5 animate-spin text-primary motion-reduce:animate-none"
          />
        ) : null}
        <p>{blocked ? '暂时无法读取设置状态。' : '正在打开 CodeTether…'}</p>
        {blocked ? (
          <Button
            className="mt-4"
            type="button"
            onClick={() => {
              runtime.retry()
              void onboardingQuery.refetch()
            }}
          >
            重新检查
          </Button>
        ) : null}
      </div>
    </div>
  )
}
