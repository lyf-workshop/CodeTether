import { useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MapPin, ShieldCheck } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@codetether/ui'
import type { MachineSummary, RemoteMachineAddress } from '@codetether/protocol'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  machineErrorMessage,
  parseRemoteMachineAddressInput,
} from '../../runtime/host/machine-actions'
import { remoteMachineAddressLabel } from './machine-presentation'

interface UpdateMachineAddressDialogProps {
  currentEndpoint?: RemoteMachineAddress
  machine: MachineSummary
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function UpdateMachineAddressDialog({
  currentEndpoint,
  machine,
  onOpenChange,
  open,
}: UpdateMachineAddressDialogProps) {
  const runtime = useHostRuntime()
  const inputRef = useRef<HTMLInputElement>(null)
  const [address, setAddress] = useState('')
  const [validationError, setValidationError] = useState('')
  const updateMutation = useMutation({
    mutationFn: async () => {
      const parsedAddress = parseRemoteMachineAddressInput(address)
      if (parsedAddress === undefined) throw new AddressInputError()
      return await runtime.updateMachineConnectionAddress(
        machine.machineId,
        parsedAddress,
      )
    },
    onSuccess: () => {
      reset()
      onOpenChange(false)
    },
  })
  const error =
    validationError ||
    (updateMutation.isError
      ? machineErrorMessage(updateMutation.error, 'update-address')
      : '')

  function reset() {
    setAddress('')
    setValidationError('')
    updateMutation.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && updateMutation.isPending) return
    if (nextOpen) {
      setAddress(
        currentEndpoint === undefined
          ? ''
          : remoteMachineAddressLabel(currentEndpoint),
      )
      setValidationError('')
      updateMutation.reset()
    } else {
      reset()
    }
    onOpenChange(nextOpen)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (updateMutation.isPending) return
    if (parseRemoteMachineAddressInput(address) === undefined) {
      setValidationError('请输入“主机:端口”格式的局域网地址。')
      return
    }
    setValidationError('')
    updateMutation.reset()
    updateMutation.mutate()
  }

  if (machine.kind !== 'remote') return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="关闭更新连接地址对话框"
        className="max-w-md overflow-x-hidden"
        showCloseButton={!updateMutation.isPending}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <form className="min-w-0" onSubmit={handleSubmit}>
          <DialogHeader>
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
            >
              <MapPin className="size-5" />
            </span>
            <DialogTitle>更新连接地址</DialogTitle>
            <DialogDescription className="break-words">
              为“{machine.displayName}”输入当前可访问的局域网地址。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 min-w-0 space-y-4">
            <div className="min-w-0">
              <label
                htmlFor="remote-machine-recovery-address"
                className="text-sm font-medium text-text-primary"
              >
                节点地址
              </label>
              <p
                id="remote-machine-recovery-description"
                className="mt-1 text-xs leading-relaxed text-text-muted"
              >
                使用主机名或 IP 地址和端口。IPv6 地址需要使用方括号。
              </p>
              <Input
                ref={inputRef}
                id="remote-machine-recovery-address"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value)
                  setValidationError('')
                  updateMutation.reset()
                }}
                aria-describedby={
                  error
                    ? 'remote-machine-recovery-description remote-machine-recovery-error'
                    : 'remote-machine-recovery-description'
                }
                aria-errormessage={
                  error ? 'remote-machine-recovery-error' : undefined
                }
                aria-invalid={error ? true : undefined}
                autoCapitalize="none"
                autoComplete="off"
                disabled={updateMutation.isPending}
                placeholder="192.168.1.42:4318"
                spellCheck={false}
                className="mt-2 font-mono text-sm"
              />
            </div>

            <div className="flex min-w-0 items-start gap-2.5 rounded-sm border border-border bg-surface-muted/55 px-3 py-3 text-sm text-text-secondary">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
              <p className="min-w-0 leading-relaxed">
                新地址只有在通过现有加密身份验证后才会保存。身份不匹配时，原信任关系和当前地址保持不变。
              </p>
            </div>

            {error ? (
              <p
                id="remote-machine-recovery-error"
                role="alert"
                className="break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button
                variant="secondary"
                size="sm"
                disabled={updateMutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? '正在安全验证…' : '验证并更新'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

class AddressInputError extends Error {
  constructor() {
    super('Remote Machine recovery address is invalid')
    this.name = 'AddressInputError'
  }
}
