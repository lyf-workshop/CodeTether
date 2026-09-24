import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight, LoaderCircle, Monitor, Server } from 'lucide-react'

import { Badge, Button } from '@codetether/ui'

import {
  currentRemoteSupervisorSession,
  readRemoteMachine,
} from '../../runtime/account/remote-supervisor.js'

export function RemoteHostPage() {
  const { hostId } = useParams({ from: '/hosts/$hostId' })
  const session = currentRemoteSupervisorSession(hostId)
  const [selectedMachineId, setSelectedMachineId] = useState<string>()
  const detail = useQuery({
    queryKey: ['remote-supervisor', hostId, 'machine', selectedMachineId],
    queryFn: async () =>
      await readRemoteMachine(hostId, selectedMachineId as string),
    enabled: session !== undefined && selectedMachineId !== undefined,
    retry: false,
  })

  if (session === undefined) {
    return (
      <main className="px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
        <h1 className="text-page font-semibold text-text-primary">
          Remote Host disconnected
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Return to My Hosts to establish a fresh authorized read session.
        </p>
        <Button asChild className="mt-5" size="sm">
          <Link to="/hosts">My Hosts</Link>
        </Button>
      </main>
    )
  }

  const machines = machineRows(session.machines)
  const providers = detail.data === undefined ? [] : providerRows(detail.data)
  return (
    <main className="px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Read-only remote Supervisor
          </p>
          <h1 className="mt-1 text-page font-semibold text-text-primary">
            Host {hostId.slice(-12)}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Exact Host identity verified over {session.transport} transport.
          </p>
        </div>
        <Badge variant="success">Online</Badge>
      </header>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1.2fr)]">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">Machines</h2>
          <div className="mt-3 space-y-2">
            {machines.map((machine) => (
              <button
                key={machine.machineId}
                className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-3 text-left hover:bg-surface-inset"
                type="button"
                onClick={() => setSelectedMachineId(machine.machineId)}
              >
                <Monitor aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {machine.displayName}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {machine.platform} · {machine.architecture}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold text-text-primary">
            Provider availability
          </h2>
          {selectedMachineId === undefined ? (
            <p className="mt-3 text-sm text-text-secondary">
              Select a Machine to read its current Provider state from the Host.
            </p>
          ) : detail.isPending ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-text-secondary">
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              Loading Machine state…
            </p>
          ) : detail.isError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              Machine state could not be read. Reconnect from My Hosts.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {providers.map((provider) => (
                <div
                  key={provider.provider}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-3"
                >
                  <span className="text-sm font-medium text-text-primary">
                    {provider.provider === 'codex' ? 'Codex' : 'Claude Code'}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {provider.availability}
                    {provider.version === undefined
                      ? ''
                      : ` · ${provider.version}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="mt-5 inline-flex items-center gap-2 text-xs text-text-muted">
        <Server aria-hidden="true" /> This surface exposes no Provider start,
        message, shell, filesystem, or approval actions.
      </p>
    </main>
  )
}

function machineRows(value: unknown): readonly {
  readonly machineId: string
  readonly displayName: string
  readonly platform: string
  readonly architecture: string
}[] {
  const record = asRecord(value)
  if (!Array.isArray(record.machines)) return []
  return record.machines.flatMap((candidate) => {
    const machine = asRecord(candidate)
    return typeof machine.machineId === 'string' &&
      typeof machine.displayName === 'string' &&
      typeof machine.platform === 'string' &&
      typeof machine.architecture === 'string'
      ? [
          {
            machineId: machine.machineId,
            displayName: machine.displayName,
            platform: machine.platform,
            architecture: machine.architecture,
          },
        ]
      : []
  })
}

function providerRows(value: unknown): readonly {
  readonly provider: string
  readonly availability: string
  readonly version?: string
}[] {
  const record = asRecord(value)
  if (!Array.isArray(record.providers)) return []
  return record.providers.flatMap((candidate) => {
    const provider = asRecord(candidate)
    return typeof provider.provider === 'string' &&
      typeof provider.availability === 'string'
      ? [
          {
            provider: provider.provider,
            availability: provider.availability,
            ...(typeof provider.version === 'string'
              ? { version: provider.version }
              : {}),
          },
        ]
      : []
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
