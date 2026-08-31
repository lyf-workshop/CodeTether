import * as opaque from '@serenity-kit/opaque'

import { machineTransportLimits } from './constants.js'
import { MachineTransportError } from './errors.js'
import type { PairingAttemptId } from './ids.js'
import type { PairingCode } from './pairing-code.js'

const KEY_STRETCHING = 'memory-constrained' as const
const CLIENT_IDENTIFIER = 'codetether-controller-v1'

export interface PairingAuthorityMaterial {
  readonly attemptId: PairingAttemptId
  readonly expiresAt: Date
  readonly serverIdentifier: string
  readonly code: PairingCode
}

export class OpaquePairingAuthority {
  readonly #attemptId: PairingAttemptId
  readonly #expiresAt: Date
  readonly #deadline: number
  readonly #serverIdentifier: string
  readonly #serverSetup: string
  readonly #registrationRecord: string
  readonly #userIdentifier: string
  readonly #maximumAttempts: number
  readonly #monotonicNow: () => number
  #attempts = 0
  #consumed = false

  private constructor(options: {
    attemptId: PairingAttemptId
    expiresAt: Date
    deadline: number
    serverIdentifier: string
    serverSetup: string
    registrationRecord: string
    userIdentifier: string
    maximumAttempts: number
    monotonicNow: () => number
  }) {
    this.#attemptId = options.attemptId
    this.#expiresAt = options.expiresAt
    this.#deadline = options.deadline
    this.#serverIdentifier = options.serverIdentifier
    this.#serverSetup = options.serverSetup
    this.#registrationRecord = options.registrationRecord
    this.#userIdentifier = options.userIdentifier
    this.#maximumAttempts = options.maximumAttempts
    this.#monotonicNow = options.monotonicNow
  }

  static async create(
    options: PairingAuthorityMaterial & {
      readonly lifetimeMs?: number
      readonly maximumAttempts?: number
      readonly monotonicNow?: () => number
    },
  ): Promise<OpaquePairingAuthority> {
    await opaque.ready
    const monotonicNow =
      options.monotonicNow ?? performance.now.bind(performance)
    const lifetimeMs =
      options.lifetimeMs ?? machineTransportLimits.pairingLifetimeMs
    const maximumAttempts =
      options.maximumAttempts ?? machineTransportLimits.pairingMaximumAttempts
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
      throw new TypeError('Pairing lifetime must be a positive integer')
    }
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new TypeError('Pairing attempt bound must be a positive integer')
    }
    const serverSetup = opaque.server.createSetup()
    const userIdentifier = String(options.attemptId)
    const identifiers = identifiersFor(options.serverIdentifier)
    const registration = opaque.client.startRegistration({
      password: options.code,
    })
    const response = opaque.server.createRegistrationResponse({
      serverSetup,
      userIdentifier,
      registrationRequest: registration.registrationRequest,
    })
    const finished = opaque.client.finishRegistration({
      password: options.code,
      clientRegistrationState: registration.clientRegistrationState,
      registrationResponse: response.registrationResponse,
      identifiers,
      keyStretching: KEY_STRETCHING,
    })
    return new OpaquePairingAuthority({
      attemptId: options.attemptId,
      expiresAt: options.expiresAt,
      deadline: monotonicNow() + lifetimeMs,
      serverIdentifier: options.serverIdentifier,
      serverSetup,
      registrationRecord: finished.registrationRecord,
      userIdentifier,
      maximumAttempts,
      monotonicNow,
    })
  }

  get attemptId(): PairingAttemptId {
    return this.#attemptId
  }

  get expiresAt(): Date {
    return new Date(this.#expiresAt)
  }

  get remainingAttempts(): number {
    return Math.max(0, this.#maximumAttempts - this.#attempts)
  }

  get active(): boolean {
    return (
      !this.#consumed &&
      this.#attempts < this.#maximumAttempts &&
      this.#monotonicNow() < this.#deadline
    )
  }

  startLogin(request: string): OpaqueServerLogin {
    this.#requireActive()
    this.#attempts += 1
    try {
      const login = opaque.server.startLogin({
        serverSetup: this.#serverSetup,
        registrationRecord: this.#registrationRecord,
        startLoginRequest: request,
        userIdentifier: this.#userIdentifier,
        identifiers: identifiersFor(this.#serverIdentifier),
      })
      return new OpaqueServerLogin(
        login.serverLoginState,
        login.loginResponse,
        this.#serverIdentifier,
      )
    } catch (error) {
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing authentication failed',
        {
          cause: error,
        },
      )
    }
  }

  consume(): void {
    if (this.#consumed) {
      throw new MachineTransportError(
        'pairing_disabled',
        'Pairing mode is disabled',
      )
    }
    // A login admitted as the final allowed attempt may still complete. The
    // attempt ceiling prevents new logins; it must not invalidate that
    // already-authenticated in-flight exchange.
    if (this.#monotonicNow() >= this.#deadline) {
      throw new MachineTransportError('pairing_expired', 'Pairing code expired')
    }
    this.#consumed = true
  }

  cancel(): void {
    this.#consumed = true
  }

  #requireActive(): void {
    if (this.#consumed) {
      throw new MachineTransportError(
        'pairing_disabled',
        'Pairing mode is disabled',
      )
    }
    if (this.#monotonicNow() >= this.#deadline) {
      throw new MachineTransportError('pairing_expired', 'Pairing code expired')
    }
    if (this.#attempts >= this.#maximumAttempts) {
      throw new MachineTransportError(
        'pairing_rate_limited',
        'Pairing attempt limit was reached',
      )
    }
  }
}

export class OpaqueServerLogin {
  readonly response: string
  readonly #state: string
  readonly #serverIdentifier: string
  #finished = false

  constructor(state: string, response: string, serverIdentifier: string) {
    this.#state = state
    this.response = response
    this.#serverIdentifier = serverIdentifier
  }

  finish(request: string): Buffer {
    if (this.#finished) {
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing login was already used',
      )
    }
    this.#finished = true
    try {
      const result = opaque.server.finishLogin({
        serverLoginState: this.#state,
        finishLoginRequest: request,
        identifiers: identifiersFor(this.#serverIdentifier),
      })
      return decodeOpaqueSessionKey(result.sessionKey)
    } catch (error) {
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing authentication failed',
        {
          cause: error,
        },
      )
    }
  }
}

export class OpaquePairingInitiator {
  readonly request: string
  readonly #password: PairingCode
  readonly #state: string
  readonly #serverIdentifier: string
  #finished = false

  private constructor(
    password: PairingCode,
    state: string,
    request: string,
    serverIdentifier: string,
  ) {
    this.#password = password
    this.#state = state
    this.request = request
    this.#serverIdentifier = serverIdentifier
  }

  static async start(
    password: PairingCode,
    serverIdentifier: string,
  ): Promise<OpaquePairingInitiator> {
    await opaque.ready
    const login = opaque.client.startLogin({ password })
    return new OpaquePairingInitiator(
      password,
      login.clientLoginState,
      login.startLoginRequest,
      serverIdentifier,
    )
  }

  finish(response: string): {
    readonly request: string
    readonly sessionKey: Buffer
  } {
    if (this.#finished) {
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing login was already used',
      )
    }
    this.#finished = true
    try {
      const result = opaque.client.finishLogin({
        clientLoginState: this.#state,
        loginResponse: response,
        password: this.#password,
        identifiers: identifiersFor(this.#serverIdentifier),
        keyStretching: KEY_STRETCHING,
      })
      if (result === undefined) {
        throw new MachineTransportError(
          'pairing_failed',
          'Pairing code is invalid',
        )
      }
      return {
        request: result.finishLoginRequest,
        sessionKey: decodeOpaqueSessionKey(result.sessionKey),
      }
    } catch (error) {
      if (error instanceof MachineTransportError) throw error
      throw new MachineTransportError(
        'pairing_failed',
        'Pairing authentication failed',
        {
          cause: error,
        },
      )
    }
  }
}

export function pairingServerIdentifier(
  machineId: string,
  fingerprint: string,
): string {
  const value = `codetether-node-v1:${machineId}:${fingerprint}`
  if (value.length > 240)
    throw new RangeError('Pairing server identity is too long')
  return value
}

function identifiersFor(serverIdentifier: string): {
  readonly client: string
  readonly server: string
} {
  return { client: CLIENT_IDENTIFIER, server: serverIdentifier }
}

function decodeOpaqueSessionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{86}$/u.test(value)) {
    throw new Error('OPAQUE session key has an invalid encoding')
  }
  const key = Buffer.from(value, 'base64url')
  if (key.length !== 64)
    throw new Error('OPAQUE session key has an invalid length')
  return key
}
