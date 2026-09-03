import type { QueryClient } from '@tanstack/react-query'

import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  ConfigureMachineRelayRequestSchema,
  EnrollMachineRelayRequestSchema,
  MachineIdSchema,
  type ConfigureMachineRelayRequest,
  type ConfigureMachineRelayResponse,
  type DisconnectMachineRelayRequest,
  type DisconnectMachineRelayResponse,
  type EnrollMachineRelayRequest,
  type EnrollMachineRelayResponse,
  type GetMachineResponse,
  type MachineId,
  type RelayEndpoint,
  type RelayEnrollmentToken,
  type RelayIdentityFingerprint,
  type RemoveMachineRelayRequest,
  type RemoveMachineRelayResponse,
  type RetryMachineRelayRequest,
  type RetryMachineRelayResponse,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { machineQueryKeys } from './machine-query.js'

export interface RelayMutationClient {
  configureMachineRelay(
    machineId: MachineId,
    request: ConfigureMachineRelayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ConfigureMachineRelayResponse>
  enrollMachineRelay(
    machineId: MachineId,
    request: EnrollMachineRelayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EnrollMachineRelayResponse>
  retryMachineRelay(
    machineId: MachineId,
    request: RetryMachineRelayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RetryMachineRelayResponse>
  disconnectMachineRelay(
    machineId: MachineId,
    request: DisconnectMachineRelayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DisconnectMachineRelayResponse>
  removeMachineRelay(
    machineId: MachineId,
    request: RemoveMachineRelayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RemoveMachineRelayResponse>
}

export interface ConfigureRelayInput {
  readonly endpoint: RelayEndpoint
  readonly relayIdentityFingerprint: RelayIdentityFingerprint
  readonly displayLabel?: string
}

type RelayMutationResponse =
  | ConfigureMachineRelayResponse
  | EnrollMachineRelayResponse
  | RetryMachineRelayResponse
  | DisconnectMachineRelayResponse
  | RemoveMachineRelayResponse

interface MutationAttempt {
  readonly identity: string
  readonly promise: Promise<RelayMutationResponse>
}

export class RelayMutationBusyError extends Error {
  constructor() {
    super('A Relay mutation is already in progress for this Machine')
    this.name = 'RelayMutationBusyError'
  }
}

export class RelayActions {
  readonly #client: RelayMutationClient
  readonly #queryClient: QueryClient
  readonly #createActionId: ActionIdFactory
  readonly #attempts = new Map<MachineId, MutationAttempt>()

  constructor(
    client: RelayMutationClient,
    queryClient: QueryClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#queryClient = queryClient
    this.#createActionId = createActionId
  }

  configure(
    machineId: MachineId | string,
    input: ConfigureRelayInput,
  ): Promise<ConfigureMachineRelayResponse> {
    const machine = MachineIdSchema.parse(machineId)
    const request = ConfigureMachineRelayRequestSchema.parse({
      actionId: this.#createActionId(),
      ...input,
    })
    return this.#run(machine, `configure:${JSON.stringify(input)}`, () =>
      this.#client.configureMachineRelay(machine, request),
    ) as Promise<ConfigureMachineRelayResponse>
  }

  enroll(
    machineId: MachineId | string,
    enrollmentToken: RelayEnrollmentToken | string,
  ): Promise<EnrollMachineRelayResponse> {
    const machine = MachineIdSchema.parse(machineId)
    const request = EnrollMachineRelayRequestSchema.parse({
      actionId: this.#createActionId(),
      enrollmentToken,
    })
    return this.#run(machine, 'enroll', () =>
      this.#client.enrollMachineRelay(machine, request),
    ) as Promise<EnrollMachineRelayResponse>
  }

  retry(machineId: MachineId | string): Promise<RetryMachineRelayResponse> {
    const machine = MachineIdSchema.parse(machineId)
    return this.#run(machine, 'retry', () =>
      this.#client.retryMachineRelay(machine, {
        actionId: this.#createActionId(),
      }),
    ) as Promise<RetryMachineRelayResponse>
  }

  disconnect(
    machineId: MachineId | string,
  ): Promise<DisconnectMachineRelayResponse> {
    const machine = MachineIdSchema.parse(machineId)
    return this.#run(machine, 'disconnect', () =>
      this.#client.disconnectMachineRelay(machine, {
        actionId: this.#createActionId(),
      }),
    ) as Promise<DisconnectMachineRelayResponse>
  }

  remove(machineId: MachineId | string): Promise<RemoveMachineRelayResponse> {
    const machine = MachineIdSchema.parse(machineId)
    return this.#run(machine, 'remove', () =>
      this.#client.removeMachineRelay(machine, {
        actionId: this.#createActionId(),
      }),
    ) as Promise<RemoveMachineRelayResponse>
  }

  #run(
    machineId: MachineId,
    identity: string,
    mutate: () => Promise<RelayMutationResponse>,
  ): Promise<RelayMutationResponse> {
    const current = this.#attempts.get(machineId)
    if (current !== undefined) {
      return current.identity === identity
        ? current.promise
        : Promise.reject(new RelayMutationBusyError())
    }

    const promise = mutate()
      .then((response) => {
        this.#queryClient.setQueryData<GetMachineResponse>(
          machineQueryKeys.detail(machineId),
          (currentDetail) =>
            currentDetail === undefined
              ? undefined
              : { ...currentDetail, relay: response.data.relay },
        )
        void this.#queryClient.invalidateQueries({
          queryKey: machineQueryKeys.list,
          exact: true,
        })
        return response
      })
      .finally(() => {
        if (this.#attempts.get(machineId)?.promise === promise) {
          this.#attempts.delete(machineId)
        }
      })
    this.#attempts.set(machineId, { identity, promise })
    return promise
  }
}

export function relayErrorMessage(error: unknown): string {
  if (error instanceof RelayMutationBusyError) {
    return '这台机器的 Internet Relay 设置正在更新，请稍候。'
  }
  if (error instanceof CodeTetherIncompatibleProtocolError) {
    return '当前 CodeTether 版本与本地服务不兼容，请更新应用。'
  }
  if (error instanceof CodeTetherProtocolError) {
    return 'CodeTether 无法安全读取 Relay 响应，请重试。'
  }
  if (!(error instanceof CodeTetherResponseError)) {
    return 'Internet Relay 暂时无法连接。局域网直连不受影响。'
  }

  switch (error.envelope.code) {
    case 'relay_not_configured':
      return '请先配置 Internet Relay。'
    case 'relay_unreachable':
    case 'timeout':
      return 'Internet Relay 暂时无法连接。局域网直连不受影响。'
    case 'relay_authentication_failed':
      return 'Relay 无法验证此 Controller；现有机器信任关系未更改。'
    case 'relay_identity_mismatch':
      return 'Relay 身份与已确认指纹不一致，CodeTether 已拒绝连接。'
    case 'relay_protocol_incompatible':
      return 'Relay 协议版本不兼容，请更新 CodeTether 或 Relay。'
    case 'relay_revoked':
      return '此 Controller 的 Relay 注册已被撤销，需要重新注册。'
    case 'relay_rate_limited':
      return 'Relay 暂时限制新的连接或注册请求，请稍后重试。'
    case 'invalid_request':
      return 'Relay 设置无效，请检查主机、端口、身份指纹和注册令牌。'
    case 'not_found':
      return '这台远程机器已不存在。'
    case 'runtime_unavailable':
      return 'CodeTether 本地服务暂时不可用。'
    default:
      return 'CodeTether 未能完成 Relay 操作。局域网直连不受影响。'
  }
}
