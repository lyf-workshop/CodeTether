import { createServer, type Server } from 'node:http'
import type { ControlPlaneDatabase } from './persistence/database.js'

export interface ControlPlaneServerOptions {
  readonly database: ControlPlaneDatabase
  readonly host: string
  readonly port: number
}

export interface RunningControlPlaneServer {
  readonly server: Server
  readonly address: { readonly host: string; readonly port: number }
  close(): Promise<void>
}

function sendJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  body: Record<string, string>,
  headOnly: boolean,
): void {
  const encoded = Buffer.from(JSON.stringify(body))
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': headOnly ? '0' : String(encoded.byteLength),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(headOnly ? undefined : encoded)
}

export async function startControlPlaneServer(
  options: ControlPlaneServerOptions,
): Promise<RunningControlPlaneServer> {
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const headOnly = method === 'HEAD'
    if (method !== 'GET' && !headOnly) {
      sendJson(response, 405, { status: 'method_not_allowed' }, false)
      return
    }

    const pathname = new URL(request.url ?? '/', 'http://control-plane.local')
      .pathname
    if (pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok' }, headOnly)
      return
    }

    if (pathname === '/readyz') {
      try {
        await options.database.query('SELECT 1 AS ready')
        sendJson(response, 200, { status: 'ready' }, headOnly)
      } catch {
        sendJson(response, 503, { status: 'unavailable' }, headOnly)
      }
      return
    }

    sendJson(response, 404, { status: 'not_found' }, headOnly)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(options.port, options.host)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Control Plane did not bind a TCP address')
  }

  return {
    server,
    address: { host: options.host, port: address.port },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
