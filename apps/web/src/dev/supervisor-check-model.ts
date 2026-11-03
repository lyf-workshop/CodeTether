export const supervisorCheckOperations = [
  'host.bootstrap',
  'machine.list',
  'machine.get',
  'project.list',
  'conversation.list',
  'conversation.get',
  'conversation.history',
] as const

export type CheckError =
  | 'authentication_required'
  | 'identity_unavailable'
  | 'authorization_unavailable'
  | 'presence_unavailable'
  | 'invalid_response'
  | 'unexpected_transport'
  | 'session_expired'
  | 'request_failed'
  | 'cancelled'
  | 'no_machine'
  | 'no_project'
  | 'no_conversation'
  | 'previous_step_failed'
  | 'cleanup_failed'

export class SupervisorCheckError extends Error {
  constructor(readonly category: CheckError) {
    super(category)
    this.name = 'SupervisorCheckError'
  }
}

export interface CheckMeasurement {
  readonly status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  readonly transport: 'direct' | 'relay' | null
  readonly elapsedMs: number | null
  readonly error: CheckError | null
}

export interface SupervisorCheckResult {
  readonly connection: CheckMeasurement
  readonly steps: readonly CheckMeasurement[]
  readonly cleanup: CheckMeasurement
}

export interface SupervisorReadConnection {
  readonly transport: 'direct' | 'relay'
  bootstrap(signal: AbortSignal): Promise<void>
  machines(signal: AbortSignal): Promise<readonly string[]>
  machine(machineId: string, signal: AbortSignal): Promise<void>
  projects(machineId: string, signal: AbortSignal): Promise<readonly string[]>
  conversations(
    machineId: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<readonly string[]>
  conversation(
    machineId: string,
    projectId: string,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<void>
  history(
    machineId: string,
    projectId: string,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<void>
  close(): Promise<void>
}

export function checkErrorCategory(error: unknown): CheckError {
  if (error instanceof SupervisorCheckError) return error.category
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  if (
    error instanceof Error &&
    error.message === 'remote_supervisor_cleanup_failed'
  )
    return 'cleanup_failed'
  if (error instanceof Error) {
    const known: Readonly<Record<string, CheckError>> = {
      remote_supervisor_401: 'authentication_required',
      remote_supervisor_403: 'authorization_unavailable',
      remote_supervisor_presence_unavailable: 'presence_unavailable',
      remote_supervisor_session_expired: 'session_expired',
      remote_supervisor_response_invalid: 'invalid_response',
      'Supervisor response is invalid': 'invalid_response',
    }
    if (Object.hasOwn(known, error.message)) return known[error.message]!
  }
  // Raw server errors, stack traces and response bodies never become UI state.
  return 'request_failed'
}

export function initialSupervisorCheckResult(): SupervisorCheckResult {
  const pending: CheckMeasurement = {
    status: 'pending',
    transport: null,
    elapsedMs: null,
    error: null,
  }
  return {
    connection: pending,
    steps: supervisorCheckOperations.map(() => pending),
    cleanup: pending,
  }
}

export async function runSupervisorCheck(options: {
  readonly connect: (
    forceRelay: boolean,
    signal: AbortSignal,
  ) => Promise<SupervisorReadConnection>
  readonly forceRelay: boolean
  readonly signal: AbortSignal
  readonly onProgress?: (result: SupervisorCheckResult) => void
  readonly now?: () => number
}): Promise<SupervisorCheckResult> {
  const now = options.now ?? (() => performance.now())
  let result = initialSupervisorCheckResult()
  let connection: SupervisorReadConnection | undefined
  let blocked: CheckError | undefined
  let machineId: string | undefined
  let projectId: string | undefined
  let conversationId: string | undefined
  const publish = () => options.onProgress?.(result)
  const duration = (started: number) => Math.max(0, Math.round(now() - started))
  const measure = (
    status: CheckMeasurement['status'],
    error: CheckError | null,
    elapsedMs: number | null,
  ): CheckMeasurement => ({
    status,
    error,
    elapsedMs,
    transport: connection?.transport ?? null,
  })
  const setStep = (index: number, value: CheckMeasurement) => {
    result = {
      ...result,
      steps: result.steps.map((step, current) =>
        current === index ? value : step,
      ),
    }
    publish()
  }
  const started = now()
  result = { ...result, connection: measure('running', null, null) }
  publish()
  try {
    options.signal.throwIfAborted()
    connection = await options.connect(options.forceRelay, options.signal)
    options.signal.throwIfAborted()
    if (options.forceRelay && connection.transport !== 'relay') {
      throw new SupervisorCheckError('unexpected_transport')
    }
    result = {
      ...result,
      connection: measure('success', null, duration(started)),
    }
    publish()

    for (let index = 0; index < supervisorCheckOperations.length; index += 1) {
      const missing =
        index >= 2 && machineId === undefined
          ? 'no_machine'
          : index >= 4 && projectId === undefined
            ? 'no_project'
            : index >= 5 && conversationId === undefined
              ? 'no_conversation'
              : undefined
      if (
        options.signal.aborted ||
        blocked !== undefined ||
        missing !== undefined
      ) {
        setStep(
          index,
          measure(
            'skipped',
            options.signal.aborted ? 'cancelled' : (blocked ?? missing!),
            null,
          ),
        )
        continue
      }
      const stepStarted = now()
      setStep(index, measure('running', null, null))
      try {
        switch (index) {
          case 0:
            await connection.bootstrap(options.signal)
            break
          case 1:
            machineId = (await connection.machines(options.signal))[0]
            break
          case 2:
            await connection.machine(machineId!, options.signal)
            break
          case 3:
            projectId = (
              await connection.projects(machineId!, options.signal)
            )[0]
            break
          case 4:
            conversationId = (
              await connection.conversations(
                machineId!,
                projectId!,
                options.signal,
              )
            )[0]
            break
          case 5:
            await connection.conversation(
              machineId!,
              projectId!,
              conversationId!,
              options.signal,
            )
            break
          case 6:
            await connection.history(
              machineId!,
              projectId!,
              conversationId!,
              options.signal,
            )
            break
        }
        options.signal.throwIfAborted()
        setStep(index, measure('success', null, duration(stepStarted)))
      } catch (error) {
        const category = checkErrorCategory(error)
        setStep(index, measure('failed', category, duration(stepStarted)))
        blocked =
          category === 'cancelled' ? 'cancelled' : 'previous_step_failed'
      }
    }
  } catch (error) {
    const category = checkErrorCategory(error)
    result = {
      ...result,
      connection: measure('failed', category, duration(started)),
      steps: result.steps.map(() =>
        measure(
          'skipped',
          category === 'cancelled' ? 'cancelled' : 'previous_step_failed',
          null,
        ),
      ),
      ...(category === 'cleanup_failed'
        ? { cleanup: measure('failed', category, null) }
        : {}),
    }
    publish()
  } finally {
    if (connection !== undefined) {
      const cleanupStarted = now()
      try {
        await connection.close()
        result = {
          ...result,
          cleanup: measure('success', null, duration(cleanupStarted)),
        }
      } catch (error) {
        result = {
          ...result,
          cleanup: measure(
            'failed',
            checkErrorCategory(error),
            duration(cleanupStarted),
          ),
        }
      }
    } else if (result.cleanup.status === 'pending') {
      result = { ...result, cleanup: measure('skipped', null, null) }
    }
    publish()
  }
  return result
}
