import {
  Bot,
  Check,
  ExternalLink,
  History,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { Button, Checkbox, DialogHeader, DialogTitle } from '@codetether/ui'
import {
  formatCandidateTime,
  maximumImportSelection,
  providerLabel,
  providerProblemText,
  scanStatusText,
} from './previous-conversations-presentation'
import type { usePreviousConversations } from './use-previous-conversations'

export function PreviousConversationsView({
  stepRef,
  scanState,
  importing,
  presentation,
  candidates,
  importedCount,
  hasSupportedProvider,
  scanNotice,
  runScan,
  providerProblems,
  grouped,
  selectable,
  selectionBatchFull,
  toggleAllVisible,
  selectionId,
  activity,
  selected,
  toggleCandidate,
  openConversation,
  nextCursor,
  importSelected,
  onFinished,
}: ReturnType<typeof usePreviousConversations>) {
  return (
    <div
      ref={stepRef}
      tabIndex={-1}
      className="min-w-0 outline-none"
      aria-busy={
        scanState === 'scanning' || scanState === 'loading-more' || importing
      }
    >
      {presentation === 'dialog' ? (
        <DialogHeader>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
          >
            <History className="size-5" />
          </span>
          <DialogTitle>以前的会话</DialogTitle>
          <p className="text-base leading-normal text-text-secondary">
            可选择此工作区中已有的 Codex 或 Claude Code 会话添加到 CodeTether。
            导入不会启动 AI 工具。
          </p>
        </DialogHeader>
      ) : (
        <div>
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
          >
            <History className="size-5" />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">
            以前的会话
          </h2>
          <p className="mt-2 text-base leading-normal text-text-secondary">
            可选择此工作区中已有的 Codex 或 Claude Code 会话添加到 CodeTether。
            导入不会启动 AI 工具，也不会发送任何提示词。
          </p>
        </div>
      )}

      <div className="mt-5 min-w-0 space-y-4">
        <p className="sr-only" role="status" aria-live="polite">
          {scanStatusText(
            scanState,
            candidates.length,
            importedCount,
            hasSupportedProvider,
          )}
        </p>

        {scanNotice ? (
          <p role="status" className="text-sm text-text-secondary">
            {scanNotice}
          </p>
        ) : null}

        {scanState === 'scanning' ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-5 text-sm text-text-secondary"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            正在查找以前的会话…
          </div>
        ) : null}

        {scanState === 'failed' ? (
          <div
            role="alert"
            className="rounded-md border border-warning/30 bg-warning-muted/35 px-4 py-3 text-sm text-text-secondary"
          >
            <p>暂时无法检查以前的会话。项目与现有会话不受影响。</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => void runScan({ append: false, rescan: true })}
            >
              <RefreshCw aria-hidden="true" />
              重试
            </Button>
          </div>
        ) : null}

        {scanState !== 'scanning' && providerProblems.length > 0 ? (
          <div className="space-y-2" aria-label="部分 AI 工具不可用">
            {providerProblems.map((provider) => (
              <p
                key={provider.provider}
                role="status"
                className="rounded-sm border border-warning/30 bg-warning-muted/35 px-3 py-2 text-sm text-text-secondary"
              >
                {providerProblemText(provider)}
              </p>
            ))}
          </div>
        ) : null}

        {scanState === 'ready' &&
        candidates.length === 0 &&
        hasSupportedProvider ? (
          <div
            role="status"
            className="rounded-md border border-border bg-surface-muted px-4 py-5 text-center"
          >
            <p className="text-sm font-medium text-text-primary">
              未找到以前的会话
            </p>
            <p className="mt-1 text-xs text-text-muted">
              你仍可立即打开项目并创建新会话。
            </p>
          </div>
        ) : null}

        {scanState !== 'scanning' && grouped.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-text-muted">
                已找到 {candidates.length} 个会话
              </p>
              {selectable.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={importing}
                  onClick={toggleAllVisible}
                >
                  {selectionBatchFull
                    ? '取消当前选择'
                    : selectable.length > maximumImportSelection
                      ? `最多选择 ${maximumImportSelection} 项`
                      : '选择当前结果'}
                </Button>
              ) : null}
            </div>

            <div className="max-h-[min(42vh,22rem)] space-y-4 overflow-y-auto pr-1">
              {grouped.map((group) => (
                <section
                  key={group.provider}
                  aria-labelledby={`previous-${group.provider}`}
                >
                  <h3
                    id={`previous-${group.provider}`}
                    className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary"
                  >
                    <Bot aria-hidden="true" className="size-4 text-primary" />
                    {providerLabel(group.provider)}
                    <span className="font-normal text-text-muted">
                      {group.candidates.length}
                    </span>
                  </h3>
                  <div className="overflow-hidden rounded-md border border-border">
                    {group.candidates.map((candidate, index) => {
                      const candidateActivity = activity.get(
                        candidate.discoveryCandidateId,
                      )?.state
                      const selectableCandidate =
                        !candidate.alreadyAdopted &&
                        candidate.resumeStatus === 'supported' &&
                        candidateActivity !== 'expired' &&
                        candidateActivity !== 'failed'
                      return (
                        <div
                          key={candidate.discoveryCandidateId}
                          className={`flex min-w-0 items-center gap-3 px-3 py-2.5 ${
                            index === 0 ? '' : 'border-t border-border'
                          }`}
                        >
                          {selectableCandidate ? (
                            <Checkbox
                              id={`${selectionId}-${candidate.discoveryCandidateId}`}
                              checked={selected.has(
                                candidate.discoveryCandidateId,
                              )}
                              disabled={
                                importing ||
                                (selected.size >= maximumImportSelection &&
                                  !selected.has(candidate.discoveryCandidateId))
                              }
                              aria-label={`选择 ${candidate.title}`}
                              onCheckedChange={() =>
                                toggleCandidate(candidate.discoveryCandidateId)
                              }
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid size-4 shrink-0 place-items-center"
                            >
                              {candidate.alreadyAdopted ? (
                                <Check className="size-4 text-success-text" />
                              ) : null}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <label
                              htmlFor={
                                selectableCandidate
                                  ? `${selectionId}-${candidate.discoveryCandidateId}`
                                  : undefined
                              }
                              className="block truncate text-sm font-medium text-text-primary"
                            >
                              {candidate.title}
                            </label>
                            <span
                              className="mt-0.5 block text-xs text-text-muted"
                              role={
                                candidateActivity === 'expired' ||
                                candidateActivity === 'failed'
                                  ? 'alert'
                                  : undefined
                              }
                            >
                              {candidateActivity === 'expired'
                                ? '会话已发生变化，请重新扫描'
                                : candidateActivity === 'failed'
                                  ? '无法导入此会话，请重新扫描后重试'
                                  : candidate.alreadyAdopted
                                    ? '已在 CodeTether 中'
                                    : candidate.resumeStatus === 'supported'
                                      ? formatCandidateTime(candidate)
                                      : '当前只能查看，无法继续'}
                            </span>
                          </span>
                          {candidateActivity === 'importing' ? (
                            <LoaderCircle
                              aria-label="正在导入"
                              className="size-4 animate-spin text-primary motion-reduce:animate-none"
                            />
                          ) : null}
                          {candidate.alreadyAdopted &&
                          candidate.conversationId !== undefined ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={importing}
                              onClick={() =>
                                void openConversation(candidate.conversationId!)
                              }
                            >
                              打开
                              <ExternalLink aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {nextCursor !== undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={scanState === 'loading-more' || importing}
                  onClick={() => void runScan({ append: true, rescan: false })}
                >
                  {scanState === 'loading-more' ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  加载更多
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={scanState === 'loading-more' || importing}
                onClick={() => void runScan({ append: false, rescan: true })}
              >
                <RefreshCw aria-hidden="true" />
                重新扫描
              </Button>
            </div>
            {selectable.length > maximumImportSelection ? (
              <p className="text-xs text-text-muted">
                为保持导入操作有界，每次最多选择 {maximumImportSelection}{' '}
                个会话。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={
          presentation === 'dialog'
            ? 'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
            : 'mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4'
        }
      >
        {presentation !== 'embedded' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={importing}
            onClick={() =>
              void onFinished(importedCount > 0 ? 'reviewed' : 'skipped')
            }
          >
            {importedCount > 0 ? '完成' : '跳过'}
          </Button>
        ) : null}
        {selected.size > 0 ? (
          <Button
            size="sm"
            disabled={importing || scanState !== 'ready'}
            onClick={() => void importSelected()}
          >
            {importing ? '正在导入…' : `导入所选（${selected.size}）`}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
