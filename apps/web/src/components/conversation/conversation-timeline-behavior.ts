export type TimelineUpdateKind =
  'initial' | 'content' | 'approval' | 'viewport-resize'

export interface TimelineViewportMetrics {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

export interface TimelineScrollDecision {
  readonly followsLatest: boolean
  readonly showJumpToLatest: boolean
  readonly scrollTop?: number
}

/** One product target may be requested repeatedly by distinct navigations. */
export function createTimelineAnchorRequestKey(
  identity: string | undefined,
  requestIdentity: string | number | undefined,
): string | undefined {
  if (identity === undefined) return undefined
  return `${requestIdentity ?? 'direct'}:${identity}`
}

export function timelineContainsTurn(
  blocks: readonly { readonly turnId: string }[],
  turnId: string | undefined,
): boolean {
  return turnId === undefined || blocks.some((block) => block.turnId === turnId)
}

export function decideTimelineScroll({
  followsLatest,
  viewport,
}: {
  readonly followsLatest: boolean
  readonly update: TimelineUpdateKind
  readonly waiting: boolean
  readonly viewport: TimelineViewportMetrics
}): TimelineScrollDecision {
  if (followsLatest) {
    return {
      followsLatest: true,
      showJumpToLatest: false,
      scrollTop: viewport.scrollHeight,
    }
  }

  return {
    followsLatest: false,
    showJumpToLatest: true,
  }
}

export type ApprovalFocusLocation =
  | { readonly kind: 'composer' }
  | { readonly kind: 'approval'; readonly approvalId: string }
  | { readonly kind: 'other' }

export type ApprovalFocusTarget =
  | { readonly kind: 'approval'; readonly approvalId: string }
  | { readonly kind: 'composer' }
  | { readonly kind: 'timeline' }

/**
 * Returns a focus target only for the two semantic transitions that warrant
 * moving focus: the first Approval replacing an active Composer, or removal
 * of the exact Approval whose control initiated resolution.
 */
export function getApprovalFocusTarget({
  previousApprovalIds,
  nextApprovalIds,
  active,
  resolutionOriginApprovalId,
  composerEditable,
}: {
  readonly previousApprovalIds: readonly string[]
  readonly nextApprovalIds: readonly string[]
  readonly active: ApprovalFocusLocation
  readonly resolutionOriginApprovalId?: string
  readonly composerEditable: boolean
}): ApprovalFocusTarget | undefined {
  if (
    previousApprovalIds.length === 0 &&
    nextApprovalIds.length > 0 &&
    active.kind === 'composer'
  ) {
    return { kind: 'approval', approvalId: nextApprovalIds[0] as string }
  }

  if (
    resolutionOriginApprovalId === undefined ||
    active.kind !== 'approval' ||
    active.approvalId !== resolutionOriginApprovalId ||
    nextApprovalIds.includes(resolutionOriginApprovalId)
  ) {
    return undefined
  }

  const previousIndex = previousApprovalIds.indexOf(resolutionOriginApprovalId)
  if (previousIndex < 0) return undefined

  if (nextApprovalIds.length > 0) {
    const nextIndex = Math.min(previousIndex, nextApprovalIds.length - 1)
    return {
      kind: 'approval',
      approvalId: nextApprovalIds[nextIndex] as string,
    }
  }

  return composerEditable ? { kind: 'composer' } : { kind: 'timeline' }
}
