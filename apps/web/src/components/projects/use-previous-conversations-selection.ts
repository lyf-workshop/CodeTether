import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  DiscoveryCandidateId,
  ProviderSessionDiscoveryCandidate,
} from '@codetether/protocol'
import {
  createPreviousConversationSelection,
  reconcilePreviousConversationSelection,
  setPreviousConversationSelection,
  type PreviousConversationSelection,
} from './previous-conversations-selection'
import {
  maximumImportSelection,
  type CandidateActivity,
} from './previous-conversations-presentation'

export function usePreviousConversationsSelection(
  selectionScope: string,
  candidates: readonly ProviderSessionDiscoveryCandidate[],
  activity: ReadonlyMap<DiscoveryCandidateId, CandidateActivity>,
  importInFlightRef: RefObject<boolean>,
) {
  const [selectionState, setSelectionState] = useState(() => ({
    scope: selectionScope,
    value: createPreviousConversationSelection(),
  }))
  const selectionRef = useRef(selectionState)
  const currentSelection = useMemo(
    () =>
      reconcilePreviousConversationSelection(
        selectionState.scope === selectionScope
          ? selectionState.value
          : createPreviousConversationSelection(),
        candidates,
        maximumImportSelection,
      ),
    [candidates, selectionScope, selectionState],
  )
  const selected = currentSelection.selected
  const updateSelection = useCallback(
    (
      update: (
        current: PreviousConversationSelection,
      ) => PreviousConversationSelection,
    ) => {
      const current = selectionRef.current
      const next = {
        scope: selectionScope,
        value: update(
          current.scope === selectionScope
            ? current.value
            : createPreviousConversationSelection(),
        ),
      }
      selectionRef.current = next
      setSelectionState(next)
    },
    [selectionScope],
  )

  const selectable = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          !candidate.alreadyAdopted &&
          candidate.resumeStatus === 'supported' &&
          activity.get(candidate.discoveryCandidateId)?.state !== 'expired' &&
          activity.get(candidate.discoveryCandidateId)?.state !== 'failed',
      ),
    [activity, candidates],
  )
  const allVisibleSelected =
    selectable.length > 0 &&
    selectable.every((candidate) =>
      selected.has(candidate.discoveryCandidateId),
    )
  const selectionBatchFull =
    selected.size > 0 &&
    (allVisibleSelected || selected.size >= maximumImportSelection)

  function toggleCandidate(candidateId: DiscoveryCandidateId) {
    if (importInFlightRef.current) return
    updateSelection((current) => {
      const reconciled = reconcilePreviousConversationSelection(
        current,
        candidates,
        maximumImportSelection,
      )
      return setPreviousConversationSelection(
        reconciled,
        candidates,
        [candidateId],
        !reconciled.selected.has(candidateId),
        maximumImportSelection,
      )
    })
  }

  function toggleAllVisible() {
    if (importInFlightRef.current) return
    updateSelection((current) =>
      setPreviousConversationSelection(
        reconcilePreviousConversationSelection(
          current,
          candidates,
          maximumImportSelection,
        ),
        candidates,
        selectable.map((candidate) => candidate.discoveryCandidateId),
        !selectionBatchFull,
        maximumImportSelection,
      ),
    )
  }

  return {
    currentSelection,
    selected,
    selectable,
    selectionBatchFull,
    updateSelection,
    toggleCandidate,
    toggleAllVisible,
  }
}
