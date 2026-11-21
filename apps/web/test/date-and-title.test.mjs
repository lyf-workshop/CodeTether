import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
} from '../.tmp/test-dist/presentation/date-time.js'
import { displayConversationTitle } from '../.tmp/test-dist/components/conversations/conversation-title.js'

test('dates use local Chinese month/day and include the year only when needed', () => {
  const thisYear = new Date(2026, 10, 1, 18, 10, 5)
  const otherYear = new Date(2025, 10, 1, 18, 10, 5)
  const now = new Date(2026, 10, 21)

  assert.equal(
    formatLocalDateTime(thisYear.toISOString(), now),
    '11月1日 18:10',
  )
  assert.equal(
    formatLocalDateTime(otherYear.toISOString(), now),
    '2025年11月1日 18:10',
  )
  assert.equal(formatLocalDate(thisYear.toISOString(), now), '11月1日')
  assert.equal(formatLocalDate(otherYear.toISOString(), now), '2025年11月1日')
  assert.equal(formatLocalTime(thisYear.toISOString()), '18:10')
  assert.equal(formatLocalTime(thisYear.toISOString(), true), '18:10:05')
  assert.equal(formatLocalDateTime('not a date', now), undefined)
})

test('Codex fallback titles are local display text; stored and named titles remain untouched', () => {
  const createdAt = new Date(
    new Date().getFullYear(),
    10,
    1,
    18,
    10,
    5,
  ).toISOString()
  assert.equal(
    displayConversationTitle('Codex 会话', createdAt, 'codex'),
    'Codex 会话 · 11月1日 18:10',
  )
  assert.equal(
    displayConversationTitle(`Codex 会话 · ${createdAt}`),
    'Codex 会话 · 11月1日 18:10',
    'an already-adopted ISO fallback is formatted without a storage mutation',
  )
  assert.equal(
    displayConversationTitle(`Codex 会话 — ${createdAt}`),
    'Codex 会话 · 11月1日 18:10',
    'the Owner legacy em-dash form is also formatted',
  )
  assert.equal(
    displayConversationTitle(`Codex 会话 – ${createdAt}`),
    'Codex 会话 · 11月1日 18:10',
  )
  assert.equal(
    displayConversationTitle(`Codex 会话 - ${createdAt}`),
    'Codex 会话 · 11月1日 18:10',
  )
  assert.equal(
    displayConversationTitle('Codex 会话 · 2026-99-99T00:00:00.000Z'),
    'Codex 会话',
  )
  assert.equal(
    displayConversationTitle('Fix release', createdAt),
    'Fix release',
  )
  assert.equal(displayConversationTitle('Codex 会话'), 'Codex 会话')
  assert.equal(
    displayConversationTitle('Codex 会话', createdAt, 'claude-code'),
    'Codex 会话',
  )
  assert.equal(
    displayConversationTitle(
      `Codex 会话 — ${createdAt}`,
      createdAt,
      'claude-code',
    ),
    `Codex 会话 — ${createdAt}`,
  )
  assert.equal(displayConversationTitle('Codex 会话', createdAt), 'Codex 会话')
})
