import { useId, type Ref } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { Button, Input, Notice, StatusTag } from '@codetether/ui'
import type {
  MachineSummary,
  RemoteMachinePairingCandidate,
} from '@codetether/protocol'
import {
  machineArchitectureLabel,
  machinePlatformLabel,
  remoteMachineAddressLabel,
} from './machine-presentation'
import type { RemoteMachinePairingController } from './use-remote-machine-pairing'

export function MachinePairingEntry({
  pairing,
  addressRef,
  onBack,
}: {
  pairing: RemoteMachinePairingController
  addressRef?: Ref<HTMLInputElement>
  onBack: () => void
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <form
      className="space-y-6"
      data-machine-pairing-step="entry"
      onSubmit={pairing.handleSubmit}
      aria-busy={pairing.busy}
    >
      <div>
        <h2 className="text-xl font-semibold">输入配对码</h2>
        <p className="mt-2 text-md text-text-secondary">
          输入要添加的设备上 CodeTether Node 显示的信息。
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-address`} className="text-md font-medium">
          设备地址或配对链接
        </label>
        <Input
          id={`${id}-address`}
          ref={addressRef}
          value={pairing.address}
          onChange={(event) => pairing.setAddress(event.target.value)}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="192.168.1.42:4318 或 Node 配对链接"
          disabled={pairing.busy || pairing.otherTrustBusy}
          aria-invalid={pairing.addressInvalid || undefined}
          aria-errormessage={pairing.addressInvalid ? errorId : undefined}
          aria-describedby={`${id}-address-help${pairing.error ? ` ${errorId}` : ''}`}
          className="font-mono text-sm"
        />
        <p id={`${id}-address-help`} className="text-sm text-text-muted">
          局域网地址需要包含端口；IPv6 地址需使用方括号。
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-code`} className="text-md font-medium">
          六位配对码
        </label>
        <Input
          id={`${id}-code`}
          value={pairing.pairingCode}
          onChange={(event) => pairing.setPairingCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]{6}"
          placeholder="000000"
          spellCheck={false}
          disabled={pairing.busy || pairing.otherTrustBusy}
          aria-invalid={pairing.pairingCodeInvalid || undefined}
          aria-errormessage={pairing.pairingCodeInvalid ? errorId : undefined}
          aria-describedby={`${id}-code-help${pairing.error ? ` ${errorId}` : ''}`}
          className="font-mono text-xl tracking-widest"
        />
        <p id={`${id}-code-help`} className="text-sm text-text-muted">
          只在本次短时配对中有效，不会成为长期凭据。
        </p>
      </div>
      {pairing.error ? (
        <Notice tone="err" id={errorId}>
          {pairing.error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="secondary" onClick={onBack} disabled={pairing.busy}>
          上一步
        </Button>
        <Button type="submit" disabled={pairing.busy || pairing.otherTrustBusy}>
          {pairing.beginning ? '正在连接…' : '连接并核对'}
        </Button>
      </div>
    </form>
  )
}

export function MachinePairingConfirmation({
  candidate,
  error,
  busy,
  confirming,
  headingRef,
  onBack,
  onConfirm,
}: {
  candidate: RemoteMachinePairingCandidate
  error: string
  busy: boolean
  confirming: boolean
  headingRef?: Ref<HTMLHeadingElement>
  onBack: () => void
  onConfirm: () => void
}) {
  return (
    <section
      className="min-w-0 space-y-6"
      data-machine-pairing-step="confirmation"
      aria-busy={busy}
    >
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          核对验证码
        </h2>
        <p className="mt-2 text-md text-text-secondary">
          请与另一台设备上的 Node 核对。只有两端显示一致才继续。
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface-inset p-4">
        <p title={candidate.displayName} className="break-words font-semibold">
          {candidate.displayName}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {machinePlatformLabel(candidate.platform)} ·{' '}
          {machineArchitectureLabel(candidate.architecture)}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-text-muted">
          {candidate.address === undefined
            ? '通过 Relay'
            : remoteMachineAddressLabel(candidate.address)}
        </p>
      </div>
      <div className="rounded-lg border border-border p-6 text-center">
        <ShieldCheck
          className="mx-auto size-6 text-success-text"
          aria-hidden="true"
        />
        <p
          className="mt-3 font-mono text-page font-semibold tracking-widest"
          aria-label="安全验证码"
        >
          {candidate.verificationCode}
        </p>
        <p className="mt-3 text-sm text-text-muted">
          请在 {formatPairingExpiry(candidate.expiresAt)} 前确认
        </p>
      </div>
      <Notice tone="warn">
        验证码不一致时不要确认，返回检查连接地址。配对本身不会运行 AI
        工具或访问项目文件。
      </Notice>
      {error ? <Notice tone="err">{error}</Notice> : null}
      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          返回重新输入
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {confirming ? '正在建立信任…' : '验证码一致，确认配对'}
        </Button>
      </div>
    </section>
  )
}

export function MachinePairingComplete({
  machine,
  onAddProject,
  onViewDevice,
}: {
  machine: MachineSummary
  onAddProject: () => void
  onViewDevice: () => void
}) {
  return (
    <section className="space-y-6" data-machine-pairing-step="success">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-muted text-success-text">
          <Check aria-hidden="true" className="size-6" />
        </span>
        <h2 className="mt-4 text-xl font-semibold">设备已配对</h2>
        <p className="mt-2 break-words text-md text-text-secondary">
          已与 {machine.displayName} 建立设备信任。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div className="min-w-0">
          <p title={machine.displayName} className="truncate font-medium">
            {machine.displayName}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {machinePlatformLabel(machine.platform)} ·{' '}
            {machineArchitectureLabel(machine.architecture)}
          </p>
        </div>
        <StatusTag tone="ok">已配对</StatusTag>
      </div>
      <Notice tone="info">
        请结束设备上的临时配对进程，并恢复原 Node 后台服务。AI
        工具与项目是否可用会独立检查；已配对不等于可以执行。
      </Notice>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onViewDevice}>
          查看设备
        </Button>
        <Button onClick={onAddProject}>添加项目</Button>
      </div>
    </section>
  )
}
function formatPairingExpiry(value: string): string {
  const expires = new Date(value)
  return Number.isNaN(expires.getTime())
    ? '本次配对结束'
    : new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(expires)
}
