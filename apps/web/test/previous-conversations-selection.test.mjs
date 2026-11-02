import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPreviousConversationSelection,
  reconcilePreviousConversationSelection,
  setPreviousConversationSelection,
} from '../.tmp/test-dist/components/projects/previous-conversations-selection.js'

const maximum = 100

function candidate(id, extra = {}) {
  return {
    discoveryCandidateId: `candidate_${id}`,
    provider: 'codex',
    machineId: 'machine_local01',
    title: `会话 ${id}`,
    createdAt: '2026-10-18T10:00:00.000Z',
    lastActiveAt: '2026-10-18T11:00:00.000Z',
    resumeStatus: 'supported',
    historicalTranscript: 'available',
    alreadyAdopted: false,
    ...extra,
  }
}

// This fixture supplies server records as Query does. The production selection
// model itself stores no candidates, provider results, or pagination cursors.
function fixture(limit = maximum) {
  let records = []
  let state = createPreviousConversationSelection()
  return {
    read(incoming, append = false) {
      const byId = new Map(
        (append ? records : []).map((entry) => [
          entry.discoveryCandidateId,
          entry,
        ]),
      )
      for (const entry of incoming) byId.set(entry.discoveryCandidateId, entry)
      records = [...byId.values()]
      state = reconcilePreviousConversationSelection(state, records, limit)
      return this
    },
    choose(ids, select) {
      state = setPreviousConversationSelection(
        state,
        records,
        ids,
        select,
        limit,
      )
      return this
    },
    get records() {
      return records
    },
    get state() {
      return state
    },
    get selected() {
      return [...state.selected]
    },
  }
}

test('first discovery selects only resumable unadopted candidates and stores no server records', () => {
  const current = fixture().read([
    candidate('codex'),
    candidate('claude', { provider: 'claude-code' }),
    candidate('adopted', {
      alreadyAdopted: true,
      conversationId: 'conv_existing01',
    }),
    candidate('unsupported', { resumeStatus: 'unsupported' }),
  ])
  assert.deepEqual(current.selected, ['candidate_codex', 'candidate_claude'])
  assert.deepEqual(Object.keys(current.state).sort(), [
    'choices',
    'identities',
    'restored',
    'selected',
  ])
})

test('load more preserves explicit deselection, deduplicates IDs, and selects new eligible entries', () => {
  const current = fixture()
    .read([candidate('one'), candidate('two')])
    .choose(['candidate_one'], false)
    .read([candidate('one'), candidate('three')], true)
  assert.deepEqual(
    current.records.map((entry) => entry.discoveryCandidateId),
    ['candidate_one', 'candidate_two', 'candidate_three'],
  )
  assert.deepEqual(current.selected, ['candidate_two', 'candidate_three'])
})

test('rescan restores checked and unchecked choices across new candidate IDs', () => {
  const one = candidate('one')
  const two = candidate('two')
  const current = fixture()
    .read([one, two])
    .choose([one.discoveryCandidateId], false)
  current.read([
    { ...one, discoveryCandidateId: 'candidate_one_fresh' },
    { ...two, discoveryCandidateId: 'candidate_two_fresh' },
  ])
  assert.deepEqual(current.selected, ['candidate_two_fresh'])
})

test('choices on later pages survive rescan and restore only when that page is loaded', () => {
  const early = candidate('early')
  const lateChecked = candidate('late_checked')
  const lateUnchecked = candidate('late_unchecked')
  const current = fixture()
    .read([early])
    .read([lateChecked, lateUnchecked], true)
    .choose([lateUnchecked.discoveryCandidateId], false)
    .read([{ ...early, discoveryCandidateId: 'candidate_early_fresh' }])
  assert.deepEqual(current.selected, ['candidate_early_fresh'])
  current.read(
    [
      { ...lateChecked, discoveryCandidateId: 'candidate_late_checked_fresh' },
      {
        ...lateUnchecked,
        discoveryCandidateId: 'candidate_late_unchecked_fresh',
      },
    ],
    true,
  )
  assert.deepEqual(current.selected, [
    'candidate_early_fresh',
    'candidate_late_checked_fresh',
  ])
})

test('metadata restoration requires a unique old and new match', () => {
  const original = candidate('original')
  const current = fixture()
    .read([original])
    .read([
      { ...original, discoveryCandidateId: 'candidate_duplicate_a' },
      { ...original, discoveryCandidateId: 'candidate_duplicate_b' },
    ])
  assert.deepEqual(current.selected, [])

  const ambiguous = fixture()
    .read([
      original,
      { ...original, discoveryCandidateId: 'candidate_old_duplicate' },
    ])
    .read([{ ...original, discoveryCandidateId: 'candidate_new_unique' }])
  assert.deepEqual(ambiguous.selected, [])
})

test('provider, title, created time, and active time all participate in restoration', () => {
  const original = candidate('original')
  const current = fixture()
    .read([original])
    .choose([original.discoveryCandidateId], false)
  current.read([
    { ...original, discoveryCandidateId: 'candidate_same' },
    {
      ...original,
      discoveryCandidateId: 'candidate_provider',
      provider: 'claude-code',
    },
    {
      ...original,
      discoveryCandidateId: 'candidate_title',
      title: '另一个会话',
    },
    {
      ...original,
      discoveryCandidateId: 'candidate_created',
      createdAt: '2026-10-17T10:00:00.000Z',
    },
    {
      ...original,
      discoveryCandidateId: 'candidate_active',
      lastActiveAt: '2026-10-18T12:00:00.000Z',
    },
  ])
  assert.deepEqual(current.selected, [
    'candidate_provider',
    'candidate_title',
    'candidate_created',
    'candidate_active',
  ])
})

test('a duplicate discovered on a later page clears only a metadata-restored selection', () => {
  const original = candidate('original')
  const current = fixture()
    .read([original])
    .read([{ ...original, discoveryCandidateId: 'candidate_restored' }])
  assert.deepEqual(current.selected, ['candidate_restored'])
  current.read(
    [{ ...original, discoveryCandidateId: 'candidate_duplicate' }],
    true,
  )
  assert.deepEqual(current.selected, [])
  current.choose(['candidate_restored'], true)
  current.read([candidate('another')], true)
  assert.deepEqual(current.selected, [
    'candidate_restored',
    'candidate_another',
  ])
})

test('unsupported or adopted replacements cannot recover a checked choice', () => {
  const original = candidate('original')
  const unsupported = fixture()
    .read([original])
    .read([
      {
        ...original,
        discoveryCandidateId: 'candidate_unsupported',
        resumeStatus: 'unsupported',
      },
    ])
  const adopted = fixture()
    .read([original])
    .read([
      {
        ...original,
        discoveryCandidateId: 'candidate_adopted',
        alreadyAdopted: true,
        conversationId: 'conv_existing01',
      },
    ])
  assert.deepEqual(unsupported.selected, [])
  assert.deepEqual(adopted.selected, [])
})

test('default selection, bulk selection, append, and restoration all obey the same bound', () => {
  const entries = Array.from({ length: 105 }, (_, index) =>
    candidate(String(index)),
  )
  const current = fixture()
    .read(entries.slice(0, 50))
    .read(entries.slice(50), true)
  assert.equal(current.selected.length, maximum)
  assert.equal(current.state.selected.has('candidate_104'), false)
  current.choose(
    entries.map((entry) => entry.discoveryCandidateId),
    false,
  )
  assert.deepEqual(current.selected, [])
  current.choose(
    entries.map((entry) => entry.discoveryCandidateId),
    true,
  )
  assert.equal(current.selected.length, maximum)
  current.read(
    entries.map((entry) => ({
      ...entry,
      discoveryCandidateId: `${entry.discoveryCandidateId}_fresh`,
    })),
  )
  assert.equal(current.selected.length, maximum)
  assert.equal(current.state.selected.has('candidate_104_fresh'), false)
})

test('authoritative adoption removes only that selection without selecting another candidate', () => {
  const entries = [candidate('one'), candidate('two'), candidate('three')]
  const current = fixture(2).read(entries)
  const before = current.state
  current.read(
    current.records.map((entry) =>
      entry.discoveryCandidateId === 'candidate_one'
        ? { ...entry, alreadyAdopted: true, conversationId: 'conv_adopted01' }
        : entry,
    ),
  )
  assert.deepEqual([...before.selected], ['candidate_one', 'candidate_two'])
  assert.deepEqual(current.selected, ['candidate_two'])
  assert.equal(current.state.selected.has('candidate_three'), false)
  current.read(
    current.records.map((entry) => ({
      ...entry,
      discoveryCandidateId: `${entry.discoveryCandidateId}_fresh`,
    })),
  )
  assert.deepEqual(current.selected, ['candidate_two_fresh'])
})

test('bulk uncheck remains unchecked through repeated refreshes', () => {
  const entries = [candidate('one'), candidate('two')]
  const current = fixture()
    .read(entries)
    .choose(
      entries.map((entry) => entry.discoveryCandidateId),
      false,
    )
  for (let generation = 0; generation < 3; generation += 1) {
    current.read(
      entries.map((entry) => ({
        ...entry,
        discoveryCandidateId: `${entry.discoveryCandidateId}_${generation}`,
      })),
    )
    assert.deepEqual(current.selected, [])
  }
})

test('absent timestamp fields remain distinct from populated values during restoration', () => {
  const original = candidate('missing', {
    createdAt: undefined,
    lastActiveAt: undefined,
  })
  const current = fixture()
    .read([original])
    .choose([original.discoveryCandidateId], false)
  current.read([
    { ...original, discoveryCandidateId: 'candidate_still_missing' },
    candidate('has_dates', { title: original.title }),
  ])
  assert.deepEqual(current.selected, ['candidate_has_dates'])
})
