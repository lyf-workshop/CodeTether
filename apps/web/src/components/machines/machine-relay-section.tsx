import { useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Cloud,
  CloudOff,
  KeyRound,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Unplug,
} from 'lucide-react'

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
  Input,
  Separator,
  cn,
} from '@codetether/ui'
import {
  RelayEnrollmentTokenSchema,
  type MachineSummary,
  type RelayMachineConnectivity,
  type RelayTransportSecurity,
} from '@codetether/protocol'

import { canonicalFailureActionPresentation } from '../../failures/failure-presentation'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { relayErrorMessage } from '../../runtime/host/relay-actions'
import { formatMachineLastSeen } from './machine-presentation'
import {
  parseRelayConfigurationInput,
  relayCanRetry,
  relayConnectivityPresentation,
  relayEndpointLabel,
  relayNodePresenceLabel,
  relayStatusTone,
} from './machine-relay-presentation'

interface MachineRelaySectionProps {
  readonly hostReady: boolean
  readonly machine: MachineSummary
  readonly relay: RelayMachineConnectivity | undefined
}

export function MachineRelaySection({
  hostReady,
  machine,
  relay,
}: MachineRelaySectionProps) {
  const runtime = useHostRuntime()
  const configurationTriggerRef = useRef<HTMLButtonElement>(null)
  const enrollmentTriggerRef = useRef<HTMLButtonElement>(null)
  const removeTriggerRef = useRef<HTMLButtonElement>(null)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [enrollmentOpen, setEnrollmentOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const retryMutation = useMutation({
    mutationFn: () => runtime.retryMachineRelay(machine.machineId),
  })
  const disconnectMutation = useMutation({
    mutationFn: () => runtime.disconnectMachineRelay(machine.machineId),
  })
  const removeMutation = useMutation({
    mutationFn: () => runtime.removeMachineRelay(machine.machineId),
  })
  const status = relayConnectivityPresentation(relay?.state ?? 'not_configured')
  const busy =
    retryMutation.isPending ||
    disconnectMutation.isPending ||
    removeMutation.isPending
  const operationError =
    retryMutation.error ?? disconnectMutation.error ?? removeMutation.error

  return (
    <section
      className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5"
      aria-labelledby="machine-relay-heading"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2
              id="machine-relay-heading"
              className="text-section font-semibold text-text-primary"
            >
              Internet Relay
            </h2>
            <Badge variant={relayStatusBadgeVariant(status.tone)}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            出站加密连接，用于授权会合和受限的 Machine 传输。
          </p>
        </div>
        <Button
          ref={configurationTriggerRef}
          variant="secondary"
          size="sm"
          disabled={!hostReady || busy}
          onClick={() => setConfigurationOpen(true)}
        >
          <Settings2 aria-hidden="true" />
          {relay === undefined || relay.state === 'not_configured'
            ? '配置 Relay'
            : '更新设置'}
        </Button>
      </div>

      <Separator className="my-4" />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)]">
        <div className="flex min-w-0 items-start gap-3">
          {status.tone === 'success' ? (
            <Cloud
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
          ) : (
            <CloudOff
              aria-hidden="true"
              className={cn(
                'mt-0.5 size-4 shrink-0',
                relayStatusTone(status.tone),
              )}
            />
          )}
          <div className="min-w-0">
            <p
              role="status"
              className={cn(
                'text-sm font-medium',
                relayStatusTone(status.tone),
              )}
            >
              Relay {status.label}
            </p>
            <p className="mt-1 break-words text-sm leading-relaxed text-text-secondary">
              {status.description}
            </p>
            {relay?.failure === undefined ? null : (
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {
                  canonicalFailureActionPresentation(relay.failure, {
                    machineDisplayName: machine.displayName,
                  }).guidance
                }
              </p>
            )}
          </div>
        </div>

        <dl className="min-w-0 space-y-2.5 text-sm">
          <RelayMetadata
            label="Node 在线状态"
            value={relayNodePresenceLabel(
              relay?.nodePresence ?? 'not_observed',
            )}
          />
          <RelayMetadata
            label="Internet 执行"
            value={
              relay?.internetExecutionEnabled === true
                ? '可用（按需选择）'
                : '当前不可用'
            }
          />
          {relay?.displayLabel === undefined ? null : (
            <RelayMetadata label="Relay" value={relay.displayLabel} />
          )}
          {relay?.endpoint === undefined ? null : (
            <RelayMetadata
              label="端点"
              value={relayEndpointLabel(relay.endpoint)}
              monospace
            />
          )}
          {relay?.lastConnectedAt === undefined ? null : (
            <RelayMetadata
              label="最近连接"
              value={formatMachineLastSeen(relay.lastConnectedAt) ?? '暂无'}
            />
          )}
        </dl>
      </div>

      <div className="mt-4 flex min-w-0 items-start gap-2.5 rounded-sm border border-warning/30 bg-warning-muted px-3 py-3 text-sm text-text-secondary">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
        <p className="min-w-0 leading-relaxed">
          {relay?.internetExecutionEnabled === true
            ? '当已验证的直连不可用时，新请求可以使用 Internet Relay。活动中的请求不会在直连与 Relay 之间迁移；Relay 在线也不单独代表项目位置或智能体可执行。'
            : 'Internet Relay 当前不能承载新的 Machine 执行。Relay 在线状态本身不代表机器、项目位置或智能体可执行。'}
        </p>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-2">
        {relay?.enrollment === 'required' || relay?.enrollment === 'revoked' ? (
          <Button
            ref={enrollmentTriggerRef}
            size="sm"
            disabled={!hostReady || busy}
            onClick={() => setEnrollmentOpen(true)}
          >
            <KeyRound aria-hidden="true" />
            {relay.enrollment === 'revoked'
              ? '使用新令牌重新注册'
              : '使用一次性令牌注册'}
          </Button>
        ) : null}
        {relay !== undefined && relayCanRetry(relay) ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!hostReady || busy}
            onClick={() => retryMutation.mutate()}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                retryMutation.isPending &&
                  'animate-spin motion-reduce:animate-none',
              )}
            />
            {retryMutation.isPending ? '正在连接…' : '重试连接'}
          </Button>
        ) : null}
        {relay?.state === 'connected' || relay?.state === 'reconnecting' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!hostReady || busy}
            onClick={() => disconnectMutation.mutate()}
          >
            <Unplug aria-hidden="true" />
            {disconnectMutation.isPending ? '正在断开…' : '断开'}
          </Button>
        ) : null}
        {relay !== undefined && relay.state !== 'not_configured' ? (
          <Button
            ref={removeTriggerRef}
            variant="ghost"
            size="sm"
            disabled={!hostReady || busy}
            onClick={() => setRemoveOpen(true)}
          >
            移除 Relay 配置
          </Button>
        ) : null}
      </div>

      {operationError === null || operationError === undefined ? null : (
        <p
          role="alert"
          className="mt-3 break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {relayErrorMessage(operationError)}
        </p>
      )}

      {relay === undefined || relay.state === 'not_configured' ? null : (
        <details className="mt-4 min-w-0 border-t border-border pt-4 text-xs text-text-muted">
          <summary className="w-fit cursor-pointer rounded-xs font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            技术详情
          </summary>
          <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            <RelayMetadata label="连接状态" value={relay.state} monospace />
            <RelayMetadata
              label="注册状态"
              value={relay.enrollment}
              monospace
            />
            <RelayMetadata
              label="Relay 身份指纹"
              value={relay.relayIdentityFingerprint ?? '未提供'}
              monospace
              wrap
            />
            <RelayMetadata
              label="诊断代码"
              value={relay.failure?.technicalCode ?? '无'}
              monospace
            />
            <RelayMetadata
              label="Machine 传输"
              value={
                relay.internetExecutionEnabled ? 'eligible' : 'unavailable'
              }
              monospace
            />
          </dl>
        </details>
      )}

      {configurationOpen ? (
        <ConfigureRelayDialog
          machine={machine}
          relay={relay}
          open
          onOpenChange={(open) => {
            setConfigurationOpen(open)
            if (!open) restoreRelayDialogTrigger(configurationTriggerRef)
          }}
        />
      ) : null}
      {enrollmentOpen ? (
        <EnrollRelayDialog
          machine={machine}
          reenrollment={relay?.enrollment === 'revoked'}
          open
          onOpenChange={(open) => {
            setEnrollmentOpen(open)
            if (!open) restoreRelayDialogTrigger(enrollmentTriggerRef)
          }}
        />
      ) : null}
      {removeOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            setRemoveOpen(open)
            if (!open) restoreRelayDialogTrigger(removeTriggerRef)
          }}
        >
          <DialogContent
            className="max-w-md overflow-x-hidden"
            closeLabel="关闭移除 Relay 配置对话框"
            showCloseButton={!removeMutation.isPending}
          >
            <DialogHeader>
              <DialogTitle>移除 Relay 配置？</DialogTitle>
              <DialogDescription>
                这只会从 CodeTether Desktop
                移除这台机器的本地配置并断开控制连接。机器配对信任不会改变；Relay
                端的基础设施撤销仍由 Relay 操作员单独管理。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={removeMutation.isPending}
                >
                  取消
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                size="sm"
                disabled={removeMutation.isPending}
                onClick={() =>
                  removeMutation.mutate(undefined, {
                    onSuccess: () => setRemoveOpen(false),
                  })
                }
              >
                {removeMutation.isPending ? '正在移除…' : '确认移除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}

function ConfigureRelayDialog({
  machine,
  onOpenChange,
  open,
  relay,
}: {
  readonly machine: MachineSummary
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly relay: RelayMachineConnectivity | undefined
}) {
  const runtime = useHostRuntime()
  const hostRef = useRef<HTMLInputElement>(null)
  const [host, setHost] = useState(() => relay?.endpoint?.host ?? '')
  const [port, setPort] = useState(() => String(relay?.endpoint?.port ?? 443))
  const [transportSecurity, setTransportSecurity] =
    useState<RelayTransportSecurity>(
      () => relay?.endpoint?.transportSecurity ?? 'public_ca',
    )
  const [fingerprint, setFingerprint] = useState(
    () => relay?.relayIdentityFingerprint ?? '',
  )
  const [displayLabel, setDisplayLabel] = useState(
    () => relay?.displayLabel ?? '',
  )
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = parseRelayConfigurationInput({
        host,
        port,
        transportSecurity,
        relayIdentityFingerprint: fingerprint,
        displayLabel,
      })
      if (parsed === undefined || !identityConfirmed) {
        throw new RelayConfigurationInputError()
      }
      return runtime.configureMachineRelay(machine.machineId, parsed)
    },
    onSuccess: () => onOpenChange(false),
  })

  function reset(nextOpen: boolean) {
    setHost(nextOpen ? (relay?.endpoint?.host ?? '') : '')
    setPort(nextOpen ? String(relay?.endpoint?.port ?? 443) : '443')
    setTransportSecurity(
      nextOpen
        ? (relay?.endpoint?.transportSecurity ?? 'public_ca')
        : 'public_ca',
    )
    setFingerprint(nextOpen ? (relay?.relayIdentityFingerprint ?? '') : '')
    setDisplayLabel(nextOpen ? (relay?.displayLabel ?? '') : '')
    setIdentityConfirmed(false)
    setValidationError('')
    mutation.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && mutation.isPending) return
    reset(nextOpen)
    onOpenChange(nextOpen)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending) return
    const parsed = parseRelayConfigurationInput({
      host,
      port,
      transportSecurity,
      relayIdentityFingerprint: fingerprint,
      displayLabel,
    })
    if (parsed === undefined) {
      setValidationError('请输入有效的 Relay 主机、端口和 43 字符身份指纹。')
      return
    }
    if (!identityConfirmed) {
      setValidationError('请先确认已通过可信渠道核对 Relay 身份指纹。')
      return
    }
    setValidationError('')
    mutation.reset()
    mutation.mutate()
  }

  const error =
    validationError ||
    (mutation.isError ? relayErrorMessage(mutation.error) : '')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg overflow-x-hidden"
        closeLabel="关闭 Relay 配置对话框"
        showCloseButton={!mutation.isPending}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          hostRef.current?.focus()
        }}
      >
        <form className="min-w-0" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>配置 Internet Relay</DialogTitle>
            <DialogDescription>
              为“{machine.displayName}”设置 Controller 的出站 Relay 控制连接。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 min-w-0 space-y-4">
            <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <RelayInput
                inputRef={hostRef}
                id="relay-host"
                label="Relay 主机"
                value={host}
                placeholder="relay.example.com"
                maxLength={253}
                onChange={setHost}
                disabled={mutation.isPending}
              />
              <RelayInput
                id="relay-port"
                label="端口"
                value={port}
                placeholder="443"
                inputMode="numeric"
                maxLength={5}
                onChange={setPort}
                disabled={mutation.isPending}
              />
            </div>

            <div>
              <label
                htmlFor="relay-transport-security"
                className="text-sm font-medium text-text-primary"
              >
                TLS 验证
              </label>
              <select
                id="relay-transport-security"
                className="mt-2 h-9 w-full rounded-sm border border-input bg-surface px-3 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                value={transportSecurity}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setTransportSecurity(
                    event.target.value as RelayTransportSecurity,
                  )
                  setValidationError('')
                  mutation.reset()
                }}
              >
                <option value="public_ca">公共 CA 证书</option>
                <option value="pinned_identity">固定 Relay 身份</option>
              </select>
            </div>

            <RelayInput
              id="relay-display-label"
              label="显示名称（可选）"
              value={displayLabel}
              placeholder="Owner Relay"
              maxLength={120}
              onChange={setDisplayLabel}
              disabled={mutation.isPending}
            />
            <RelayInput
              id="relay-identity-fingerprint"
              label="Relay 身份指纹"
              value={fingerprint}
              placeholder="43 字符指纹"
              maxLength={43}
              onChange={setFingerprint}
              disabled={mutation.isPending}
              describedBy="relay-identity-help"
            />
            <p
              id="relay-identity-help"
              className="text-xs leading-relaxed text-text-muted"
            >
              指纹用于验证 Relay 的应用身份，独立于域名、IP 和 TLS 证书。
            </p>
            <label className="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-sm border border-border bg-surface-muted/55 px-3 py-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={identityConfirmed}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setIdentityConfirmed(event.target.checked)
                  setValidationError('')
                }}
              />
              <span className="min-w-0 leading-relaxed">
                我已通过可信渠道核对此 Relay
                身份指纹。身份不匹配时不得替换现有信任。
              </span>
            </label>

            {error ? (
              <p
                id="relay-configuration-error"
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
                disabled={mutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? '正在验证…' : '验证并保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EnrollRelayDialog({
  machine,
  onOpenChange,
  open,
  reenrollment,
}: {
  readonly machine: MachineSummary
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly reenrollment: boolean
}) {
  const runtime = useHostRuntime()
  const tokenRef = useRef<HTMLInputElement>(null)
  const [token, setToken] = useState('')
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = RelayEnrollmentTokenSchema.safeParse(token)
      if (!parsed.success) throw new RelayEnrollmentInputError()
      setToken('')
      return runtime.enrollMachineRelay(machine.machineId, parsed.data)
    },
    onSuccess: () => onOpenChange(false),
  })

  function clear() {
    setToken('')
    setValidationError('')
    mutation.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && mutation.isPending) return
    clear()
    onOpenChange(nextOpen)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending) return
    if (!RelayEnrollmentTokenSchema.safeParse(token).success) {
      setValidationError('请输入 Relay 操作员提供的有效一次性注册令牌。')
      return
    }
    setValidationError('')
    mutation.reset()
    mutation.mutate()
  }

  const error =
    validationError ||
    (mutation.isError ? relayErrorMessage(mutation.error) : '')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md overflow-x-hidden"
        closeLabel="关闭 Relay 注册对话框"
        showCloseButton={!mutation.isPending}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          tokenRef.current?.focus()
        }}
      >
        <form className="min-w-0" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {reenrollment ? '重新注册 Internet Relay' : '注册 Internet Relay'}
            </DialogTitle>
            <DialogDescription>
              {reenrollment
                ? '撤销后的普通重连仍会被拒绝。只有 Relay 操作员签发的新一次性令牌才能重新注册同一 Controller 身份；机器配对信任不会改变。'
                : '此令牌仅用于将现有 Controller 身份注册到 Relay，不会创建机器信任。'}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 min-w-0 space-y-4">
            <label
              htmlFor="relay-enrollment-token"
              className="text-sm font-medium text-text-primary"
            >
              一次性注册令牌
            </label>
            <Input
              ref={tokenRef}
              id="relay-enrollment-token"
              type="password"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={token}
              maxLength={56}
              disabled={mutation.isPending}
              aria-describedby="relay-enrollment-help"
              aria-errormessage={error ? 'relay-enrollment-error' : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setToken(event.target.value)
                setValidationError('')
                mutation.reset()
              }}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget
                if (
                  !(nextTarget instanceof HTMLElement) ||
                  nextTarget.closest('form') !== event.currentTarget.form
                ) {
                  setToken('')
                }
              }}
              className="font-mono text-sm"
            />
            <p
              id="relay-enrollment-help"
              className="text-xs leading-relaxed text-text-muted"
            >
              CodeTether 在提交后立即清除此字段，不会把令牌保存到浏览器、URL
              或普通 Web 状态。
            </p>
            {error ? (
              <p
                id="relay-enrollment-error"
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
                disabled={mutation.isPending}
              >
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? '正在注册…' : '提交一次性令牌'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RelayInput({
  describedBy,
  disabled,
  id,
  inputMode,
  inputRef,
  label,
  maxLength,
  onChange,
  placeholder,
  value,
}: {
  readonly describedBy?: string
  readonly disabled: boolean
  readonly id: string
  readonly inputMode?: 'numeric'
  readonly inputRef?: React.Ref<HTMLInputElement>
  readonly label: string
  readonly maxLength?: number
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly value: string
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-w-0 font-mono text-sm"
      />
    </div>
  )
}

function RelayMetadata({
  label,
  monospace = false,
  value,
  wrap = false,
}: {
  readonly label: string
  readonly monospace?: boolean
  readonly value: string
  readonly wrap?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd
        title={value}
        className={cn(
          'mt-1 text-text-primary',
          monospace && 'font-mono text-xs',
          wrap ? 'break-all' : 'truncate',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function relayStatusBadgeVariant(
  tone: ReturnType<typeof relayConnectivityPresentation>['tone'],
): 'default' | 'secondary' | 'success' | 'warning' | 'danger' {
  switch (tone) {
    case 'success':
      return 'success'
    case 'warning':
    case 'progress':
      return 'warning'
    case 'danger':
      return 'danger'
    case 'neutral':
      return 'secondary'
  }
}

class RelayConfigurationInputError extends Error {}
class RelayEnrollmentInputError extends Error {}

function restoreRelayDialogTrigger(
  trigger: React.RefObject<HTMLButtonElement | null>,
): void {
  requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
}
