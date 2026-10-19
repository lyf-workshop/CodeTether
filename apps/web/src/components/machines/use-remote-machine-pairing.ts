import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { useMutation } from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'
import {
  RemoteMachinePairingCodeSchema,
  type MachineId,
} from '@codetether/protocol'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  machineErrorMessage,
  normalizePairingCodeInput,
  parseRemoteMachinePairingTargetInput,
} from '../../runtime/host/machine-actions'
import {
  getMachineTrustLease,
  MachinePairingFlow,
  MachineTrustFlowBusyError,
  MachinePairingDisposedError,
} from './machine-trust-flow'

export function useMachineTrustBusy(): boolean {
  const runtime = useHostRuntime()
  const lease = getMachineTrustLease(runtime)
  return (
    useSyncExternalStore(
      lease.subscribe,
      lease.getSnapshot,
      lease.getSnapshot,
    ) !== undefined
  )
}

/** Shared by the guided page and existing onboarding dialog; same runtime actions. */
export function useRemoteMachinePairing({
  onConfirmed,
}: { onConfirmed?: (machineId: MachineId) => void | Promise<void> } = {}) {
  const runtime = useHostRuntime()
  const lease = getMachineTrustLease(runtime)
  const leaseToken = useSyncExternalStore(
    lease.subscribe,
    lease.getSnapshot,
    lease.getSnapshot,
  )
  const flow = useRef<MachinePairingFlow | null>(null)
  const mounted = useRef(false)
  const submitted = useRef(false)
  const [owner] = useState(() => Symbol('pairing-view'))
  const [address, setAddress] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [validationError, setValidationError] = useState('')
  const [completionError, setCompletionError] = useState('')
  useEffect(() => {
    const current = new MachinePairingFlow(runtime, owner)
    flow.current = current
    mounted.current = true
    return () => {
      mounted.current = false
      if (flow.current === current) flow.current = null
      // Handles a late begin result as well as an already-visible attempt.
      // This never revokes a confirmed Machine or retries Provider work.
      void current.dispose()
    }
  }, [runtime, owner])
  const beginMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const target = parseRemoteMachinePairingTargetInput(address)
      const code = RemoteMachinePairingCodeSchema.safeParse(pairingCode)
      if (target === undefined || !code.success || flow.current === null)
        throw new MachinePairingDisposedError()
      return await flow.current.begin(target, code.data)
    },
    onSuccess: () => {
      if (mounted.current) setPairingCode('')
    },
    onSettled: () => {
      submitted.current = false
    },
  })
  const candidate = beginMutation.data?.data.candidate
  const confirmMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (candidate === undefined || flow.current === null)
        throw new MachinePairingDisposedError()
      return await flow.current.confirm(candidate.pairingAttemptId)
    },
    onSuccess: async (response) => {
      if (!mounted.current || onConfirmed === undefined) return
      try {
        await onConfirmed(response.data.machine.machineId)
      } catch {
        if (mounted.current)
          setCompletionError(
            '设备已配对，但未能打开下一步。请查看设备后继续，勿重复配对。',
          )
      }
    },
    onSettled: () => {
      submitted.current = false
    },
  })
  const cancelMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (candidate === undefined || flow.current === null)
        throw new MachinePairingDisposedError()
      return await flow.current.cancel(candidate.pairingAttemptId)
    },
    onSettled: () => {
      submitted.current = false
    },
  })
  const pairedMachine = confirmMutation.data?.data.machine
  const busy =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    cancelMutation.isPending
  const otherTrustBusy = leaseToken !== undefined && leaseToken.owner !== owner
  const actionError =
    cancelMutation.error ?? confirmMutation.error ?? beginMutation.error
  const error =
    validationError ||
    completionError ||
    (otherTrustBusy
      ? '另一项设备配对或取消配对正在进行，请先完成或取消那项操作。'
      : actionError instanceof MachinePairingDisposedError
        ? ''
        : actionError instanceof MachineTrustFlowBusyError
          ? '另一项设备信任操作正在进行，请稍后再试。'
          : actionError === null
            ? ''
            : machineErrorMessage(
                actionError,
                cancelMutation.isError
                  ? 'cancel'
                  : confirmMutation.isError
                    ? 'confirm'
                    : 'begin',
              )
                .replaceAll('远程节点', 'Node')
                .replaceAll('智能体', 'AI 工具'))
  const beginErrorCode =
    beginMutation.error instanceof CodeTetherResponseError
      ? beginMutation.error.envelope.code
      : undefined
  const addressInvalid =
    validationError.startsWith('请输入设备地址') ||
    beginErrorCode === 'machine_unreachable' ||
    beginErrorCode === 'machine_connection_failed'
  const pairingCodeInvalid =
    validationError.startsWith('请输入 Node') ||
    beginErrorCode === 'machine_pairing_code_invalid' ||
    beginErrorCode === 'machine_pairing_code_expired' ||
    beginErrorCode === 'machine_pairing_rate_limited'

  function resetState() {
    setAddress('')
    setPairingCode('')
    setValidationError('')
    setCompletionError('')
    beginMutation.reset()
    confirmMutation.reset()
    cancelMutation.reset()
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      submitted.current ||
      busy ||
      otherTrustBusy ||
      candidate !== undefined ||
      pairedMachine !== undefined
    )
      return
    if (parseRemoteMachinePairingTargetInput(address) === undefined) {
      setValidationError('请输入设备地址（主机:端口）或 Node 显示的配对链接。')
      return
    }
    if (!RemoteMachinePairingCodeSchema.safeParse(pairingCode).success) {
      setValidationError('请输入 Node 显示的六位一次性配对码。')
      return
    }
    setValidationError('')
    beginMutation.reset()
    submitted.current = true
    beginMutation.mutate()
  }
  function confirm() {
    if (
      submitted.current ||
      busy ||
      otherTrustBusy ||
      candidate === undefined ||
      pairedMachine !== undefined
    )
      return
    cancelMutation.reset()
    submitted.current = true
    confirmMutation.mutate()
  }
  async function cancel(): Promise<boolean> {
    if (submitted.current || busy) return false
    if (candidate === undefined || pairedMachine !== undefined) {
      resetState()
      return true
    }
    if (otherTrustBusy) return false
    confirmMutation.reset()
    submitted.current = true
    try {
      await cancelMutation.mutateAsync()
      if (mounted.current) resetState()
      return true
    } catch {
      return false
    }
  }
  return {
    address,
    pairingCode,
    candidate,
    pairedMachine,
    error,
    addressInvalid,
    pairingCodeInvalid,
    busy,
    otherTrustBusy,
    beginning: beginMutation.isPending,
    confirming: confirmMutation.isPending,
    setAddress: (value: string) => {
      setAddress(value)
      setValidationError('')
      beginMutation.reset()
    },
    setPairingCode: (value: string) => {
      setPairingCode(normalizePairingCodeInput(value))
      setValidationError('')
      beginMutation.reset()
    },
    handleSubmit,
    confirm,
    cancel,
    resetState,
  }
}
export type RemoteMachinePairingController = ReturnType<
  typeof useRemoteMachinePairing
>
