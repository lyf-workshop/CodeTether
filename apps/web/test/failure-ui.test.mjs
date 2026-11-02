import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)
import {
  deriveComposerEligibility,
  deriveProjectLocationBoundaryReason,
} from '../.tmp/test-dist/components/conversation/conversation-controls.js'
import { composerGatePresentation } from '../.tmp/test-dist/components/conversation/conversation-gate-presentation.js'

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
  assert.match(timeline, /mx-auto w-full min-w-0 max-w-\(--read-w\)/u)
  assert.match(machine, /min-w-0/u)
  assert.match(machine, /expanded-workspace:grid-cols-/u)
  assert.match(dialog, /ct-new-conversation-dialog overflow-x-hidden/u)
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
  const [workspace, route, composer, gateSource] = await Promise.all([
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
    readFile(
      new URL('components/conversation/composer.tsx', sourceRoot),
      'utf8',
    ),
    readFile(
      new URL(
        'components/conversation/conversation-gate-presentation.ts',
        sourceRoot,
      ),
      'utf8',
    ),
  ])

  for (const reason of [
    'project_location_missing',
    'project_location_invalid',
    'project_location_unavailable',
  ]) {
    assert.equal(
      deriveProjectLocationBoundaryReason('unavailable', { code: reason }),
      reason,
    )
  }
  assert.equal(
    deriveProjectLocationBoundaryReason('available', {
      code: 'project_location_missing',
    }),
    undefined,
  )
  const composerDisabled = deriveComposerEligibility({
    connectionState: 'connected',
    machine: { kind: 'local', connectionState: 'local' },
    projectAvailability: 'unavailable',
  })
  assert.equal(composerDisabled.reason, 'project_location_unavailable')
  assert.equal(composerDisabled.navigation, 'project')
  const gate = composerGatePresentation({
    capabilities: {
      canCompose: false,
      canInterrupt: false,
      supportsInterrupt: false,
      composerDisabled,
    },
    state: 'unavailable',
    providerName: 'Codex',
    machineKind: 'local',
  })
  assert.equal(gate.kind, 'unavailable')
  assert.equal(gate.canInterrupt, false)
  assert.equal(gate.navigation, 'project')
  assert.equal(gate.description, composerDisabled.message)
  assert.match(gate.description, /已注册的项目位置/u)
  assert.match(gateSource, /project_location_missing/u)
  assert.match(gateSource, /project_location_invalid/u)
  assert.match(gateSource, /project_location_unavailable/u)
  assert.match(gateSource, /CodeTether 未删除项目文件/u)
  assert.match(gateSource, /不会改用其他目录/u)
  assert.match(gateSource, /disabled\?\.message/u)
  assert.match(composer, /role="status"/u)
  assert.match(composer, /\{gate\.description\}/u)
  assert.match(composer, /hidden=\{editorHidden\}/u)
  assert.match(
    composer,
    /gate\?\.kind === 'archived' \|\| gate\?\.kind === 'unavailable'/u,
  )
  assert.match(composer, /readOnly=\{!canEdit\}/u)
  assert.match(composer, /flex-wrap/u)
  assert.match(composer, /break-words/u)
  assert.match(workspace, /<ConversationTimeline/u)
  assert.match(workspace, /composerDisabled\?\.navigation === 'project'/u)
  assert.match(workspace, /projectBoundary !== undefined/u)
  assert.match(workspace, /to="\/projects\/\$projectId"/u)
  assert.match(workspace, /params=\{\{ projectId: recoveryProjectId \}\}/u)
  assert.match(workspace, /machineId: recoveryMachineId/u)
  assert.match(workspace, /recoveryAction=\{recoveryAction\}/u)
  assert.match(workspace, /projectBoundary=\{projectBoundary\}/u)
  assert.match(composer, /projectBoundary,/u)
  assert.match(
    workspace,
    /aria-label=\{\x60查看\$\{recoveryProjectName\}的项目详情\x60\}/u,
  )
  assert.match(route, /deriveProjectLocationBoundaryReason/u)
  assert.match(route, /projectBoundary:/u)
})
