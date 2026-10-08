import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'

import { useHostConnectionState } from '../host/host-runtime-hooks.js'
import { nativeCapabilities } from '../native/native-capabilities.js'
import { controlPlaneBaseUrl } from './account-config.js'
import {
  listOwnedHosts,
  resolveExistingProductDevice,
} from './control-plane-client.js'
import {
  reconcileLocalSupervisorGrants,
  readLocalHostIdentity,
} from './remote-supervisor.js'
import { getSupabaseAccountClient } from './supabase-account.js'

const GRANT_REFRESH_MS = 60_000

/**
 * Authenticated OWNER grant reconciliation only. The Host runtime signs and
 * publishes its own presence; losing this component cannot expire its lease.
 */
export function LocalSupervisorPresenceCoordinator() {
  const supabase = getSupabaseAccountClient()
  const connectionState = useHostConnectionState()
  const [session, setSession] = useState<Session | null>()

  useEffect(() => {
    if (supabase === undefined) return
    let active = true
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) setSession(error === null ? data.session : null)
      })
      .catch(() => {
        if (active) setSession(null)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [supabase])

  const directory = useQuery({
    queryKey: ['account', 'supervisor-grants-owned-hosts', session?.user.id],
    queryFn: async ({ signal }) => {
      if (session === null || session === undefined) {
        throw new Error('account_session_unavailable')
      }
      const productDevice = await resolveExistingProductDevice({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        signal,
      })
      const hosts = await listOwnedHosts({
        accessToken: session.access_token,
        baseUrl: controlPlaneBaseUrl,
        identity: nativeCapabilities.productDeviceIdentity,
        productDevice,
        signal,
      })
      return { hosts, productDevice }
    },
    enabled: session !== null && session !== undefined,
    retry: false,
    staleTime: 0,
    refetchInterval: GRANT_REFRESH_MS,
    // Grant metadata observation is not a Host liveness authority.
    refetchIntervalInBackground: true,
  })
  const localIdentity = useQuery({
    queryKey: ['host', 'local-identity-for-directory'],
    queryFn: readLocalHostIdentity,
    enabled: directory.data !== undefined && connectionState === 'connected',
    retry: false,
    staleTime: 0,
  })
  const localHost = directory.data?.hosts.find(
    (host) =>
      host.hostId === localIdentity.data?.hostId &&
      host.fingerprint === localIdentity.data.fingerprint &&
      host.identityGeneration === localIdentity.data.identityGeneration,
  )
  useQuery({
    queryKey: ['account', 'host-supervisor-grants', localHost?.hostId],
    queryFn: async ({ signal }) => {
      if (
        session === null ||
        session === undefined ||
        localHost === undefined ||
        localIdentity.data === null ||
        directory.data === undefined
      ) {
        throw new Error('local_host_unavailable')
      }
      await reconcileLocalSupervisorGrants({
        session,
        controlPlaneBaseUrl,
        host: localHost,
        localIdentity: localIdentity.data!,
        productDevice: directory.data.productDevice,
        deviceIdentity: nativeCapabilities.productDeviceIdentity,
        hostIdentity: nativeCapabilities.hostIdentity,
        signal,
      })
      return true
    },
    enabled:
      localHost !== undefined &&
      localIdentity.data !== null &&
      connectionState === 'connected',
    retry: false,
    staleTime: 0,
    refetchInterval: GRANT_REFRESH_MS,
    // Host liveness continues even if this grant observation stops entirely.
    refetchIntervalInBackground: true,
  })

  return null
}
