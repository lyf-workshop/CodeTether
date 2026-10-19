import { FolderOpen, LockKeyhole, Monitor } from 'lucide-react'
import {
  AgentIdentityMark,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  cn,
} from '@codetether/ui'
import type { ProviderId } from '@codetether/protocol'
import type {
  ConversationCreationProviderOption,
  ConversationProjectChoice,
  ConversationProjectGroup,
} from './new-conversation-selection'

interface NewConversationFieldsProps {
  groups: readonly ConversationProjectGroup[]
  project?: ConversationProjectChoice
  fixed: boolean
  loading: boolean
  busy: boolean
  providerOptions: readonly ConversationCreationProviderOption[]
  selectedProvider?: ConversationCreationProviderOption
  reasoning?: string
  defaultReasoning: string
  formId: string
  onProjectChange: (key: string) => void
  onProviderChange: (provider: ProviderId) => void
  onReasoningChange: (reasoning: string) => void
}

/** Presentation-only fields, also rendered directly in accessibility checks. */
export function NewConversationFields({
  groups,
  project,
  fixed,
  loading,
  busy,
  providerOptions,
  selectedProvider,
  reasoning,
  defaultReasoning,
  formId,
  onProjectChange,
  onProviderChange,
  onReasoningChange,
}: NewConversationFieldsProps) {
  const presentation = selectedProvider?.provider
  const supportsReasoning =
    presentation?.capabilities.reasoningControl === true &&
    presentation.reasoningOptions.length > 0
  const projectEligible =
    project !== undefined && project.unavailableReason === undefined
  const restriction =
    project?.machine?.kind !== 'remote' || presentation === undefined
      ? undefined
      : !presentation.capabilities.interrupt &&
          !presentation.capabilities.approvals
        ? '这里不能停止或审批命令。'
        : !presentation.capabilities.interrupt
          ? '这里不能停止会话。'
          : !presentation.capabilities.approvals
            ? '这里不能审批命令。'
            : undefined

  return (
    <div className="space-y-5">
      <section aria-labelledby={formId + '-project-label'}>
        <h3
          id={formId + '-project-label'}
          className="text-sm font-medium text-text-primary"
        >
          项目
        </h3>
        {fixed && project !== undefined ? (
          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-sm border border-border-strong bg-surface px-3 py-2.5">
            <FolderOpen
              aria-hidden="true"
              className="size-4 shrink-0 text-text-muted"
            />
            <span
              className="min-w-0 flex-1 truncate text-sm"
              title={project.project.name}
            >
              {project.project.name}
            </span>
            <LockKeyhole
              aria-label="当前项目已固定"
              className="size-3.5 shrink-0 text-text-muted"
            />
          </div>
        ) : (
          <Select
            value={project?.key ?? ''}
            onValueChange={onProjectChange}
            disabled={loading || busy}
          >
            <SelectTrigger
              className="mt-2"
              aria-label="选择项目"
              aria-describedby={formId + '-project-context'}
            >
              <SelectValue
                placeholder={loading ? '正在读取项目…' : '请选择项目所在设备'}
              >
                {project?.project.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.machineId}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.choices.map((choice) => (
                    <SelectItem
                      key={choice.key}
                      value={choice.key}
                      disabled={choice.unavailableReason !== undefined}
                      textValue={
                        choice.project.name +
                        ' · ' +
                        group.label +
                        ' · ' +
                        choice.location.rootPath
                      }
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate">
                          {choice.project.name}
                          {choice.unavailableReason === undefined
                            ? ''
                            : '（' + choice.unavailableReason + '）'}
                        </span>
                        <span
                          className="truncate font-mono text-xs text-text-muted"
                          title={choice.location.rootPath}
                        >
                          {choice.location.rootPath}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}
        <p
          id={formId + '-project-context'}
          className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-text-muted"
        >
          <Monitor aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0">
            {project?.machine?.displayName ??
              (loading ? '正在读取设备…' : '请选择设备上的项目')}
          </span>
          {project === undefined ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="min-w-0 truncate font-mono"
                title={project.location.rootPath}
              >
                {project.location.rootPath}
              </span>
            </>
          )}
        </p>
      </section>

      {projectEligible ? (
        <fieldset disabled={busy} aria-describedby={formId + '-tool-context'}>
          <legend className="text-sm font-medium text-text-primary">
            AI 工具
          </legend>
          {providerOptions.length === 0 ? (
            <p role="status" className="mt-2 text-sm text-text-muted">
              {loading
                ? '正在读取 AI 工具…'
                : '这台设备当前没有可用的 AI 工具。'}
            </p>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {providerOptions.map((option) => {
                const provider = option.provider
                const selected = provider.provider === presentation?.provider
                const description = !option.eligibility.eligible
                  ? option.eligibility.label
                  : provider.capabilities.fileEdit &&
                      provider.capabilities.shell
                    ? '可以编辑文件和运行命令'
                    : provider.capabilities.fileRead ||
                        provider.capabilities.search
                      ? '可以读取和搜索文件'
                      : '可恢复的流式会话'
                return (
                  <label key={provider.provider} className="min-w-0">
                    <input
                      type="radio"
                      name={formId + '-provider'}
                      value={provider.provider}
                      checked={selected}
                      disabled={
                        busy || !projectEligible || !option.eligibility.eligible
                      }
                      onChange={() => onProviderChange(provider.provider)}
                      aria-describedby={
                        formId + '-provider-' + provider.provider
                      }
                      className="peer sr-only"
                    />
                    <span
                      data-state={selected ? 'selected' : undefined}
                      className={cn(
                        'flex min-h-20 items-center gap-3 rounded-md border bg-surface px-3 py-3 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60',
                        selected
                          ? 'border-ring bg-primary-muted'
                          : 'border-border',
                        !option.eligibility.eligible
                          ? 'opacity-50'
                          : 'cursor-pointer hover:border-border-strong',
                      )}
                    >
                      <AgentIdentityMark
                        agent={provider.agent}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-text-primary">
                          {provider.displayName}
                        </span>
                        <span
                          id={formId + '-provider-' + provider.provider}
                          className="mt-0.5 block text-xs text-text-muted"
                        >
                          {description}
                        </span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          <p
            id={formId + '-tool-context'}
            className="mt-2 text-xs text-text-muted"
          >
            {restriction === undefined
              ? '会话创建后固定在这个项目和 AI 工具上，不能切换。'
              : '在 ' +
                (project?.machine?.displayName ?? '配对设备') +
                ' 上运行时，' +
                restriction}
          </p>
        </fieldset>
      ) : null}

      {projectEligible && supportsReasoning ? (
        <section aria-labelledby={formId + '-reasoning-label'}>
          <h3
            id={formId + '-reasoning-label'}
            className="text-sm font-medium text-text-primary"
          >
            {presentation.reasoningLabel}
          </h3>
          <Select
            value={reasoning ?? defaultReasoning}
            onValueChange={onReasoningChange}
            disabled={
              busy ||
              !projectEligible ||
              selectedProvider?.eligibility.eligible !== true
            }
          >
            <SelectTrigger
              className="mt-2"
              aria-label={'选择' + presentation.reasoningLabel}
            >
              <SelectValue placeholder="默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={defaultReasoning}>默认</SelectItem>
              {presentation.reasoningOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-text-muted">
            “默认”使用 {presentation.displayName} 自己的设置。
          </p>
        </section>
      ) : null}
    </div>
  )
}
