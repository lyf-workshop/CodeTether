import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)

test('failure card and Composer expose keyboard and screen-reader semantics', async () => {
  const [card, composer, timeline] = await Promise.all([
    readFile(
      new URL(
        'components/conversation/conversation-failure-card.tsx',
        sourceRoot,
      ),
      'utf8',
    ),
    readFile(
      new URL('components/conversation/composer.tsx', sourceRoot),
      'utf8',
    ),
    readFile(
      new URL('components/conversation/conversation-timeline.tsx', sourceRoot),
      'utf8',
    ),
  ])

  assert.match(card, /<article/u)
  assert.match(card, /role="status"/u)
  assert.match(card, /aria-live="polite"/u)
  assert.match(card, /aria-labelledby=\{titleId\}/u)
  assert.match(card, /aria-describedby=\{descriptionId\}/u)
  assert.match(card, /<details/u)
  assert.match(card, /<summary/u)
  assert.match(card, /focus-visible:ring/u)
  assert.match(card, /role="alert"/u)
  assert.match(composer, /aria-disabled=\{!canEdit \|\| undefined\}/u)
  assert.ok(
    (composer.match(/aria-describedby=\{statusId\}/gu) ?? []).length >= 2,
  )
  assert.match(timeline, /<ConversationFailureCard/u)
})

test('failure surfaces retain bounded responsive layout at both required desktop widths', async () => {
  const [card, timeline, machine, dialog] = await Promise.all([
    readFile(
      new URL(
        'components/conversation/conversation-failure-card.tsx',
        sourceRoot,
      ),
      'utf8',
    ),
    readFile(
      new URL('components/conversation/conversation-timeline.tsx', sourceRoot),
      'utf8',
    ),
    readFile(
      new URL('components/machines/machine-detail-page.tsx', sourceRoot),
      'utf8',
    ),
    readFile(
      new URL(
        'components/conversations/new-conversation-dialog.tsx',
        sourceRoot,
      ),
      'utf8',
    ),
  ])

  assert.match(card, /min-w-0/u)
  assert.match(card, /flex-wrap/u)
  assert.match(card, /overflow-auto break-all/u)
  assert.match(timeline, /max-w-3xl/u)
  assert.match(machine, /md:grid-cols-2/u)
  assert.match(machine, /xl:grid-cols-\[minmax\(0,1fr\)_20rem\]/u)
  assert.match(dialog, /max-w-lg overflow-x-hidden/u)
})

test('failure rendering consumes presentation fields rather than unsafe Host messages', async () => {
  const [card, mapper] = await Promise.all([
    readFile(
      new URL(
        'components/conversation/conversation-failure-card.tsx',
        sourceRoot,
      ),
      'utf8',
    ),
    readFile(new URL('failures/failure-presentation.ts', sourceRoot), 'utf8'),
  ])

  assert.doesNotMatch(card, /error\.message|error\.details/u)
  assert.doesNotMatch(
    mapper,
    /\.message\.match|parse.*message|stderr.*render/iu,
  )
  assert.match(mapper, /technicalDetails\(error, failure\)/u)
  assert.match(mapper, /value: error\.code/u)
  assert.doesNotMatch(mapper, /value: error\.message|error\.details/u)
})

test('Conversation ProjectLocation boundary is truthful, accessible, and navigates to Project repair', async () => {
  const [workspace, route] = await Promise.all([
    readFile(
      new URL('components/conversation/conversation-workspace.tsx', sourceRoot),
      'utf8',
    ),
    readFile(
      new URL(
        'components/conversation/conversation-detail-route.tsx',
        sourceRoot,
      ),
      'utf8',
    ),
  ])

  assert.match(workspace, /<ProjectLocationBoundary/u)
  assert.match(workspace, /role="status"/u)
  assert.match(workspace, /aria-label="项目位置不可用"/u)
  assert.match(workspace, /project_location_missing/u)
  assert.match(workspace, /project_location_invalid/u)
  assert.match(workspace, /project_location_unavailable/u)
  assert.match(workspace, /CodeTether 未删除项目文件/u)
  assert.match(workspace, /CodeTether 不会改用其他目录/u)
  assert.match(workspace, /to="\/projects\/\$projectId"/u)
  assert.match(
    workspace,
    /aria-label=\{`查看\$\{boundary\.projectName\}的项目详情`\}/u,
  )
  assert.match(workspace, /flex-wrap/u)
  assert.match(workspace, /break-words/u)
  assert.match(route, /deriveProjectLocationBoundaryReason/u)
  assert.match(route, /projectBoundary:/u)
})
