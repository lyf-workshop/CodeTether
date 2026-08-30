import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  providerPresentation,
  providerPresentations,
} from '../.tmp/test-dist/provider/provider-presentation.js'

const providerCapabilities = {
  streaming: true,
  resume: true,
  interrupt: false,
  approvals: false,
  fileRead: true,
  fileEdit: true,
  shell: true,
  search: true,
  diff: false,
  toolEvents: true,
  modelSelection: true,
  reasoningControl: false,
}

test('Provider presentation uses descriptors and keeps legacy fallback Codex-only', () => {
  const legacy = {
    protocolVersion: 1,
    hostVersion: 'legacy',
    epoch: 'epoch_legacy_provider',
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: true,
      diff: true,
      streaming: true,
    },
  }

  assert.deepEqual(
    providerPresentations(legacy).map((provider) => [
      provider.provider,
      provider.available,
      provider.availabilityLabel,
    ]),
    [
      ['codex', true, '可用'],
      ['claude-code', false, '暂时不可用'],
    ],
  )
  assert.equal(
    providerPresentation(legacy, 'codex').capabilities.reasoningControl,
    true,
  )
})

test('Claude Code status, version, models and capabilities remain Host-owned', () => {
  const bootstrap = {
    protocolVersion: 1,
    hostVersion: 'phase-5a',
    epoch: 'epoch_claude_provider',
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: true,
      diff: true,
      streaming: true,
    },
    providers: [
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        availability: 'unsupported_version',
        version: '9.9.9',
        testedVersion: '1.0.0',
        capabilities: providerCapabilities,
        models: [{ id: 'real-model-id', label: 'CLI model', isDefault: true }],
      },
    ],
  }

  const claude = providerPresentation(bootstrap, 'claude-code')
  assert.equal(claude.agent, 'claude')
  assert.equal(claude.available, false)
  assert.equal(claude.availabilityLabel, '版本不支持')
  assert.equal(claude.version, '9.9.9')
  assert.deepEqual(claude.models, [
    { id: 'real-model-id', label: 'CLI model', isDefault: true },
  ])
  assert.equal(claude.capabilities.interrupt, false)
  assert.equal(claude.capabilities.approvals, false)
  assert.equal(claude.capabilities.diff, false)
  assert.equal(providerPresentation(bootstrap, 'codex').available, false)
})

test('existing UI surfaces consume Provider truth without adding a switch to Detail', async () => {
  const root = new URL('../src/', import.meta.url)
  const [
    dialog,
    sidebar,
    header,
    inbox,
    inboxPage,
    inboxMetadata,
    search,
    rail,
  ] = await Promise.all([
    readFile(
      new URL('components/conversations/new-conversation-dialog.tsx', root),
      'utf8',
    ),
    readFile(new URL('components/app-shell/primary-sidebar.tsx', root), 'utf8'),
    readFile(
      new URL('components/conversation/conversation-header.tsx', root),
      'utf8',
    ),
    readFile(new URL('components/inbox/inbox-item.tsx', root), 'utf8'),
    readFile(new URL('components/inbox/inbox-page.tsx', root), 'utf8'),
    readFile(new URL('components/inbox/use-inbox-metadata.ts', root), 'utf8'),
    readFile(
      new URL('components/conversations/conversation-search-results.tsx', root),
      'utf8',
    ),
    readFile(
      new URL('components/conversation/conversation-rail.tsx', root),
      'utf8',
    ),
  ])

  assert.match(dialog, /providerPresentations\(runtime\.bootstrap\)/u)
  assert.match(dialog, /disabled=\{!provider\.available\}/u)
  assert.match(dialog, /capabilities\.modelSelection/u)
  assert.match(dialog, /capabilities\.reasoningControl/u)
  assert.match(sidebar, /provider\.availabilityLabel/u)
  assert.match(sidebar, /provider\.version/u)
  assert.match(header, /capabilities\.supportsInterrupt/u)
  assert.match(header, /capabilities\.supportsDiff/u)
  assert.doesNotMatch(header, /onProviderChange|switchProvider/u)
  assert.match(inbox, /metadata\?\.provider/u)
  assert.match(
    inboxPage,
    /providerPresentation\(runtime\.bootstrap, provider\)/u,
  )
  assert.match(inboxPage, /presentation\.capabilities\.approvals/u)
  assert.match(inboxMetadata, /allProjectConversationsQueryOptions/u)
  assert.match(search, /providerDisplayName\(conversation\.provider\)/u)
  assert.match(rail, /providerDisplayName\(conversation\.provider\)/u)
})
