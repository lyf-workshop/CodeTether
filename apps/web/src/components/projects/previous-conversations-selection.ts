import type {
  DiscoveryCandidateId,
  ProviderSessionDiscoveryCandidate,
} from '@codetether/protocol'

interface RememberedChoice {
  readonly selected: boolean
  readonly unique: boolean
}

/** Only UI selection intent lives here; discovery records remain in Query. */
export interface PreviousConversationSelection {
  readonly selected: ReadonlySet<DiscoveryCandidateId>
  readonly restored: ReadonlySet<DiscoveryCandidateId>
  readonly identities: ReadonlyMap<DiscoveryCandidateId, string>
  readonly choices: ReadonlyMap<string, RememberedChoice>
}

export function createPreviousConversationSelection(): PreviousConversationSelection {
  return {
    selected: new Set(),
    restored: new Set(),
    identities: new Map(),
    choices: new Map(),
  }
}

/** Presentation metadata is only a conservative way to restore UI choices. */
function candidateKey(candidate: ProviderSessionDiscoveryCandidate): string {
  return JSON.stringify([
    candidate.provider,
    candidate.title,
    candidate.createdAt ?? null,
    candidate.lastActiveAt ?? null,
  ])
}

function canSelect(candidate: ProviderSessionDiscoveryCandidate): boolean {
  return !candidate.alreadyAdopted && candidate.resumeStatus === 'supported'
}

function groupCandidates(
  candidates: readonly ProviderSessionDiscoveryCandidate[],
): ReadonlyMap<string, readonly ProviderSessionDiscoveryCandidate[]> {
  const grouped = new Map<string, ProviderSessionDiscoveryCandidate[]>()
  for (const candidate of candidates) {
    const key = candidateKey(candidate)
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, [candidate])
    else group.push(candidate)
  }
  return grouped
}

function rememberChoices(
  state: PreviousConversationSelection,
  candidates: readonly ProviderSessionDiscoveryCandidate[],
  selected: ReadonlySet<DiscoveryCandidateId>,
  restored: ReadonlySet<DiscoveryCandidateId>,
): PreviousConversationSelection {
  const choices = new Map(state.choices)
  for (const [key, group] of groupCandidates(candidates)) {
    const candidate = group[0]
    choices.set(key, {
      unique: group.length === 1,
      selected:
        group.length === 1 &&
        candidate !== undefined &&
        canSelect(candidate) &&
        selected.has(candidate.discoveryCandidateId),
    })
  }
  const identities = new Map(
    candidates.map((candidate) => [
      candidate.discoveryCandidateId,
      candidateKey(candidate),
    ]),
  )
  return { selected, restored, identities, choices }
}

/**
 * Derive selection from current Query records without copying them into UI
 * state. New records default on. Changed IDs restore only unique metadata
 * matches. Remembered choices from unread later pages survive a rescan.
 */
export function reconcilePreviousConversationSelection(
  state: PreviousConversationSelection,
  candidates: readonly ProviderSessionDiscoveryCandidate[],
  maximumSelection: number,
): PreviousConversationSelection {
  const groups = groupCandidates(candidates)
  const selected = new Set<DiscoveryCandidateId>()
  const restored = new Set<DiscoveryCandidateId>()

  for (const candidate of candidates) {
    if (!canSelect(candidate) || selected.size >= maximumSelection) continue
    const id = candidate.discoveryCandidateId
    const key = candidateKey(candidate)
    const choice = state.choices.get(key)
    const knownIdentity = state.identities.get(id) === key
    const shouldSelect = knownIdentity
      ? state.selected.has(id) &&
        (!state.restored.has(id) || groups.get(key)?.length === 1)
      : choice === undefined ||
        (choice.unique && groups.get(key)?.length === 1 && choice.selected)
    if (shouldSelect) {
      selected.add(id)
      if (knownIdentity ? state.restored.has(id) : choice !== undefined) {
        restored.add(id)
      }
    }
  }

  return rememberChoices(state, candidates, selected, restored)
}

/** One explicit checkbox/bulk action, bounded like discovery itself. */
export function setPreviousConversationSelection(
  state: PreviousConversationSelection,
  candidates: readonly ProviderSessionDiscoveryCandidate[],
  candidateIds: readonly DiscoveryCandidateId[],
  select: boolean,
  maximumSelection: number,
): PreviousConversationSelection {
  const selected = new Set(state.selected)
  const restored = new Set(state.restored)
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.discoveryCandidateId, candidate]),
  )
  for (const id of candidateIds) {
    restored.delete(id)
    if (!select) {
      selected.delete(id)
      continue
    }
    const candidate = candidatesById.get(id)
    if (
      candidate !== undefined &&
      canSelect(candidate) &&
      selected.size < maximumSelection
    ) {
      selected.add(id)
    }
  }
  return rememberChoices(state, candidates, selected, restored)
}
