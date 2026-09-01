import { EventEmitter } from 'node:events'
import { createServer, type Server, type TLSSocket } from 'node:tls'

import {
  ClaudeSessionDisposeMessageSchema,
  ClaudeSessionOpenMessageSchema,
  ClaudeTurnStartMessageSchema,
  CodexSessionDisposeMessageSchema,
  CodexSessionOpenMessageSchema,
  CodexTurnStartMessageSchema,
  FramedMachineConnection,
  MachineErrorMessageSchema,
  MachineHelloMessageSchema,
  MachinePingMessageSchema,
  MachineTransportError,
  PairingCancelMessageSchema,
  PairingConfirmMessageSchema,
  PairingOpenMessageSchema,
  PairingLoginFinishMessageSchema,
  PairingLoginStartMessageSchema,
  ProjectLocationValidateMessageSchema,
  ProvidersDescribeMessageSchema,
  TrustRevokeMessageSchema,
  exportMachineTlsBinding,
  machineProtocolVersion,
  machineTlsServerOptions,
  machineTransportAlpn,
  machineTransportLimits,
  newMachineNonce,
  pairingConfirmationTag,
  pairingVerificationCode,
  peerFingerprint,
  verifyPairingConfirmationTag,
  type MachineWireErrorCode,
  type ClaudeSessionDisposeMessage,
  type ClaudeTurnStartMessage,
  type CodexSessionDisposeMessage,
  type CodexTurnStartMessage,
  type PairingTranscript,
  type PublicKeyFingerprint,
  type RemoteMachineMetadata,
} from '@codetether/machine-transport'
import { z } from 'zod'

import { PairingMode, type PairingModeView } from './pairing-mode.js'
import { validateProjectLocationPath } from './project-location-validation.js'
import { RemoteProviderDetector } from './provider-discovery.js'
import {
  RemoteClaudeRunnerPool,
  type RemoteClaudeRunner,
  type RemoteClaudeRunnerTurn,
} from './remote-claude-runner.js'
import {
  RemoteCodexRunnerPool,
  type RemoteCodexRunner,
  type RemoteCodexRunnerTurn,
} from './remote-codex-runner.js'
import { NodeStateStore, type TrustedController } from './state-store.js'

const AuthenticatedRequestSchema = z.discriminatedUnion('type', [
  MachinePingMessageSchema,
  ProjectLocationValidateMessageSchema,
  ProvidersDescribeMessageSchema,
  CodexSessionOpenMessageSchema,
  ClaudeSessionOpenMessageSchema,
  TrustRevokeMessageSchema,
])
const RemoteCodexSessionRequestSchema = z.discriminatedUnion('type', [
  CodexTurnStartMessageSchema,
  CodexSessionDisposeMessageSchema,
])
const RemoteClaudeSessionRequestSchema = z.discriminatedUnion('type', [
  ClaudeTurnStartMessageSchema,
  ClaudeSessionDisposeMessageSchema,
])
const PairingDecisionSchema = z.discriminatedUnion('type', [
  PairingConfirmMessageSchema,
  PairingCancelMessageSchema,
])

export interface CodeTetherNodeOptions {
  readonly state: NodeStateStore
  readonly bindAddress: string
  readonly port: number
  readonly authenticatedIdleTimeoutMs?: number
  readonly providerDetector?: RemoteProviderDetector
  /** Internal test seam; remote callers cannot configure Provider execution. */
  readonly remoteCodexRunners?: RemoteCodexRunnerPool
  /** Internal test seam; remote callers cannot configure Provider execution. */
  readonly remoteClaudeRunners?: RemoteClaudeRunnerPool
}

export interface ListeningNodeAddress {
  readonly address: string
  readonly port: number
}

export class CodeTetherNodeService extends EventEmitter {
  readonly state: NodeStateStore
  readonly pairing: PairingMode
  readonly #bindAddress: string
  readonly #requestedPort: number
  readonly #authenticatedIdleTimeoutMs: number
  readonly #connections = new Set<TLSSocket>()
  readonly #connectionsByAddress = new Map<string, number>()
  readonly #authenticatedConnections = new Map<string, Set<TLSSocket>>()
  readonly #providerDetector: RemoteProviderDetector
  readonly #remoteCodexRunners: RemoteCodexRunnerPool
  readonly #remoteClaudeRunners: RemoteClaudeRunnerPool
  #server: Server | undefined
  #closing = false
  #closePromise: Promise<void> | undefined

  constructor(options: CodeTetherNodeOptions) {
    super()
    this.state = options.state
    this.#bindAddress = options.bindAddress
    this.#requestedPort = options.port
    this.#authenticatedIdleTimeoutMs =
      options.authenticatedIdleTimeoutMs ??
      machineTransportLimits.heartbeatIntervalMs +
        2 * machineTransportLimits.heartbeatTimeoutMs
    if (
      !Number.isSafeInteger(this.#authenticatedIdleTimeoutMs) ||
      this.#authenticatedIdleTimeoutMs <= 0
    ) {
      throw new TypeError(
        'Authenticated idle timeout must be a positive integer',
      )
    }
    this.#providerDetector =
      options.providerDetector ?? new RemoteProviderDetector()
    this.#remoteCodexRunners =
      options.remoteCodexRunners ?? new RemoteCodexRunnerPool()
    this.#remoteClaudeRunners =
      options.remoteClaudeRunners ?? new RemoteClaudeRunnerPool()
    this.pairing = new PairingMode(
      options.state.machine,
      options.state.identity.publicKeyFingerprint,
    )
  }

  async listen(): Promise<ListeningNodeAddress> {
    if (this.#server !== undefined)
      throw new Error('CodeTether Node is already listening')
    const server = createServer(
      machineTlsServerOptions(this.state.identity),
      (socket) => this.#accept(socket),
    )
    this.#server = server
    server.maxConnections = machineTransportLimits.maximumConnections
    server.on('tlsClientError', () => undefined)
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({
        host: this.#bindAddress,
        port: this.#requestedPort,
        backlog: machineTransportLimits.maximumConnections,
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('CodeTether Node did not receive a network address')
    }
    return { address: address.address, port: address.port }
  }

  async enablePairing(): Promise<PairingModeView> {
    if (this.state.trustedControllerCount !== 0) {
      throw new MachineTransportError(
        'pairing_disabled',
        'CodeTether Node is already paired; revoke trust before pairing again',
      )
    }
    return await this.pairing.enable()
  }

  cancelPairing(): void {
    this.pairing.cancel()
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#closeOwnedResources()
    await this.#closePromise
  }

  async #closeOwnedResources(): Promise<void> {
    this.#closing = true
    this.pairing.cancel()
    for (const socket of this.#connections) socket.destroy()
    const failures: unknown[] = []
    const attempt = async (operation: () => Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }
    const server = this.#server
    this.#server = undefined
    if (server !== undefined) {
      await attempt(async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          )
        }).catch((error: unknown) => {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ERR_SERVER_NOT_RUNNING'
          )) {
            throw error
          }
        })
      })
    }
    await attempt(async () => await this.#providerDetector.close())
    await attempt(async () => await this.#remoteCodexRunners.close())
    await attempt(async () => await this.#remoteClaudeRunners.close())
    await attempt(async () => await this.state.close())
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'CodeTether Node owned resource cleanup did not complete',
      )
    }
  }

  #accept(socket: TLSSocket): void {
    if (this.#closing || socket.alpnProtocol !== machineTransportAlpn) {
      socket.destroy()
      return
    }
    const remoteAddress = normalizedRemoteAddress(socket.remoteAddress)
    const addressCount = this.#connectionsByAddress.get(remoteAddress) ?? 0
    if (
      this.#connections.size >= machineTransportLimits.maximumConnections ||
      addressCount >= machineTransportLimits.maximumConnectionsPerAddress
    ) {
      const connection = new FramedMachineConnection(socket)
      void connection
        .send(machineError('busy'))
        .then(() => connection.end())
        .catch(() => connection.destroy())
      return
    }
    this.#connections.add(socket)
    this.#connectionsByAddress.set(remoteAddress, addressCount + 1)
    socket.once('close', () => {
      this.#connections.delete(socket)
      const remaining = (this.#connectionsByAddress.get(remoteAddress) ?? 1) - 1
      if (remaining <= 0) this.#connectionsByAddress.delete(remoteAddress)
      else this.#connectionsByAddress.set(remoteAddress, remaining)
    })
    void this.#route(socket).catch(() => socket.destroy())
  }

  async #route(socket: TLSSocket): Promise<void> {
    const connection = new FramedMachineConnection(socket)
    let fingerprint: PublicKeyFingerprint
    try {
      fingerprint = peerFingerprint(socket)
    } catch {
      socket.destroy()
      return
    }
    const trusted = this.state.controllerByFingerprint(fingerprint)
    if (trusted !== undefined) {
      await this.#serveTrusted(connection, socket, trusted)
      return
    }
    const opening = await receiveStrict(
      connection,
      z.union([PairingOpenMessageSchema, MachineHelloMessageSchema]),
    )
    if (opening.type === 'machine.hello') {
      await connection.send(machineError('authentication_failed'))
      connection.end()
      return
    }
    if (opening.controllerFingerprint !== fingerprint) {
      await connection.send(machineError('identity_mismatch'))
      connection.end()
      return
    }
    const pairing = this.pairing.claim()
    if (pairing === undefined) {
      await connection.send(machineError(this.pairing.rejectionCode))
      connection.end()
      return
    }
    try {
      await this.#servePairing(connection, socket, fingerprint, pairing)
    } finally {
      this.pairing.release()
    }
  }

  async #servePairing(
    connection: FramedMachineConnection,
    socket: TLSSocket,
    controllerFingerprint: PublicKeyFingerprint,
    pairing: PairingModeView,
  ): Promise<void> {
    let sessionKey: Buffer | undefined
    try {
      const nodeNonce = newMachineNonce()
      await connection.send({
        type: 'pair.offer',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        expiresAt: pairing.authority.expiresAt.toISOString(),
        machine: this.state.machine,
        nodeFingerprint: this.state.identity.publicKeyFingerprint,
        nodeNonce,
      })
      const start = await receiveStrict(
        connection,
        PairingLoginStartMessageSchema,
      )
      if (
        start.attemptId !== pairing.authority.attemptId ||
        start.controllerFingerprint !== controllerFingerprint
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing controller identity did not match its TLS identity',
        )
      }
      const login = pairing.authority.startLogin(start.request)
      await connection.send({
        type: 'pair.login.response',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        response: login.response,
      })
      const finish = await receiveStrict(
        connection,
        PairingLoginFinishMessageSchema,
      )
      if (finish.attemptId !== pairing.authority.attemptId) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing attempt identity changed',
        )
      }
      sessionKey = login.finish(finish.request)
      const transcript: PairingTranscript = {
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        machine: this.state.machine,
        controllerId: start.controllerId,
        nodeFingerprint: this.state.identity.publicKeyFingerprint,
        controllerFingerprint,
        nodeNonce,
        controllerNonce: start.controllerNonce,
        tlsExporter: exportMachineTlsBinding(socket),
      }
      this.emit('pairingVerification', {
        machineId: this.state.machine.machineId,
        verificationCode: pairingVerificationCode(sessionKey, transcript),
      })
      const decision = await receiveStrict(connection, PairingDecisionSchema, {
        timeoutMs: machineTransportLimits.pairingConfirmationTimeoutMs,
      })
      if (decision.attemptId !== pairing.authority.attemptId) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Pairing attempt identity changed',
        )
      }
      if (decision.type === 'pair.cancel') {
        verifyPairingConfirmationTag(
          sessionKey,
          'controller-cancel',
          transcript,
          decision.tag,
        )
        this.pairing.cancel()
        await connection.send({
          type: 'pair.cancelled',
          protocolVersion: machineProtocolVersion,
          attemptId: pairing.authority.attemptId,
          tag: pairingConfirmationTag(sessionKey, 'node-cancelled', transcript),
        })
        connection.end()
        return
      }
      verifyPairingConfirmationTag(
        sessionKey,
        'controller-confirm',
        transcript,
        decision.tag,
      )
      // Distributed commit ordering: durable Node trust precedes the signed ack.
      await this.state.trustController({
        controllerId: start.controllerId,
        publicKeyFingerprint: controllerFingerprint,
        pairedAt: new Date().toISOString(),
      })
      this.pairing.consume()
      await connection.send({
        type: 'pair.ack',
        protocolVersion: machineProtocolVersion,
        attemptId: pairing.authority.attemptId,
        tag: pairingConfirmationTag(sessionKey, 'node-ack', transcript),
      })
      this.emit('paired', { machineId: this.state.machine.machineId })
      connection.end()
    } catch (error) {
      await sendSafeError(connection, error)
      connection.destroy()
    } finally {
      sessionKey?.fill(0)
    }
  }

  async #serveTrusted(
    connection: FramedMachineConnection,
    socket: TLSSocket,
    trusted: TrustedController,
  ): Promise<void> {
    let tracked = false
    try {
      const hello = await receiveStrict(connection, MachineHelloMessageSchema)
      if (
        hello.controllerId !== trusted.controllerId ||
        hello.expectedMachineId !== this.state.machine.machineId
      ) {
        throw new MachineTransportError(
          'identity_mismatch',
          'Authenticated Machine identity did not match durable trust',
        )
      }
      await connection.send({
        type: 'machine.status',
        protocolVersion: machineProtocolVersion,
        machine: this.state.machine,
        nonce: hello.nonce,
        observedAt: new Date().toISOString(),
      })
      this.#trackAuthenticatedConnection(trusted.controllerId, socket)
      tracked = true
      while (!connection.closed && !this.#closing) {
        const request = await receiveStrict(
          connection,
          AuthenticatedRequestSchema,
          {
            timeoutMs: this.#authenticatedIdleTimeoutMs,
          },
        )
        if (request.type === 'machine.ping') {
          await connection.send({
            type: 'machine.pong',
            protocolVersion: machineProtocolVersion,
            nonce: request.nonce,
          })
          continue
        }
        if (request.type === 'project_location.validate') {
          if (
            request.expectedMachineId !== this.state.machine.machineId ||
            request.expectedNodeId !== this.state.machine.nodeId
          ) {
            throw new MachineTransportError(
              'identity_mismatch',
              'Project Location request did not match durable Node identity',
            )
          }
          try {
            const validated = await validateProjectLocationPath(
              request.rootPath,
            )
            await connection.send({
              type: 'project_location.validated',
              protocolVersion: machineProtocolVersion,
              requestId: request.requestId,
              machineId: this.state.machine.machineId,
              nodeId: this.state.machine.nodeId,
              ...validated,
            })
          } catch (error) {
            if (!isProjectLocationValidationError(error)) throw error
            await sendSafeError(connection, error)
          }
          continue
        }
        if (request.type === 'providers.describe') {
          if (
            request.expectedMachineId !== this.state.machine.machineId ||
            request.expectedNodeId !== this.state.machine.nodeId
          ) {
            throw new MachineTransportError(
              'identity_mismatch',
              'Provider discovery request did not match durable Node identity',
            )
          }
          const discovery = await this.#providerDetector.discover()
          await connection.send({
            type: 'providers.described',
            protocolVersion: machineProtocolVersion,
            requestId: request.requestId,
            machineId: this.state.machine.machineId,
            nodeId: this.state.machine.nodeId,
            ...discovery,
          })
          continue
        }
        if (request.type === 'codex.session.open') {
          if (
            request.expectedMachineId !== this.state.machine.machineId ||
            request.expectedNodeId !== this.state.machine.nodeId
          ) {
            throw new MachineTransportError(
              'identity_mismatch',
              'Remote Codex request did not match durable Node identity',
            )
          }
          const discovery = await this.#providerDetector.discover()
          assertRemoteCodexExecutionAdmission(discovery)
          await this.#serveRemoteCodexSession(connection, request)
          return
        }
        if (request.type === 'claude.session.open') {
          if (
            request.expectedMachineId !== this.state.machine.machineId ||
            request.expectedNodeId !== this.state.machine.nodeId
          ) {
            throw new MachineTransportError(
              'identity_mismatch',
              'Remote Claude request did not match durable Node identity',
            )
          }
          const discovery = await this.#providerDetector.discover()
          assertRemoteClaudeExecutionAdmission(discovery)
          await this.#serveRemoteClaudeSession(connection, request)
          return
        }
        if (request.controllerId !== trusted.controllerId) {
          throw new MachineTransportError(
            'identity_mismatch',
            'Trust identity changed',
          )
        }
        await this.state.revokeController(trusted.controllerId)
        this.#closeAuthenticatedConnections(trusted.controllerId, socket)
        await connection.send({
          type: 'trust.revoked',
          protocolVersion: machineProtocolVersion,
          controllerId: trusted.controllerId,
          nonce: request.nonce,
        })
        connection.end()
        this.emit('unpaired', { machineId: this.state.machine.machineId })
        return
      }
    } catch (error) {
      if (!connection.closed) await sendSafeError(connection, error)
      connection.destroy()
    } finally {
      if (tracked) {
        this.#untrackAuthenticatedConnection(trusted.controllerId, socket)
      }
    }
  }

  async #serveRemoteCodexSession(
    connection: FramedMachineConnection,
    request: z.infer<typeof CodexSessionOpenMessageSchema>,
  ): Promise<void> {
    let runner: RemoteCodexRunner | undefined
    let released = false
    try {
      runner = await this.#remoteCodexRunners.open(request)
      await connection.send({
        type: 'codex.session.ready',
        protocolVersion: machineProtocolVersion,
        requestId: request.requestId,
        machineId: this.state.machine.machineId,
        nodeId: this.state.machine.nodeId,
        conversationId: request.conversationId,
        providerThreadId: runner.providerThreadId,
        resumed: runner.resumed,
        executionProfile: 'codex-text-v1',
      })

      while (!connection.closed && !this.#closing) {
        const control = await receiveStrict(
          connection,
          RemoteCodexSessionRequestSchema,
          { timeoutMs: machineTransportLimits.remoteCodexSessionIdleTimeoutMs },
        )
        assertRemoteCodexSessionControl(control, runner)
        if (control.type === 'codex.session.dispose') {
          await this.#remoteCodexRunners.release(runner)
          released = true
          await sendRemoteCodexDisposed(connection, this.state.machine, control)
          connection.end()
          return
        }
        const turn = await runner.startTurn(control)
        await sendRemoteCodexTurnStarted(
          connection,
          this.state.machine,
          runner,
          turn,
        )
        const disposal = await this.#streamRemoteCodexTurn(
          connection,
          runner,
          turn,
        )
        if (disposal !== undefined) {
          await this.#remoteCodexRunners.release(runner)
          released = true
          await sendRemoteCodexDisposed(
            connection,
            this.state.machine,
            disposal,
          )
          connection.end()
          return
        }
      }
    } finally {
      if (runner !== undefined && !released) {
        await this.#remoteCodexRunners.release(runner)
      }
    }
  }

  async #streamRemoteCodexTurn(
    connection: FramedMachineConnection,
    runner: RemoteCodexRunner,
    turn: RemoteCodexRunnerTurn,
  ): Promise<CodexSessionDisposeMessage | undefined> {
    const events = turn.events()[Symbol.asyncIterator]()
    const controlAbort = new AbortController()
    let sequence = 1
    let event = events
      .next()
      .then((result) => ({ kind: 'event' as const, result }))
    let control = receiveStrict(connection, RemoteCodexSessionRequestSchema, {
      timeoutMs: machineTransportLimits.remoteCodexTurnTimeoutMs,
      signal: controlAbort.signal,
    })
    try {
      while (true) {
        const next = await Promise.race([
          event,
          control.then((value) => ({ kind: 'control' as const, value })),
        ])
        if (next.kind === 'control') {
          assertRemoteCodexSessionControl(next.value, runner)
          if (next.value.type === 'codex.session.dispose') return next.value
          const duplicate = await runner.startTurn(next.value)
          if (duplicate !== turn) {
            throw new MachineTransportError(
              'conversation_busy',
              'Remote Codex Conversation already has another active Turn',
            )
          }
          await sendRemoteCodexTurnStarted(
            connection,
            this.state.machine,
            runner,
            turn,
          )
          control = receiveStrict(connection, RemoteCodexSessionRequestSchema, {
            timeoutMs: machineTransportLimits.remoteCodexTurnTimeoutMs,
            signal: controlAbort.signal,
          })
          continue
        }
        if (next.result.done) {
          throw new MachineTransportError(
            'remote_execution_lost',
            'Remote Codex event stream ended before a terminal event',
          )
        }
        await connection.send({
          type: 'codex.turn.event',
          protocolVersion: machineProtocolVersion,
          machineId: this.state.machine.machineId,
          nodeId: this.state.machine.nodeId,
          actionId: turn.actionId,
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          providerThreadId: runner.providerThreadId,
          providerTurnId: turn.providerTurnId,
          sequence,
          event: next.result.value,
        })
        sequence += 1
        if (
          next.result.value.type === 'turn.completed' ||
          next.result.value.type === 'turn.failed'
        ) {
          return undefined
        }
        event = events
          .next()
          .then((result) => ({ kind: 'event' as const, result }))
      }
    } finally {
      controlAbort.abort()
      await control.catch(() => undefined)
    }
  }

  async #serveRemoteClaudeSession(
    connection: FramedMachineConnection,
    request: z.infer<typeof ClaudeSessionOpenMessageSchema>,
  ): Promise<void> {
    let runner: RemoteClaudeRunner | undefined
    let released = false
    try {
      runner = await this.#remoteClaudeRunners.open(request)
      await connection.send({
        type: 'claude.session.ready',
        protocolVersion: machineProtocolVersion,
        requestId: request.requestId,
        machineId: this.state.machine.machineId,
        nodeId: this.state.machine.nodeId,
        conversationId: request.conversationId,
        providerSessionId: runner.providerSessionId,
        resumed: runner.resumed,
        ...(runner.effort === undefined ? {} : { effort: runner.effort }),
        executionProfile: 'claude-restricted-read-search-v1',
      })

      while (!connection.closed && !this.#closing) {
        const control = await receiveStrict(
          connection,
          RemoteClaudeSessionRequestSchema,
          {
            timeoutMs: machineTransportLimits.remoteClaudeSessionIdleTimeoutMs,
          },
        )
        assertRemoteClaudeSessionControl(control, runner)
        if (control.type === 'claude.session.dispose') {
          await this.#remoteClaudeRunners.release(runner)
          released = true
          await sendRemoteClaudeDisposed(
            connection,
            this.state.machine,
            control,
          )
          connection.end()
          return
        }
        const turn = await runner.startTurn(control)
        await sendRemoteClaudeTurnStarted(
          connection,
          this.state.machine,
          runner,
          turn,
        )
        const disposal = await this.#streamRemoteClaudeTurn(
          connection,
          runner,
          turn,
        )
        if (disposal !== undefined) {
          await this.#remoteClaudeRunners.release(runner)
          released = true
          await sendRemoteClaudeDisposed(
            connection,
            this.state.machine,
            disposal,
          )
          connection.end()
          return
        }
      }
    } finally {
      if (runner !== undefined && !released) {
        await this.#remoteClaudeRunners.release(runner)
      }
    }
  }

  async #streamRemoteClaudeTurn(
    connection: FramedMachineConnection,
    runner: RemoteClaudeRunner,
    turn: RemoteClaudeRunnerTurn,
  ): Promise<ClaudeSessionDisposeMessage | undefined> {
    const events = turn.events()[Symbol.asyncIterator]()
    const controlAbort = new AbortController()
    let sequence = 1
    let event = events
      .next()
      .then((result) => ({ kind: 'event' as const, result }))
    let control = receiveStrict(connection, RemoteClaudeSessionRequestSchema, {
      timeoutMs: machineTransportLimits.remoteClaudeTurnTimeoutMs,
      signal: controlAbort.signal,
    })
    try {
      while (true) {
        const next = await Promise.race([
          event,
          control.then((value) => ({ kind: 'control' as const, value })),
        ])
        if (next.kind === 'control') {
          assertRemoteClaudeSessionControl(next.value, runner)
          if (next.value.type === 'claude.session.dispose') return next.value
          const duplicate = await runner.startTurn(next.value)
          if (duplicate !== turn) {
            throw new MachineTransportError(
              'conversation_busy',
              'Remote Claude Conversation already has another active Turn',
            )
          }
          await sendRemoteClaudeTurnStarted(
            connection,
            this.state.machine,
            runner,
            turn,
          )
          control = receiveStrict(
            connection,
            RemoteClaudeSessionRequestSchema,
            {
              timeoutMs: machineTransportLimits.remoteClaudeTurnTimeoutMs,
              signal: controlAbort.signal,
            },
          )
          continue
        }
        if (next.result.done) {
          throw new MachineTransportError(
            'remote_execution_lost',
            'Remote Claude event stream ended before a terminal event',
          )
        }
        await connection.send({
          type: 'claude.turn.event',
          protocolVersion: machineProtocolVersion,
          machineId: this.state.machine.machineId,
          nodeId: this.state.machine.nodeId,
          actionId: turn.actionId,
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          providerSessionId: runner.providerSessionId,
          providerTurnId: turn.providerTurnId,
          sequence,
          event: next.result.value,
        })
        sequence += 1
        if (
          next.result.value.type === 'turn.completed' ||
          next.result.value.type === 'turn.failed'
        ) {
          return undefined
        }
        event = events
          .next()
          .then((result) => ({ kind: 'event' as const, result }))
      }
    } finally {
      controlAbort.abort()
      await control.catch(() => undefined)
    }
  }

  #trackAuthenticatedConnection(controllerId: string, socket: TLSSocket) {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) {
      this.#authenticatedConnections.set(controllerId, new Set([socket]))
    } else {
      current.add(socket)
    }
  }

  #untrackAuthenticatedConnection(controllerId: string, socket: TLSSocket) {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) return
    current.delete(socket)
    if (current.size === 0) this.#authenticatedConnections.delete(controllerId)
  }

  #closeAuthenticatedConnections(
    controllerId: string,
    except: TLSSocket,
  ): void {
    const current = this.#authenticatedConnections.get(controllerId)
    if (current === undefined) return
    for (const socket of current) {
      if (socket !== except) socket.destroy()
    }
  }
}

function assertRemoteCodexExecutionAdmission(
  discovery: Awaited<ReturnType<RemoteProviderDetector['discover']>>,
): void {
  const codex = discovery.providers.find(({ provider }) => provider === 'codex')
  if (
    codex?.availability !== 'available' ||
    codex.capabilities.streaming !== true ||
    codex.capabilities.resume !== true
  ) {
    throw new MachineTransportError(
      'remote_execution_unavailable',
      'Remote Codex execution is unavailable',
    )
  }
}

function assertRemoteClaudeExecutionAdmission(
  discovery: Awaited<ReturnType<RemoteProviderDetector['discover']>>,
): void {
  const claude = discovery.providers.find(
    ({ provider }) => provider === 'claude-code',
  )
  if (
    claude?.availability !== 'available' ||
    claude.capabilities.streaming !== true ||
    claude.capabilities.resume !== true ||
    claude.capabilities.fileRead !== true ||
    claude.capabilities.search !== true ||
    claude.capabilities.toolEvents !== true ||
    claude.capabilities.reasoningControl !== true ||
    claude.capabilities.interrupt ||
    claude.capabilities.approvals ||
    claude.capabilities.fileEdit ||
    claude.capabilities.shell ||
    claude.capabilities.diff ||
    claude.capabilities.modelSelection
  ) {
    throw new MachineTransportError(
      'remote_execution_unavailable',
      'Remote Claude execution is unavailable',
    )
  }
}

async function receiveStrict<T>(
  connection: FramedMachineConnection,
  schema: z.ZodType<T>,
  options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<T> {
  const raw = await connection.receive(z.unknown(), options)
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'protocolVersion' in raw &&
    raw.protocolVersion !== machineProtocolVersion
  ) {
    throw new MachineTransportError(
      'protocol_incompatible',
      'CodeTether Machine protocol is incompatible',
    )
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new MachineTransportError(
      'malformed_message',
      'Machine message is invalid',
    )
  }
  return parsed.data
}

function assertRemoteCodexSessionControl(
  control: CodexTurnStartMessage | CodexSessionDisposeMessage,
  runner: RemoteCodexRunner,
): void {
  if (
    control.conversationId !== runner.conversationId ||
    control.providerThreadId !== runner.providerThreadId
  ) {
    throw new MachineTransportError(
      'identity_mismatch',
      'Remote Codex control did not match the owned session',
    )
  }
}

function assertRemoteClaudeSessionControl(
  control: ClaudeTurnStartMessage | ClaudeSessionDisposeMessage,
  runner: RemoteClaudeRunner,
): void {
  if (
    control.conversationId !== runner.conversationId ||
    control.providerSessionId !== runner.providerSessionId
  ) {
    throw new MachineTransportError(
      'identity_mismatch',
      'Remote Claude control did not match the owned session',
    )
  }
}

async function sendRemoteCodexTurnStarted(
  connection: FramedMachineConnection,
  machine: RemoteMachineMetadata,
  runner: RemoteCodexRunner,
  turn: RemoteCodexRunnerTurn,
): Promise<void> {
  await connection.send({
    type: 'codex.turn.started',
    protocolVersion: machineProtocolVersion,
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    actionId: turn.actionId,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    providerThreadId: runner.providerThreadId,
    providerTurnId: turn.providerTurnId,
  })
}

async function sendRemoteCodexDisposed(
  connection: FramedMachineConnection,
  machine: RemoteMachineMetadata,
  request: CodexSessionDisposeMessage,
): Promise<void> {
  await connection.send({
    type: 'codex.session.disposed',
    protocolVersion: machineProtocolVersion,
    requestId: request.requestId,
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    conversationId: request.conversationId,
  })
}

async function sendRemoteClaudeTurnStarted(
  connection: FramedMachineConnection,
  machine: RemoteMachineMetadata,
  runner: RemoteClaudeRunner,
  turn: RemoteClaudeRunnerTurn,
): Promise<void> {
  await connection.send({
    type: 'claude.turn.started',
    protocolVersion: machineProtocolVersion,
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    actionId: turn.actionId,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    providerSessionId: runner.providerSessionId,
    providerTurnId: turn.providerTurnId,
  })
}

async function sendRemoteClaudeDisposed(
  connection: FramedMachineConnection,
  machine: RemoteMachineMetadata,
  request: ClaudeSessionDisposeMessage,
): Promise<void> {
  await connection.send({
    type: 'claude.session.disposed',
    protocolVersion: machineProtocolVersion,
    requestId: request.requestId,
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    conversationId: request.conversationId,
  })
}

async function sendSafeError(
  connection: FramedMachineConnection,
  error: unknown,
): Promise<void> {
  const code = wireErrorCode(error)
  await connection.send(machineError(code)).catch(() => undefined)
}

function wireErrorCode(error: unknown): MachineWireErrorCode {
  if (!(error instanceof MachineTransportError)) return 'authentication_failed'
  if (error.code === 'connection_failed' || error.code === 'timeout') {
    return 'authentication_failed'
  }
  return error.code
}

function isProjectLocationValidationError(
  error: unknown,
): error is MachineTransportError {
  return (
    error instanceof MachineTransportError &&
    (error.code === 'project_location_path_invalid' ||
      error.code === 'project_location_missing' ||
      error.code === 'project_location_not_directory' ||
      error.code === 'project_location_inaccessible')
  )
}

function machineError(code: MachineWireErrorCode) {
  const messages: Record<MachineWireErrorCode, string> = {
    pairing_disabled: 'Pairing mode is disabled',
    pairing_expired: 'Pairing code expired',
    pairing_rate_limited: 'Pairing attempt limit was reached',
    pairing_failed: 'Pairing authentication failed',
    authentication_failed: 'Machine authentication failed',
    identity_mismatch: 'Machine identity did not match',
    protocol_incompatible: 'Machine protocol is incompatible',
    busy: 'Machine connection limit was reached',
    malformed_message: 'Machine message is invalid',
    project_location_path_invalid: 'Project Location path is invalid',
    project_location_missing: 'Project Location directory does not exist',
    project_location_not_directory: 'Project Location path is not a directory',
    project_location_inaccessible: 'Project Location directory is inaccessible',
    remote_execution_unavailable: 'Remote Provider execution is unavailable',
    provider_unavailable: 'Remote Provider is unavailable',
    provider_start_failed: 'Remote Provider could not start',
    provider_session_lost: 'Remote Provider session was lost',
    remote_execution_lost: 'Remote Provider execution was lost',
    remote_policy_violation: 'Remote Provider operation was rejected',
    conversation_busy: 'Remote Provider Conversation is busy',
    duplicate_action_conflict: 'Remote Provider action identity conflicted',
  }
  return MachineErrorMessageSchema.parse({
    type: 'machine.error',
    protocolVersion: machineProtocolVersion,
    code,
    message: messages[code],
  })
}

function normalizedRemoteAddress(value: string | undefined): string {
  if (value === undefined) return 'unknown'
  return value.startsWith('::ffff:') ? value.slice(7) : value
}
