import { useState, type MouseEvent } from 'react'
import { ExternalLink } from 'lucide-react'

import type { ProviderId } from '@codetether/protocol'

import { nativeCapabilities } from '../../runtime/native/native-capabilities'
import { providerInstallationGuidance } from './onboarding-model'

interface ProviderGuidanceLinkProps {
  readonly children: string
  readonly provider: ProviderId
}

/**
 * Browser mode keeps a normal external link. Installed Desktop intercepts the
 * click and invokes a native command that accepts only a Provider enum; Web
 * never receives generic URL- or shell-opening authority.
 */
export function ProviderGuidanceLink({
  children,
  provider,
}: ProviderGuidanceLinkProps) {
  const [failed, setFailed] = useState(false)
  const guidance = providerInstallationGuidance[provider]

  function openGuidance(event: MouseEvent<HTMLAnchorElement>) {
    if (!nativeCapabilities.providerGuidance.available) return
    event.preventDefault()
    setFailed(false)
    void nativeCapabilities.providerGuidance.open(provider).catch(() => {
      setFailed(true)
    })
  }

  return (
    <>
      <a
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={guidance.href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={openGuidance}
      >
        {children}
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          无法打开官方指南。请稍后重试。
        </p>
      ) : null}
    </>
  )
}
