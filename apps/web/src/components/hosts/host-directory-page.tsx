import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle2,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  Server,
  WifiOff,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'

import { Badge, Button } from '@codetether/ui'

import { controlPlaneBaseUrl } from '../../runtime/account/account-config.js'
import {
  ControlPlaneClientError,
  listAuthorizedHosts,
  resolveExistingProductDevice,
  type AuthorizedHostDirectoryEntry,
} from '../../runtime/account/control-plane-client.js'
import {
  connectRemoteSupervisor,
  publishLocalSupervisorPresence,
  type LocalHostIdentityRecord,
} from '../../runtime/account/remote-supervisor.js'
import { getSupabaseAccountClient } from '../../runtime/account/supabase-account.js'
import { hostBaseUrl } from '../../runtime/host/host-config.js'
import { useHostConnectionState } from '../../runtime/host/host-runtime-hooks.js'
import { nativeCapabilities } from '../../runtime/native/native-capabilities.js'

export function HostDirectoryPage() {
  const supabase = getSupabaseAccountClient()
  const [session, setSession] = useState<Session | null | undefined>(() =>
    supabase === undefined ? null : undefined,
  )
  const [sessionError, setSessionError] = useState(false)

  useEffect(() => {
    if (supabase === undefined) return
    let active = true
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setSessionError(true)
          setSession(null)
          return
        }
        setSessionError(false)
        setSession(data.session)
      })
      .catch(() => {
        if (!active) return
        setSessionError(true)
        setSession(null)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSessionError(false)
        setSession(nextSession)
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [supabase])

  if (supabase === undefined) return <AccountConfigurationRequired />
  if (session === undefined)
    return <DirectoryBoundary label="Checking account session…" />
  if (sessionError) return <AccountSessionUnavailable />
  if (session === null) return <EmailOtpSignIn />
  return <AuthenticatedHostDirectory session={session} />
}

function EmailOtpSignIn() {
  const supabase = getSupabaseAccountClient()!
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [stage, setStage] = useState<'email' | 'otp'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const normalizedEmail = email.trim()
      if (
        !/^\S+@\S+\.\S+$/u.test(normalizedEmail) ||
        normalizedEmail.length > 320
      ) {
        throw new Error('Enter a valid email address.')
      }
      if (stage === 'email') {
        const result = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: { shouldCreateUser: false },
        })
        if (result.error) throw result.error
        setStage('otp')
      } else {
        const normalizedOtp = otp.trim()
        if (!/^\d{6,10}$/u.test(normalizedOtp)) {
          throw new Error('Enter the numeric code from your email.')
        }
        const result = await supabase.auth.verifyOtp({
          email: normalizedEmail,
          token: normalizedOtp,
          type: 'email',
        })
        if (result.error) throw result.error
      }
    } catch (cause) {
      const inputError =
        cause instanceof Error &&
        (cause.message === 'Enter a valid email address.' ||
          cause.message === 'Enter the numeric code from your email.')
          ? cause.message
          : undefined
      setError(
        inputError ??
          (stage === 'email'
            ? 'The sign-in code could not be requested. Wait for any cooldown, then retry.'
            : 'The code could not be verified. Check it and try again.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageFrame
      title="Sign in"
      description="Use your existing CodeTether account to discover Hosts authorized for this Desktop."
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="mt-8 max-w-md space-y-4 rounded-lg border border-border bg-surface p-5"
      >
        <label className="block text-sm font-medium text-text-primary">
          Email
          <input
            autoComplete="email"
            className="mt-2 h-10 w-full rounded-sm border border-border bg-surface-inset px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy || stage === 'otp'}
            maxLength={320}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        {stage === 'otp' ? (
          <label className="block text-sm font-medium text-text-primary">
            One-time code
            <input
              autoComplete="one-time-code"
              autoFocus
              className="mt-2 h-10 w-full rounded-sm border border-border bg-surface-inset px-3 font-mono text-sm tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-ring"
              inputMode="numeric"
              maxLength={10}
              value={otp}
              onChange={(event) => setOtp(event.currentTarget.value)}
            />
          </label>
        ) : null}
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {stage === 'email' ? 'Send sign-in code' : 'Verify and sign in'}
        </Button>
      </form>
    </PageFrame>
  )
}

function AuthenticatedHostDirectory({
  session,
}: {
  readonly session: Session
}) {
  const navigate = useNavigate()
  const connectionState = useHostConnectionState()
  const directory = useQuery({
    queryKey: ['account', 'host-directory', session.user.id],
    queryFn: async ({ signal }) => {
      const productDevice = await resolveExistingProductDevice({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        signal,
      })
      const hosts = await listAuthorizedHosts({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        signal,
      })
      return { hosts, productDevice }
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  const localIdentity = useQuery({
    queryKey: ['host', 'local-identity-for-directory'],
    queryFn: readLocalHostIdentity,
    enabled: directory.data !== undefined && connectionState === 'connected',
    retry: false,
    staleTime: 30_000,
  })

  const errorMessage = directory.isError
    ? hostDirectoryErrorMessage(directory.error)
    : undefined

  return (
    <PageFrame
      title="My Hosts"
      description="Hosts currently owned by your Space and authorized for this exact ProductDevice."
      action={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void directory.refetch()}
          >
            <RefreshCw aria-hidden="true" /> Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void getSupabaseAccountClient()?.auth.signOut()}
          >
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      }
    >
      {directory.isPending ? (
        <DirectoryBoundary label="Loading authorized Hosts…" />
      ) : errorMessage !== undefined ? (
        <div
          role="alert"
          className="mt-8 max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-5"
        >
          <h2 className="font-semibold text-text-primary">Hosts unavailable</h2>
          <p className="mt-2 text-sm text-text-secondary">{errorMessage}</p>
        </div>
      ) : (directory.data?.hosts.length ?? 0) === 0 ? (
        <div className="mt-8 max-w-2xl rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold text-text-primary">
            No authorized Hosts
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            Your account is signed in, but this ProductDevice has no effective
            Host authorization.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 xl:grid-cols-2">
          {(directory.data?.hosts ?? []).map((host) => {
            const exactLocalHost =
              localIdentity.data?.hostId === host.hostId &&
              localIdentity.data.fingerprint === host.fingerprint &&
              localIdentity.data.identityGeneration === host.identityGeneration
            return (
              <ConnectedHostCard
                key={host.hostId}
                host={host}
                exactLocalHost={exactLocalHost}
                localIdentity={localIdentity.data}
                localConnectionState={connectionState}
                productDevice={directory.data!.productDevice}
                session={session}
                onOpenLocal={() => void navigate({ to: '/machines' })}
                onOpenRemote={() =>
                  void navigate({
                    to: '/hosts/$hostId',
                    params: { hostId: host.hostId },
                  })
                }
              />
            )
          })}
        </div>
      )}
    </PageFrame>
  )
}

function ConnectedHostCard({
  host,
  exactLocalHost,
  localIdentity,
  localConnectionState,
  productDevice,
  session,
  onOpenLocal,
  onOpenRemote,
}: {
  readonly host: AuthorizedHostDirectoryEntry
  readonly exactLocalHost: boolean
  readonly localIdentity: LocalHostIdentityRecord | undefined
  readonly localConnectionState: ReturnType<typeof useHostConnectionState>
  readonly productDevice: Awaited<
    ReturnType<typeof resolveExistingProductDevice>
  >
  readonly session: Session
  readonly onOpenLocal: () => void
  readonly onOpenRemote: () => void
}) {
  const forceRemote =
    import.meta.env.VITE_CODETETHER_FORCE_REMOTE === '1' ||
    new URLSearchParams(globalThis.location?.search ?? '').get(
      'forceRemote',
    ) === '1'
  const presence = useQuery({
    queryKey: ['account', 'host-supervisor-presence', host.hostId],
    queryFn: async ({ signal }) => {
      if (localIdentity === undefined) throw new Error('local_host_unavailable')
      await publishLocalSupervisorPresence({
        session,
        controlPlaneBaseUrl,
        host,
        localIdentity,
        productDevice,
        deviceIdentity: nativeCapabilities.productDeviceIdentity,
        hostIdentity: nativeCapabilities.hostIdentity,
        signal,
      })
      return true
    },
    enabled:
      exactLocalHost &&
      localIdentity !== undefined &&
      localConnectionState === 'connected',
    retry: false,
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
  })
  const remoteConnection = useQuery({
    queryKey: [
      'account',
      'remote-supervisor',
      host.hostId,
      host.supervisor?.transport.payload.exp,
      forceRemote,
    ],
    queryFn: async ({ signal }) => {
      let remoteHost = host
      if (exactLocalHost) {
        await presence.refetch()
        const refreshed = await listAuthorizedHosts({
          accessToken: session.access_token,
          baseUrl: controlPlaneBaseUrl,
          identity: nativeCapabilities.productDeviceIdentity,
          productDevice,
          signal,
        })
        remoteHost =
          refreshed.find((candidate) => candidate.hostId === host.hostId) ??
          host
      }
      return await connectRemoteSupervisor({
        session,
        host: remoteHost,
        productDevice,
        deviceIdentity: nativeCapabilities.productDeviceIdentity,
        signal,
      })
    },
    enabled:
      (!exactLocalHost || forceRemote) &&
      (!exactLocalHost ? host.supervisor !== null : presence.isSuccess),
    retry: false,
    staleTime: 60_000,
  })

  const localOnline =
    exactLocalHost && !forceRemote && localConnectionState === 'connected'
  const online = localOnline || remoteConnection.isSuccess
  const checking =
    localConnectionState === 'connecting' ||
    localConnectionState === 'reconnecting' ||
    remoteConnection.isFetching ||
    (forceRemote && presence.isPending)
  return (
    <HostCard
      host={host}
      checking={checking}
      online={online}
      onOpen={online ? (localOnline ? onOpenLocal : onOpenRemote) : undefined}
    />
  )
}

function HostCard({
  host,
  checking,
  online,
  onOpen,
}: {
  readonly host: AuthorizedHostDirectoryEntry
  readonly checking: boolean
  readonly online: boolean
  readonly onOpen?: () => void
}) {
  return (
    <article className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface-inset">
            <Monitor aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-text-primary">
              {host.safeLabel}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {host.coarsePlatform} · {host.hostId}
            </p>
          </div>
        </div>
        <Badge variant={online ? 'success' : 'secondary'}>
          {checking ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />{' '}
              Checking…
            </>
          ) : online ? (
            <>
              <CheckCircle2 aria-hidden="true" /> Online
            </>
          ) : (
            <>
              <WifiOff aria-hidden="true" /> Unreachable
            </>
          )}
        </Badge>
      </div>
      <p className="mt-5 text-sm text-text-secondary">
        {online
          ? 'Host identity verified. Open to read current Machine and Provider state.'
          : 'The account admission is active, but no compatible Host Supervisor connection is currently available.'}
      </p>
      <Button
        className="mt-5"
        size="sm"
        disabled={onOpen === undefined}
        onClick={onOpen}
      >
        <Server aria-hidden="true" /> Open
      </Button>
    </article>
  )
}

function PageFrame({
  title,
  description,
  action,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <main className="min-h-full px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-page font-semibold text-text-primary">{title}</h1>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </main>
  )
}

function DirectoryBoundary({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      className="grid min-h-[40vh] place-items-center text-sm text-text-secondary"
    >
      <span className="inline-flex items-center gap-2">
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
        {label}
      </span>
    </div>
  )
}

function AccountConfigurationRequired() {
  return (
    <PageFrame
      title="My Hosts"
      description="Account configuration is required."
    >
      <div
        role="alert"
        className="mt-8 max-w-2xl rounded-lg border border-warning/30 bg-warning/5 p-5 text-sm text-text-secondary"
      >
        Set the Desktop Supabase project URL, publishable key, and Control Plane
        URL. No account secret key is required.
      </div>
    </PageFrame>
  )
}

function AccountSessionUnavailable() {
  return (
    <PageFrame
      title="My Hosts"
      description="The saved account session could not be read."
    >
      <div
        role="alert"
        className="mt-8 max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-5 text-sm text-text-secondary"
      >
        Account authentication is temporarily unavailable. Restart CodeTether or
        try again after connectivity is restored.
      </div>
    </PageFrame>
  )
}

async function readLocalHostIdentity(): Promise<
  LocalHostIdentityRecord | undefined
> {
  const response = await fetch(`${hostBaseUrl}/api/v1/host/identity`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error('local_host_identity_unavailable')
  const value = (await response.json()) as {
    readonly identity?: {
      readonly hostId?: unknown
      readonly fingerprint?: unknown
      readonly identityGeneration?: unknown
      readonly publicJwk?: unknown
      readonly keyHandle?: unknown
    }
  }
  const identity = value.identity
  if (
    typeof identity?.hostId !== 'string' ||
    typeof identity.fingerprint !== 'string' ||
    !Number.isSafeInteger(identity.identityGeneration) ||
    typeof identity.publicJwk !== 'string' ||
    typeof identity.keyHandle !== 'string'
  )
    throw new Error('local_host_identity_invalid')
  return identity as LocalHostIdentityRecord
}

function hostDirectoryErrorMessage(error: unknown): string {
  if (!(error instanceof ControlPlaneClientError))
    return 'The Control Plane could not be reached. Your local Host remains available.'
  if (error.code === 'authentication_expired' || error.status === 401)
    return 'Your account session or ProductDevice proof is no longer accepted. Sign in again and retry.'
  if (
    error.code === 'product_device_not_available' ||
    error.code === 'product_device_key_unavailable'
  )
    return 'This Desktop cannot find the existing protected ProductDevice key required for account access.'
  if (error.code.includes('revoked') || error.code.includes('authorization'))
    return 'This ProductDevice no longer has effective Host authorization.'
  return 'The Control Plane is unavailable or returned an invalid response. Your local Host remains available.'
}
