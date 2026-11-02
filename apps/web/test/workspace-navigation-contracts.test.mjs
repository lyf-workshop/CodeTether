import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (path) =>
  readFile(new URL('../src/' + path, import.meta.url), 'utf8')

test('palette is cache-only and never calls content search, native transcripts or mutation APIs', async () => {
  const [cache, panel] = await Promise.all([
    source('components/app-shell/command-palette-cache.ts'),
    source('components/app-shell/command-palette.tsx'),
  ])
  assert.match(cache, /getQueryCache\(\)/u)
  assert.match(cache, /dataUpdatedAt/u)
  assert.match(cache, /getQueryData/u)
  assert.doesNotMatch(
    cache + panel,
    /fetchQuery|ensureQueryData|useQuery\(|listProjectConversations\(|searchConversations\(|nativeTranscript|createConversation\(|resolveApproval\(/u,
  )
  assert.match(panel, /to: '\/c\/\$conversationId'/u)
  assert.match(panel, /search: \{ machineId: target\.machineId \}/u)
  assert.match(panel, /callbacks\[action\] !== undefined/u)
})

test('mobile stylesheet hides sidebar and gives the real bottom tabs their own safe-area grid row', async () => {
  const [css, mobile] = await Promise.all([
    source('components/app-shell/workspace-responsive.css'),
    source('components/app-shell/mobile-workspace-navigation.tsx'),
  ])
  assert.match(css, /@media \(width <= 37\.5rem\)/u)
  assert.match(css, /workspace-sidebar-column/u)
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/u)
  assert.match(css, /safe-area-inset-bottom/u)
  assert.match(css, /ct-add-project-dialog/u)
  assert.match(css, /ct-new-conversation-dialog/u)
  assert.doesNotMatch(css, /!important|native-titlebar|traffic|winctl/u)
  assert.match(mobile, /to: '\/devices'/u)
  assert.match(mobile, /to: '\/inbox'/u)
  assert.match(mobile, /to: '\/settings'/u)
  assert.match(mobile, /attentionCount === undefined/u)
})

test('Inbox retains exact bound actions, server-event removal, mutation guards and focus recovery', async () => {
  const [page, item, context] = await Promise.all([
    source('components/inbox/inbox-page.tsx'),
    source('components/inbox/inbox-item.tsx'),
    source('components/inbox/inbox-context.ts'),
  ])
  for (const authority of [
    'resolveInboxApproval',
    'reviewCompletedAttention',
    'acknowledgeInboxAttention',
    'mutationGuards.current.has',
    'getInboxFocusRecoveryTarget',
    'attention.resolved',
    'cancelAnimationFrame',
  ])
    assert.ok(page.includes(authority))
  assert.match(
    item,
    /search=\{item\.turnId === undefined \? \{\} : \{ turn: item\.turnId \}\}/u,
  )
  assert.match(
    context,
    /projectLocationAvailability\(\s*owningProject,\s*conversation\.machineId,?\s*\)/u,
  )
  assert.doesNotMatch(
    page + item,
    /setQueryData|error\.message|retryTurn\(|autoSubmit/u,
  )
  assert.match(item, /无法访问/u)
  assert.match(
    page,
    /metadata\.get\(String\(item\.attentionId\)\)\?\.approvalSupported/u,
  )
})
