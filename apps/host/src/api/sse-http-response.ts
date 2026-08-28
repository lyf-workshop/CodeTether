import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { parseLastEventId } from '@codetether/protocol'

import { HostService } from './host-service.js'
import { HttpBoundaryError, singleHeader } from './http-boundary.js'
import {
  formatSseEvent,
  SseClientLimitError,
  SseConnection,
  SseConnectionPool,
  SseConnectionPoolClosedError,
} from './sse-connections.js'

interface ServeSseResponseOptions {
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly baseHeaders: Readonly<Record<string, string>>
  readonly service: HostService
  readonly connections: SseConnectionPool
}

export async function serveSseResponse(
  options: ServeSseResponseOptions,
): Promise<void> {
  const { request, response, baseHeaders, service, connections } = options
  const lastEventHeader = singleHeader(request.headers['last-event-id'])
  const cursor = parseLastEventId(lastEventHeader)
  if (lastEventHeader !== undefined && cursor === null) {
    throw new HttpBoundaryError(
      'invalid_request',
      'Last-Event-ID is invalid',
      400,
    )
  }

  const connection = connect(connections)
  const abort = new AbortController()
  const closeConnection = (): void => {
    abort.abort()
    connection.close()
  }
  request.once('aborted', closeConnection)
  response.once('close', closeConnection)
  const unsubscribeClose = connection.onClose(() => {
    if (!response.destroyed) response.destroy()
  })
  if (request.aborted || response.destroyed) closeConnection()

  try {
    if (abort.signal.aborted) return
    const replay =
      cursor === null ? undefined : service.publisher.replayAfter(cursor)
    const reset =
      replay?.kind === 'reset'
        ? service.createStreamReset(replay.reason)
        : undefined
    response.writeHead(200, {
      ...baseHeaders,
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders()

    await writeFrame(response, ': connected\n\n', abort.signal)
    if (reset !== undefined) {
      await writeFrame(response, formatSseEvent(reset), abort.signal)
      return
    }
    if (replay?.kind === 'replay') {
      for (const event of replay.events) {
        await writeFrame(response, formatSseEvent(event), abort.signal)
      }
      connection.discardEventsThrough(replay.currentSeq)
    }

    while (!abort.signal.aborted) {
      const frame = await connection.read(abort.signal)
      if (frame === undefined) return
      await writeFrame(response, frame, abort.signal)
    }
  } catch (error) {
    if (!abort.signal.aborted && !isAbortError(error)) throw error
  } finally {
    unsubscribeClose()
    request.off('aborted', closeConnection)
    response.off('close', closeConnection)
    connection.close()
    if (
      response.headersSent &&
      !response.destroyed &&
      !response.writableEnded
    ) {
      response.end()
    }
  }
}

function connect(connections: SseConnectionPool): SseConnection {
  try {
    return connections.connect(`sse_${randomUUID()}`)
  } catch (error) {
    if (
      error instanceof SseClientLimitError ||
      error instanceof SseConnectionPoolClosedError
    ) {
      throw new HttpBoundaryError(
        'runtime_unavailable',
        'SSE connection limit reached',
        503,
      )
    }
    throw error
  }
}

async function writeFrame(
  response: ServerResponse,
  frame: string,
  signal: AbortSignal,
): Promise<void> {
  if (!response.write(frame)) await waitForDrain(response, signal)
}

async function waitForDrain(
  response: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      response.off('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onClose = (): void => {
      cleanup()
      reject(abortError())
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onAbort = (): void => {
      cleanup()
      reject(abortError())
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    response.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('SSE connection closed')
  error.name = 'AbortError'
  return error
}
