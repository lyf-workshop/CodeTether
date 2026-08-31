import type { QueryClient } from '@tanstack/react-query'

import {
  CodeTetherIncompatibleProtocolError,
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'
import {
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  RemoteMachineAddressSchema,
  type BeginRemoteMachinePairingRequest,
  type BeginRemoteMachinePairingResponse,
  type CancelRemoteMachinePairingRequest,
  type CancelRemoteMachinePairingResponse,
  type ConfirmRemoteMachinePairingRequest,
  type ConfirmRemoteMachinePairingResponse,
  type MachineId,
  type MachinePairingAttemptId,
  type MachineSummary,
  type RemoteMachineAddress,
  type RetryMachineConnectionRequest,
  type RetryMachineConnectionResponse,
  type UnpairMachineRequest,
  type UnpairMachineResponse,
  type UpdateMachineConnectionAddressRequest,
  type UpdateMachineConnectionAddressResponse,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'
import { machineQueryKeys, removeMachineQueries } from './machine-query.js'

export interface MachineMutationClient {
  beginRemoteMachinePairing(
    request: BeginRemoteMachinePairingRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BeginRemoteMachinePairingResponse>
  confirmRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    request: ConfirmRemoteMachinePairingRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ConfirmRemoteMachinePairingResponse>
  cancelRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    request: CancelRemoteMachinePairingRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CancelRemoteMachinePairingResponse>
  unpairMachine(
    machineId: MachineId,
    request: UnpairMachineRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<UnpairMachineResponse>
  retryMachineConnection(
    machineId: MachineId,
    request: RetryMachineConnectionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RetryMachineConnectionResponse>
  updateMachineConnectionAddress(
    machineId: MachineId,
    request: UpdateMachineConnectionAddressRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<UpdateMachineConnectionAddressResponse>
}

export type MachineOperation =
  'begin' | 'cancel' | 'confirm' | 'retry' | 'unpair' | 'update-address'

interface MutationAttempt<T> {
  readonly identity: string
  readonly promise: Promise<T>
}

export class MachineMutationBusyError extends Error {
  constructor() {
    super('A Machine trust mutation is already in progress')
    this.name = 'MachineMutationBusyError'
  }
}

export class MachineActions {
  readonly #client: MachineMutationClient
  readonly #queryClient: QueryClient
  readonly #createActionId: ActionIdFactory
  #beginAttempt?: MutationAttempt<BeginRemoteMachinePairingResponse>
  readonly #attempts = new Map<string, MutationAttempt<unknown>>()

  constructor(
    client: MachineMutationClient,
    queryClient: QueryClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#queryClient = queryClient
    this.#createActionId = createActionId
  }

  beginRemoteMachinePairing(
    address: RemoteMachineAddress,
    pairingCode: string,
  ): Promise<BeginRemoteMachinePairingResponse> {
    const parsedAddress = RemoteMachineAddressSchema.parse(address)
    const identity = JSON.stringify([parsedAddress, pairingCode])
    const current = this.#beginAttempt
    if (current !== undefined) {
      return current.identity === identity
        ? current.promise
        : Promise.reject(new MachineMutationBusyError())
    }

    const promise = this.#client
      .beginRemoteMachinePairing({
        actionId: this.#createActionId(),
        address: parsedAddress,
        pairingCode,
      })
      .finally(() => {
        if (this.#beginAttempt?.promise === promise) {
          this.#beginAttempt = undefined
        }
      })
    this.#beginAttempt = { identity, promise }
    return promise
  }

  confirmRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId | string,
  ): Promise<ConfirmRemoteMachinePairingResponse> {
    const attempt = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    return this.#run(`confirm:${attempt}`, '', () =>
      this.#client
        .confirmRemoteMachinePairing(attempt, {
          actionId: this.#createActionId(),
        })
        .then((response) => {
          this.#acceptMachine(response.data.machine)
          return response
        }),
    )
  }

  cancelRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId | string,
  ): Promise<CancelRemoteMachinePairingResponse> {
    const attempt = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    return this.#run(`cancel:${attempt}`, '', () =>
      this.#client.cancelRemoteMachinePairing(attempt, {
        actionId: this.#createActionId(),
      }),
    )
  }

  unpairMachine(machineId: MachineId | string): Promise<UnpairMachineResponse> {
    const machine = MachineIdSchema.parse(machineId)
    return this.#run(`machine:${machine}`, 'unpair', () =>
      this.#client
        .unpairMachine(machine, { actionId: this.#createActionId() })
        .then((response) => {
          this.#removeMachine(machine)
          return response
        }),
    )
  }

  retryMachineConnection(
    machineId: MachineId | string,
  ): Promise<RetryMachineConnectionResponse> {
    const machine = MachineIdSchema.parse(machineId)
    return this.#run(`machine:${machine}`, 'retry', () =>
      this.#client
        .retryMachineConnection(machine, {
          actionId: this.#createActionId(),
        })
        .then((response) => {
          this.#acceptMachine(response.data.machine)
          return response
        }),
    )
  }

  updateMachineConnectionAddress(
    machineId: MachineId | string,
    address: RemoteMachineAddress,
  ): Promise<UpdateMachineConnectionAddressResponse> {
    const machine = MachineIdSchema.parse(machineId)
    const parsedAddress = RemoteMachineAddressSchema.parse(address)
    const identity = `address:${JSON.stringify(parsedAddress)}`
    return this.#run(`machine:${machine}`, identity, () =>
      this.#client
        .updateMachineConnectionAddress(machine, {
          actionId: this.#createActionId(),
          address: parsedAddress,
        })
        .then((response) => {
          this.#acceptMachine(response.data.machine)
          return response
        }),
    )
  }

  #run<T>(
    key: string,
    identity: string,
    request: () => Promise<T>,
  ): Promise<T> {
    const current = this.#attempts.get(key)
    if (current !== undefined) {
      return current.identity === identity
        ? (current.promise as Promise<T>)
        : Promise.reject(new MachineMutationBusyError())
    }

    const promise = request().finally(() => {
      if (this.#attempts.get(key)?.promise === promise) {
        this.#attempts.delete(key)
      }
    })
    this.#attempts.set(key, { identity, promise })
    return promise
  }

  #acceptMachine(machine: MachineSummary): void {
    this.#queryClient.setQueryData<readonly MachineSummary[]>(
      machineQueryKeys.list,
      (current) => {
        if (current === undefined) return [machine]
        const existing = current.some(
          (candidate) => candidate.machineId === machine.machineId,
        )
        return existing
          ? current.map((candidate) =>
              candidate.machineId === machine.machineId ? machine : candidate,
            )
          : [...current, machine]
      },
    )
    void this.#queryClient.invalidateQueries({ queryKey: machineQueryKeys.all })
  }

  #removeMachine(machineId: MachineId): void {
    removeMachineQueries(this.#queryClient, machineId)
  }
}

export function parseRemoteMachineAddressInput(
  value: string,
): RemoteMachineAddress | undefined {
  const input = value.trim()
  if (input.startsWith('[')) {
    const separator = input.indexOf(']:')
    if (separator <= 1 || input.indexOf('[', 1) !== -1) return undefined
    return parseRemoteMachineAddress(
      input.slice(1, separator),
      input.slice(separator + 2),
    )
  }

  const separator = input.lastIndexOf(':')
  if (separator <= 0 || input.indexOf(':') !== separator) return undefined
  return parseRemoteMachineAddress(
    input.slice(0, separator),
    input.slice(separator + 1),
  )
}

function parseRemoteMachineAddress(
  host: string,
  portText: string,
): RemoteMachineAddress | undefined {
  if (!/^\d{1,5}$/u.test(portText)) return undefined
  const parsed = RemoteMachineAddressSchema.safeParse({
    host,
    port: Number(portText),
  })
  return parsed.success ? parsed.data : undefined
}

export function normalizePairingCodeInput(value: string): string {
  return value.normalize('NFKC').replace(/\D/gu, '').slice(0, 6)
}

/** Stable product copy; raw transport and cryptographic diagnostics stay private. */
export function machineErrorMessage(
  error: unknown,
  operation: MachineOperation,
): string {
  if (error instanceof MachineMutationBusyError) {
    return '此机器操作正在处理中，请稍候。'
  }
  if (error instanceof CodeTetherIncompatibleProtocolError) {
    return '当前 CodeTether 版本不兼容，请更新应用后重试。'
  }
  if (error instanceof CodeTetherProtocolError) {
    return 'CodeTether 暂时无法读取机器数据，请重试。'
  }
  if (!(error instanceof CodeTetherResponseError)) {
    return 'CodeTether 暂时无法连接，请重试。'
  }

  switch (error.envelope.code) {
    case 'machine_pairing_code_invalid':
      return '配对码无效，请检查远程节点显示的六码。'
    case 'machine_pairing_code_expired':
      return '配对码已过期，请在远程节点重新开启配对。'
    case 'machine_pairing_rate_limited':
      return '配对尝试过多，请稍后在远程节点生成新的配对码。'
    case 'machine_authentication_failed':
      return operation === 'update-address'
        ? '无法验证新地址上的机器身份；原信任关系未更改。'
        : '无法验证这台机器的身份。'
    case 'machine_identity_mismatch':
      return operation === 'update-address'
        ? '该地址指向另一台机器；CodeTether 已拒绝连接，原信任关系未更改。'
        : '远程机器的身份与已确认信息不一致。'
    case 'machine_unreachable':
      return '远程机器当前不可连接，请检查地址和局域网连接。'
    case 'machine_protocol_incompatible':
      return '远程节点版本不兼容，请更新 CodeTether Node。'
    case 'machine_connection_failed':
      return '无法建立安全连接，请重试。'
    case 'invalid_request':
      return operation === 'begin'
        ? '请输入有效的节点地址和六码配对码。'
        : operation === 'update-address'
          ? '请输入有效的局域网地址和端口。'
          : '机器请求无效，请重试。'
    case 'not_found':
      return operation === 'unpair'
        ? '该远程机器已不存在或已经取消配对。'
        : operation === 'begin' || operation === 'confirm'
          ? '配对请求不存在或已过期，请重新开始。'
          : '该远程机器已不存在。'
    case 'conflict':
      return operation === 'unpair'
        ? '机器状态已经变化，请返回列表后重试。'
        : operation === 'begin' || operation === 'confirm'
          ? '这台机器已经配对，或配对状态已经变化。'
          : '机器连接状态已经变化，请重试。'
    case 'timeout':
      return '机器操作等待超时，请重试。'
    case 'runtime_unavailable':
      return 'CodeTether 本地服务暂时不可用。'
    case 'unsupported':
      return '当前 CodeTether 版本不支持此机器操作。'
    case 'machine_has_project_locations':
      return '这台机器仍有关联项目位置，请先移除这些位置再取消配对。'
    case 'internal':
    case 'provider_error':
    case 'provider_not_installed':
    case 'provider_version_unsupported':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'provider_unavailable':
    case 'provider_conversation_unavailable':
    case 'project_unavailable':
    case 'project_has_conversations':
    case 'project_location_invalid':
    case 'project_location_missing':
    case 'project_location_inaccessible':
    case 'project_location_conflict':
    case 'conversation_archived':
      return operation === 'unpair'
        ? 'CodeTether 未能取消机器配对。'
        : operation === 'retry' || operation === 'update-address'
          ? 'CodeTether 未能恢复机器连接。'
          : 'CodeTether 未能完成机器配对。'
  }
}
