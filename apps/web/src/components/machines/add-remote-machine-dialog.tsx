import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Link2, Server, ShieldCheck } from 'lucide-react'

import { CodeTetherResponseError } from '@codetether/client'
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@codetether/ui'
import {
  RemoteMachinePairingCodeSchema,
  type RemoteMachinePairingCandidate,
} from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  machineErrorMessage,
  normalizePairingCodeInput,
  parseRemoteMachineAddressInput,
} from '../../runtime/host/machine-actions'
import {
  machineArchitectureLabel,
  machinePlatformLabel,
  remoteMachineAddressLabel,
} from './machine-presentation'

interface AddRemoteMachineDialogProps {
  trigger: ReactElement
}

export function AddRemoteMachineDialog({
  trigger,
}: AddRemoteMachineDialogProps) {
  const navigate = useNavigate()
  const runtime = useHostRuntime()
  const addressInputRef = useRef<HTMLInputElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [candidate, setCandidate] = useState<
    RemoteMachinePairingCandidate | undefined
  >()
  const [validationError, setValidationError] = useState('')

  const beginMutation = useMutation({
    mutationFn: async () => {
      const parsedAddress = parseRemoteMachineAddressInput(address)
      const parsedCode = RemoteMachinePairingCodeSchema.safeParse(pairingCode)
      if (parsedAddress === undefined || !parsedCode.success) {
        throw new PairingInputError()
      }
      return await runtime.beginRemoteMachinePairing(
        parsedAddress,
        parsedCode.data,
      )
    },
    onSuccess: (response) => {
      // The one-time secret is no longer needed after the Host returns a
      // presentation-safe, cryptographically bound confirmation candidate.
      setPairingCode('')
      setCandidate(response.data.candidate)
    },
  })
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (candidate === undefined) throw new PairingInputError()
      return await runtime.confirmRemoteMachinePairing(
        candidate.pairingAttemptId,
      )
    },
    onSuccess: async (response) => {
      const machineId = response.data.machine.machineId
      resetState()
      setOpen(false)
      await navigate({
        to: '/machines/$machineId',
        params: { machineId },
      })
    },
  })
  const cancelMutation = useMutation({
    mutationFn: async (attempt: RemoteMachinePairingCandidate) =>
      await runtime.cancelRemoteMachinePairing(attempt.pairingAttemptId),
  })
  const busy =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    cancelMutation.isPending
  const error =
    validationError ||
    (beginMutation.isError
      ? machineErrorMessage(beginMutation.error, 'begin')
      : confirmMutation.isError
        ? machineErrorMessage(confirmMutation.error, 'confirm')
        : '')
  const beginErrorCode =
    beginMutation.error instanceof CodeTetherResponseError
      ? beginMutation.error.envelope.code
      : undefined
  const addressInvalid =
    validationError.startsWith('请输入“主机:端口”') ||
    beginErrorCode === 'machine_unreachable' ||
    beginErrorCode === 'machine_connection_failed'
  const pairingCodeInvalid =
    validationError.startsWith('请输入远程节点') ||
    beginErrorCode === 'machine_pairing_code_invalid' ||
    beginErrorCode === 'machine_pairing_code_expired' ||
    beginErrorCode === 'machine_pairing_rate_limited'
  const addressDescription = error
    ? 'remote-machine-address-description remote-machine-pairing-error'
    : 'remote-machine-address-description'
  const pairingCodeDescription = error
    ? 'remote-machine-pairing-code-description remote-machine-pairing-error'
    : 'remote-machine-pairing-code-description'

  useEffect(() => {
    if (candidate === undefined) return
    confirmationHeadingRef.current?.focus()
  }, [candidate])

  function resetMutations() {
    beginMutation.reset()
    confirmMutation.reset()
    cancelMutation.reset()
  }

  function resetState() {
    setAddress('')
    setPairingCode('')
    setCandidate(undefined)
    setValidationError('')
    resetMutations()
  }

  function closeWithoutAttempt() {
    resetState()
    setOpen(false)
  }

  function cancelAttempt(next: 'close' | 'entry') {
    if (candidate === undefined) {
      if (next === 'close') closeWithoutAttempt()
      return
    }
    const pendingCandidate = candidate
    cancelMutation.mutate(pendingCandidate, {
      onSettled: () => {
        resetState()
        if (next === 'close') setOpen(false)
        else requestAnimationFrame(() => addressInputRef.current?.focus())
      },
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetState()
      setOpen(true)
      return
    }
    if (busy) return
    if (candidate !== undefined) {
      cancelAttempt('close')
      return
    }
    closeWithoutAttempt()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const parsedAddress = parseRemoteMachineAddressInput(address)
    const parsedCode = RemoteMachinePairingCodeSchema.safeParse(pairingCode)
    if (parsedAddress === undefined) {
      setValidationError('请输入“主机:端口”格式的节点地址。')
      return
    }
    if (!parsedCode.success) {
      setValidationError('请输入远程节点显示的六码配对码。')
      return
    }
    setValidationError('')
    beginMutation.reset()
    beginMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel="关闭添加机器对话框"
        className="max-w-lg overflow-x-hidden"
        showCloseButton={!busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          addressInputRef.current?.focus()
        }}
      >
        {candidate === undefined ? (
          <form
            className="min-w-0"
            data-machine-pairing-step="entry"
            onSubmit={handleSubmit}
          >
            <DialogHeader>
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
              >
                <Link2 className="size-5" />
              </span>
              <DialogTitle>添加远程机器</DialogTitle>
              <DialogDescription>
                输入 CodeTether Node 显示的局域网地址和一次性配对码。
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 min-w-0 space-y-4">
              <div className="min-w-0">
                <label
                  htmlFor="remote-machine-address"
                  className="text-sm font-medium text-text-primary"
                >
                  节点地址
                </label>
                <p
                  id="remote-machine-address-description"
                  className="mt-1 text-xs text-text-muted"
                >
                  使用节点显示的主机名或 IP 地址和端口。IPv6
                  地址需要使用方括号。
                </p>
                <Input
                  ref={addressInputRef}
                  id="remote-machine-address"
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value)
                    setValidationError('')
                    beginMutation.reset()
                  }}
                  aria-describedby={addressDescription}
                  aria-errormessage={
                    addressInvalid ? 'remote-machine-pairing-error' : undefined
                  }
                  aria-invalid={addressInvalid || undefined}
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={busy}
                  placeholder="192.168.1.42:4318"
                  spellCheck={false}
                  className="mt-2 font-mono text-sm"
                />
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="remote-machine-pairing-code"
                  className="text-sm font-medium text-text-primary"
                >
                  配对码
                </label>
                <p
                  id="remote-machine-pairing-code-description"
                  className="mt-1 text-xs text-text-muted"
                >
                  配对码仅在节点本次配对模式中短时有效，并且只能使用一次。
                </p>
                <Input
                  id="remote-machine-pairing-code"
                  value={pairingCode}
                  onChange={(event) => {
                    setPairingCode(
                      normalizePairingCodeInput(event.target.value),
                    )
                    setValidationError('')
                    beginMutation.reset()
                  }}
                  aria-describedby={pairingCodeDescription}
                  aria-errormessage={
                    pairingCodeInvalid
                      ? 'remote-machine-pairing-error'
                      : undefined
                  }
                  aria-invalid={pairingCodeInvalid || undefined}
                  autoComplete="one-time-code"
                  disabled={busy}
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="482731"
                  spellCheck={false}
                  className="mt-2 font-mono text-lg tracking-widest"
                />
              </div>

              {error ? (
                <p
                  id="remote-machine-pairing-error"
                  role="alert"
                  className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button variant="secondary" size="sm" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={busy}>
                {beginMutation.isPending ? '正在验证…' : '继续'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <section className="min-w-0" data-machine-pairing-step="confirmation">
            <DialogHeader>
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-md border border-success/30 bg-success-muted text-success"
              >
                <ShieldCheck className="size-5" />
              </span>
              <DialogTitle
                ref={confirmationHeadingRef}
                tabIndex={-1}
                className="outline-none"
              >
                确认远程机器
              </DialogTitle>
              <DialogDescription>
                请确认以下信息和远程节点一致，再建立长期信任关系。
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 min-w-0 space-y-4">
              <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-muted/45 p-3">
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-sm border border-primary/30 bg-primary-muted text-primary"
                >
                  <Server className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong
                      title={candidate.displayName}
                      className="min-w-0 truncate text-sm text-text-primary"
                    >
                      {candidate.displayName}
                    </strong>
                    <Badge variant="secondary">远程</Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs text-text-secondary">
                    {machinePlatformLabel(candidate.platform)} ·{' '}
                    {machineArchitectureLabel(candidate.architecture)}
                  </span>
                </span>
              </div>

              <dl className="grid min-w-0 gap-3 rounded-sm border border-border bg-surface/55 px-3 py-3 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-text-muted">本次连接地址</dt>
                  <dd
                    title={remoteMachineAddressLabel(candidate.address)}
                    className="mt-1 truncate font-mono text-text-primary"
                  >
                    {remoteMachineAddressLabel(candidate.address)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-text-muted">安全校验码</dt>
                  <dd className="mt-1 font-mono font-semibold tracking-widest text-text-primary">
                    {candidate.verificationCode}
                  </dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-text-muted">确认有效期</dt>
                  <dd className="mt-1 text-text-primary">
                    {formatPairingExpiry(candidate.expiresAt)} 前
                  </dd>
                </div>
              </dl>

              <p className="rounded-sm border border-warning/30 bg-warning-muted/45 px-3 py-2 text-sm text-text-secondary">
                只有当远程节点显示相同的安全校验码时，才信任这台机器。CodeTether
                不会因配对本身执行命令或访问文件；远程会话还必须满足独立的项目位置和智能体安全能力校验。
              </p>

              {error ? (
                <p
                  role="alert"
                  className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter className="mt-6">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => cancelAttempt('entry')}
              >
                重新输入
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => confirmMutation.mutate()}
              >
                {confirmMutation.isPending ? '正在建立信任…' : '信任这台机器'}
              </Button>
            </DialogFooter>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}

class PairingInputError extends Error {
  constructor() {
    super('Remote Machine pairing input is invalid')
    this.name = 'PairingInputError'
  }
}

function formatPairingExpiry(expiresAt: string): string {
  const expires = new Date(expiresAt)
  if (Number.isNaN(expires.getTime())) return '当前配对会话结束'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(expires)
}
