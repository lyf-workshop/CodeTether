import { Input, SettingsRow, Switch, cn } from '@codetether/ui'

export interface ConversationSettingsLocation {
  machineName: string
  projectName: string
  rootPath: string
  providerName: string
}

export interface ConversationSettingsFieldsProps {
  conversationId: string
  title: string
  pinned: boolean
  archived: boolean
  pending: boolean
  archiveBlockedReason?: string
  location?: ConversationSettingsLocation
  locationMessage?: string
  error?: string
  onTitleChange: (title: string) => void
  onPinChange: () => void
  onArchiveChange: () => void
}

/** Controlled fields only: all organization facts come from accepted queries. */
export function ConversationSettingsFields({
  conversationId,
  title,
  pinned,
  archived,
  pending,
  archiveBlockedReason,
  location,
  locationMessage = '正在读取位置…',
  error,
  onTitleChange,
  onPinChange,
  onArchiveChange,
}: ConversationSettingsFieldsProps) {
  return (
    <div className="mt-5 min-w-0 space-y-5">
      <div>
        <label
          htmlFor={`conversation-title-${conversationId}`}
          className="text-sm font-medium text-text-primary"
        >
          名称
        </label>
        <Input
          autoFocus
          id={`conversation-title-${conversationId}`}
          value={title}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={`conversation-title-count-${conversationId}${error === undefined ? '' : ` conversation-title-error-${conversationId}`}`}
          className="mt-2"
          disabled={pending}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <p
          id={`conversation-title-count-${conversationId}`}
          className={cn(
            'mt-1 text-right text-xs tabular-nums text-text-muted',
            title.length > 240 && 'text-danger',
          )}
        >
          {title.length} / 240
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium text-text-primary">位置</p>
        {location === undefined ? (
          <p role="status" className="text-sm text-text-muted">
            {locationMessage}
          </p>
        ) : (
          <>
            <div className="min-w-0 rounded-md border border-border bg-surface-inset px-3 py-2 font-mono text-sm break-all text-text-primary">
              {location.machineName} · {location.projectName}
              <br />
              {location.rootPath}
            </div>
            <p className="text-sm text-text-muted">
              会话创建后固定在这个项目文件夹和 {location.providerName}{' '}
              上，不能移动。
            </p>
          </>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <SettingsRow
          title="置顶"
          description={
            archived ? '已归档的会话不能置顶。' : '在侧栏和项目中显示在最上面。'
          }
          control={
            <Switch
              aria-label="置顶会话"
              checked={pinned}
              disabled={pending || archived}
              onCheckedChange={onPinChange}
            />
          }
        />
        <SettingsRow
          title="归档"
          description={
            archiveBlockedReason ??
            '从列表中隐藏，可在项目的“已归档”中找回。归档会取消置顶。'
          }
          control={
            <Switch
              aria-label="归档会话"
              checked={archived}
              disabled={pending || archiveBlockedReason !== undefined}
              aria-describedby={
                archiveBlockedReason === undefined
                  ? undefined
                  : `settings-archive-reason-${conversationId}`
              }
              onCheckedChange={onArchiveChange}
            />
          }
        />
        {archiveBlockedReason === undefined ? null : (
          <p
            id={`settings-archive-reason-${conversationId}`}
            className="sr-only"
          >
            {archiveBlockedReason}
          </p>
        )}
      </div>
      {error === undefined ? null : (
        <p
          id={`conversation-title-error-${conversationId}`}
          role="alert"
          className="rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </div>
  )
}
