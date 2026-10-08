import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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
  approveHostAccessRequest,
  cancelHostAccessRequest,
  denyHostAccessRequest,
  listAuthorizedHosts,
  listPendingHostAccessRequests,
  listOwnedHosts,
  requestHostAccess,
  resolveExistingProductDevice,
  type PendingHostAccessRequest,
  type OwnedHostAccessEntry,
  type AuthorizedHostDirectoryEntry,
} from '../../runtime/account/control-plane-client.js'
import {
  connectRemoteSupervisor,
  deriveLocalHostLifecycleState,
  enrollLocalHost,
  reconcileLocalSupervisorGrants,
  readLocalHostIdentity,
  type LocalHostIdentityRecord,
} from '../../runtime/account/remote-supervisor.js'
import { getSupabaseAccountClient } from '../../runtime/account/supabase-account.js'
import { useHostConnectionState } from '../../runtime/host/host-runtime-hooks.js'
import { nativeCapabilities } from '../../runtime/native/native-capabilities.js'
import { presentRequestingDevice } from './requesting-device-presentation.js'

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
      const [hosts, ownedHosts] = await Promise.all([
        listAuthorizedHosts({
          accessToken: session.access_token,
          baseUrl: controlPlaneBaseUrl,
          identity: nativeCapabilities.productDeviceIdentity,
          productDevice,
          signal,
        }),
        listOwnedHosts({
          accessToken: session.access_token,
          baseUrl: controlPlaneBaseUrl,
          identity: nativeCapabilities.productDeviceIdentity,
          productDevice,
          signal,
        }),
      ])
      return { hosts, ownedHosts, productDevice }
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
  const localHostLifecycle = deriveLocalHostLifecycleState(
    localIdentity.data,
    directory.data?.ownedHosts ?? [],
  )
  const enableHostMutation = useMutation({
    mutationFn: async () => {
      const productDevice = directory.data?.productDevice
      const spaceId = directory.data?.ownedHosts[0]?.spaceId
      if (productDevice === undefined || spaceId === undefined) {
        throw new Error('host_space_unavailable')
      }
      return await enrollLocalHost({
        session,
        controlPlaneBaseUrl,
        productDevice,
        productDeviceIdentity: nativeCapabilities.productDeviceIdentity,
        hostIdentity: nativeCapabilities.hostIdentity,
        spaceId,
      })
    },
    onSuccess: () => {
      void localIdentity.refetch()
      void directory.refetch()
    },
  })
  const pendingRequests = useQuery({
    queryKey: ['account', 'host-access-requests', session.user.id],
    queryFn: ({ signal }) =>
      listPendingHostAccessRequests({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice: directory.data!.productDevice,
        signal,
      }),
    enabled: directory.data !== undefined,
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
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
      {localIdentity.isSuccess &&
      (localHostLifecycle === 'disabled' ||
        localHostLifecycle === 'enabled_unclaimed') &&
      nativeCapabilities.hostIdentity.available ? (
        <HostCapabilityCard
          mutation={enableHostMutation}
          lifecycle={localHostLifecycle}
          onRetry={() => void localIdentity.refetch()}
        />
      ) : null}
      {directory.isPending ? (
        <DirectoryBoundary label="Setting up this Mac…" />
      ) : errorMessage !== undefined ? (
        <div
          role="alert"
          className="mt-8 max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-5"
        >
          <h2 className="font-semibold text-text-primary">Hosts unavailable</h2>
          <p className="mt-2 text-sm text-text-secondary">{errorMessage}</p>
        </div>
      ) : (directory.data?.ownedHosts.length ?? 0) === 0 ? (
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
        <>
          {localIdentity.data !== null &&
          pendingRequests.data?.some(
            (request) => request.payload.hostId === localIdentity.data?.hostId,
          ) ? (
            <PendingAccessRequestPanel
              requests={pendingRequests.data.filter(
                (request) =>
                  request.payload.hostId === localIdentity.data?.hostId,
              )}
              localIdentity={localIdentity.data}
              session={session}
              productDevice={directory.data!.productDevice}
              onChanged={() => void pendingRequests.refetch()}
            />
          ) : null}
          <div className="mt-8 grid gap-4 xl:grid-cols-2">
            {(directory.data?.ownedHosts ?? []).map((ownedHost) => {
              const host = directory.data?.hosts.find(
                (candidate) => candidate.hostId === ownedHost.hostId,
              )
              if (
                ownedHost.access.state === 'authorized' &&
                host !== undefined
              ) {
                const exactLocalHost =
                  localIdentity.data?.hostId === host.hostId &&
                  localIdentity.data.fingerprint === host.fingerprint &&
                  localIdentity.data.identityGeneration ===
                    host.identityGeneration
                return (
                  <ConnectedHostCard
                    key={host.hostId}
                    host={host}
                    exactLocalHost={exactLocalHost}
                    localIdentity={localIdentity.data ?? undefined}
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
              }
              return (
                <AccessRequiredHostCard
                  key={ownedHost.hostId}
                  host={ownedHost}
                  session={session}
                  productDevice={directory.data!.productDevice}
                  onChanged={() => void directory.refetch()}
                />
              )
            })}
          </div>
        </>
      )}
    </PageFrame>
  )
}

function HostCapabilityCard({
  mutation,
  lifecycle,
  onRetry,
}: {
  readonly mutation: {
    readonly isError: boolean
    readonly isPending: boolean
    readonly mutate: () => void
  }
  readonly lifecycle: 'disabled' | 'enabled_unclaimed'
  readonly onRetry: () => void
}) {
  return (
    <section className="mt-8 max-w-2xl rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface-inset">
          <Server aria-hidden="true" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-text-primary">Host capability</h2>
            <Badge variant="secondary">
              {lifecycle === 'disabled' ? 'Not enabled' : 'Setup incomplete'}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Enable this Mac as a production Host. CodeTether creates a
            separate protected Host key, registers it, and claims it into your
            existing Space without changing the ProductDevice identity.
          </p>
        </div>
      </div>
      {mutation.isError ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          The local Host capability could not be enabled. Check the local Host
          service and try again.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {lifecycle === 'disabled'
            ? 'Enable this Mac as a Host'
            : 'Complete Host setup'}
        </Button>
        {mutation.isError ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" /> Check again
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function AccessRequiredHostCard({
  host,
  session,
  productDevice,
  onChanged,
}: {
  readonly host: OwnedHostAccessEntry
  readonly session: Session
  readonly productDevice: Awaited<
    ReturnType<typeof resolveExistingProductDevice>
  >
  readonly onChanged: () => void
}) {
  const mutation = useMutation({
    mutationFn: () =>
      requestHostAccess({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        host,
      }),
    onSuccess: onChanged,
  })
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (host.access.requestId === null)
        throw new Error('access_request_id_unavailable')
      await cancelHostAccessRequest({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        requestId: host.access.requestId,
      })
    },
    onSuccess: onChanged,
  })
  const state = host.access.state
  const pending = state === 'pending'
  const denied = state === 'denied'
  const expired = state === 'expired' || state === 'cancelled'
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
              {host.coarsePlatform}
            </p>
          </div>
        </div>
        <Badge variant={pending ? 'secondary' : denied ? 'danger' : 'warning'}>
          {pending
            ? 'Waiting for approval'
            : denied
              ? 'Access denied'
              : 'Access required'}
        </Badge>
      </div>
      <p className="mt-5 text-sm text-text-secondary">
        {pending
          ? 'The Windows owner will see this request the next time CodeTether is open.'
          : denied
            ? 'The owner denied this request. You can submit a new request when appropriate.'
            : 'Request read-only workspace access from the Host owner.'}
      </p>
      {!pending && !denied && !expired ? (
        <Button
          className="mt-5"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Request Access
        </Button>
      ) : null}
      {expired ? (
        <Button
          className="mt-5"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Request Access again
        </Button>
      ) : null}
      {denied ? (
        <Button
          className="mt-5"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Request Access again
        </Button>
      ) : null}
      {pending ? (
        <Button
          className="mt-5"
          variant="outline"
          size="sm"
          disabled={cancelMutation.isPending || host.access.requestId === null}
          onClick={() => cancelMutation.mutate()}
        >
          {cancelMutation.isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Cancel request
        </Button>
      ) : null}
      {mutation.isError || cancelMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          The access request could not be updated. Retry when the Control Plane
          is reachable.
        </p>
      ) : null}
    </article>
  )
}

function PendingAccessRequestPanel({
  requests,
  localIdentity,
  session,
  productDevice,
  onChanged,
}: {
  readonly requests: readonly PendingHostAccessRequest[]
  readonly localIdentity: LocalHostIdentityRecord | undefined
  readonly session: Session
  readonly productDevice: Awaited<
    ReturnType<typeof resolveExistingProductDevice>
  >
  readonly onChanged: () => void
}) {
  return (
    <section className="mt-8 rounded-lg border border-warning/30 bg-warning/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-text-primary">
            Host access requests
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Review requests for this account-owned Host. Allow signs with the
            local Host key; Deny never grants access.
          </p>
        </div>
        <Badge variant="warning">{requests.length} pending</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {requests.map((request) => (
          <PendingAccessRequestRow
            key={request.requestId}
            request={request}
            localIdentity={localIdentity}
            session={session}
            productDevice={productDevice}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  )
}

function PendingAccessRequestRow({
  request,
  localIdentity,
  session,
  productDevice,
  onChanged,
}: {
  readonly request: PendingHostAccessRequest
  readonly localIdentity: LocalHostIdentityRecord | undefined
  readonly session: Session
  readonly productDevice: Awaited<
    ReturnType<typeof resolveExistingProductDevice>
  >
  readonly onChanged: () => void
}) {
  const requestingDevice = presentRequestingDevice(request)
  const approve = useMutation({
    mutationFn: async () => {
      if (localIdentity === undefined)
        throw new Error('local_host_identity_unavailable')
      await approveHostAccessRequest({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        hostIdentity: nativeCapabilities.hostIdentity,
        hostKeyHandle: localIdentity.keyHandle,
        request,
      })
    },
    onSuccess: onChanged,
  })
  const deny = useMutation({
    mutationFn: () =>
      denyHostAccessRequest({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        requestId: request.requestId,
      }),
    onSuccess: onChanged,
  })
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
      <div>
        <p className="font-medium text-text-primary">
          {requestingDevice?.name ?? 'Device identity unavailable'}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {requestingDevice?.platform ??
            'Requesting device could not be verified'}
        </p>
        {requestingDevice !== null ? (
          <p className="mt-1 text-xs text-text-muted">
            Device identity: {requestingDevice.shortFingerprint}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-text-muted">
          Permission: Read workspace · expires{' '}
          {new Date(request.expiresAt).toLocaleString()}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={approve.isPending || deny.isPending}
          onClick={() => deny.mutate()}
        >
          Deny
        </Button>
        <Button
          size="sm"
          disabled={
            approve.isPending ||
            deny.isPending ||
            localIdentity === undefined ||
            requestingDevice === null
          }
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          Allow
        </Button>
      </div>
      {approve.isError || deny.isError ? (
        <p role="alert" className="basis-full text-sm text-danger">
          The request could not be updated. Refresh and try again.
        </p>
      ) : null}
    </div>
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
  const validationOpened = useRef(false)
  const forceRelay =
    import.meta.env.VITE_CODETETHER_FORCE_RELAY === '1' ||
    new URLSearchParams(globalThis.location?.search ?? '').get('forceRelay') ===
      '1'
  const forceRemote =
    forceRelay ||
    import.meta.env.VITE_CODETETHER_FORCE_REMOTE === '1' ||
    new URLSearchParams(globalThis.location?.search ?? '').get(
      'forceRemote',
    ) === '1'
  const presence = useQuery({
    queryKey: ['account', 'host-supervisor-presence', host.hostId],
    queryFn: async ({ signal }) => {
      if (localIdentity === undefined) throw new Error('local_host_unavailable')
      await reconcileLocalSupervisorGrants({
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
      forceRelay,
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
        forceRelay,
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
  useEffect(() => {
    const validationHostId = import.meta.env
      .VITE_CODETETHER_VALIDATE_REMOTE_DIRECTORY_HOST_ID
    if (
      validationOpened.current ||
      validationHostId !== host.hostId ||
      !remoteConnection.isSuccess
    ) {
      return
    }
    validationOpened.current = true
    onOpenRemote()
  }, [host.hostId, onOpenRemote, remoteConnection.isSuccess])
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
  if (
    error.code.startsWith('product_device_registration_') ||
    error.code === 'device_registration_challenge_invalid' ||
    error.code === 'device_registration_challenge_expired'
  )
    return 'This Mac could not finish its secure device setup. Retry after checking the account connection.'
  if (error.code.includes('revoked') || error.code.includes('authorization'))
    return 'This ProductDevice no longer has effective Host authorization.'
  return 'The Control Plane is unavailable or returned an invalid response. Your local Host remains available.'
}
