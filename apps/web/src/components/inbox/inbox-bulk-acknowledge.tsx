import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AttentionListResponse } from '@codetether/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@codetether/ui'
import { invalidateAttentionQueries } from '../../runtime/host/attention-query'
import {
  bulkAcknowledgeInboxAttention,
  type BulkAcknowledgementProgress,
  type BulkAcknowledgementResult,
  type BulkAttentionClient,
} from './inbox-actions'
import { bulkAcknowledgementCount, type InboxFilter } from './inbox-model'

interface Confirmation {
  readonly filter: InboxFilter
  readonly summary: AttentionListResponse['summary']
  readonly count: number
}

interface FilterResult {
  readonly filter: InboxFilter
  readonly outcome: BulkAcknowledgementResult
}

export function InboxBulkAcknowledge({
  client,
  enabled,
  filter,
  summary,
}: {
  readonly client: BulkAttentionClient
  readonly enabled: boolean
  readonly filter: InboxFilter
  readonly summary: AttentionListResponse['summary']
}) {
  const queryClient = useQueryClient()
  const busyGuard = useRef(false)
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BulkAcknowledgementProgress>()
  const [result, setResult] = useState<FilterResult>()
  const count = bulkAcknowledgementCount(summary, filter)

  async function confirm() {
    if (!confirmation || busyGuard.current || !enabled) return
    busyGuard.current = true
    setBusy(true)
    setProgress({ attempted: 0, total: confirmation.count })
    try {
      const completed = await bulkAcknowledgeInboxAttention(
        client,
        confirmation.filter,
        confirmation.summary,
        setProgress,
      )
      setResult({ filter: confirmation.filter, outcome: completed })
    } catch {
      setResult({
        filter: confirmation.filter,
        outcome: {
          attempted: 0,
          total: confirmation.count,
          cleared: 0,
          failed: confirmation.count,
        },
      })
    } finally {
      void invalidateAttentionQueries(queryClient).catch(() => undefined)
      busyGuard.current = false
      setBusy(false)
      setConfirmation(undefined)
    }
  }

  if (count === 0 && confirmation === undefined && result?.filter !== filter) {
    return null
  }

  return (
    <>
      {count > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!enabled || busy}
          onClick={() => {
            if (busyGuard.current) return
            setResult(undefined)
            setConfirmation({ filter, summary, count })
          }}
        >
          全部知道了
        </Button>
      ) : null}
      {result?.filter === filter ? (
        <p
          role={result.outcome.failed > 0 ? 'alert' : 'status'}
          className="w-full text-sm text-text-secondary"
        >
          已知道 {result.outcome.cleared} 项。
          {result.outcome.failed > 0
            ? `${result.outcome.failed} 项未能清除，请稍后重试。`
            : null}
        </p>
      ) : null}
      <Dialog
        open={confirmation !== undefined}
        onOpenChange={(open) => {
          if (!open && !busyGuard.current) setConfirmation(undefined)
        }}
      >
        <DialogContent className="max-w-md" closeLabel="关闭全部知道了确认">
          <DialogHeader>
            <DialogTitle>全部知道了</DialogTitle>
            <DialogDescription>
              将这 {confirmation?.count ?? 0}{' '}
              项标为“知道了”。会话和历史记录不会受到影响，等待批准的事项不会被清除。
            </DialogDescription>
          </DialogHeader>
          {busy ? (
            <p role="status" className="text-sm text-text-secondary">
              正在处理 {progress?.attempted ?? 0}/
              {progress?.total ?? confirmation?.count ?? 0} 项…
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? '正在处理…' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
