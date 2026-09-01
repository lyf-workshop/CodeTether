import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  providerPresentation,
  providerPresentations,
} from '../.tmp/test-dist/provider/provider-presentation.js'
import {
  defaultProviderControls,
  effectiveConversationProvider,
  effectiveProviderReasoning,
  executableConversationProviders,
  providerDefaultReasoningSelection,
  providerReasoningFromControl,
} from '../.tmp/test-dist/components/conversations/new-conversation-provider-selection.js'

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

const remoteClaudeCapabilities = {
  streaming: true,
  resume: true,
  interrupt: false,
  approvals: false,
  fileRead: true,
  fileEdit: false,
  shell: false,
  search: true,
  diff: false,
  toolEvents: true,
  modelSelection: false,
  reasoningControl: true,
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
        reasoningLabel: '思考强度',
        reasoningOptions: [
          { id: 'low', label: '低' },
          { id: 'high', label: '高' },
        ],
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
  assert.equal(claude.reasoningLabel, '思考强度')
  assert.deepEqual(claude.reasoningOptions, [
    { id: 'low', label: '低' },
    { id: 'high', label: '高' },
  ])
  assert.equal(claude.capabilities.interrupt, false)
  assert.equal(claude.capabilities.approvals, false)
  assert.equal(claude.capabilities.diff, false)
  assert.equal(providerPresentation(bootstrap, 'codex').available, false)
})

test('Provider reasoning selection omits defaults and rejects stale values', () => {
  const provider = {
    ...providerPresentation(undefined, 'claude-code'),
    reasoningOptions: [
      { id: '__provider_default__', label: 'Provider value' },
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
    ],
  }
  const defaultControl = providerDefaultReasoningSelection(provider)
  assert.equal(defaultControl, '__provider_default___')
  assert.equal(effectiveProviderReasoning(undefined, provider), undefined)
  assert.equal(effectiveProviderReasoning('low', provider), 'low')
  assert.equal(effectiveProviderReasoning('stale', provider), undefined)
  assert.equal(
    providerReasoningFromControl(defaultControl, provider),
    undefined,
  )
  assert.equal(providerReasoningFromControl('high', provider), 'high')
  assert.equal(providerReasoningFromControl('stale', provider), undefined)

  const providerSwitchDefaults = defaultProviderControls({
    ...provider,
    models: [{ id: 'provider-default', label: 'Default', isDefault: true }],
  })
  assert.deepEqual(providerSwitchDefaults, { model: 'provider-default' })
  assert.equal(providerSwitchDefaults.reasoning, undefined)
})

test('New Conversation falls back to executable Remote Claude and preserves its effort controls', () => {
  const bootstrap = {
    protocolVersion: 1,
    hostVersion: 'phase-6c3',
    epoch: 'epoch_remote_claude_provider',
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
        provider: 'codex',
        displayName: 'Codex',
        availability: 'available',
        capabilities: {
          ...remoteClaudeCapabilities,
          streaming: false,
          resume: false,
          fileRead: false,
          search: false,
          toolEvents: false,
          reasoningControl: false,
        },
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        availability: 'available',
        version: '2.1.0',
        capabilities: remoteClaudeCapabilities,
        reasoningLabel: '思考强度',
        reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max'].map(
          (id) => ({ id, label: id }),
        ),
      },
    ],
  }
  const eligible = executableConversationProviders(
    providerPresentations(bootstrap),
  )

  assert.deepEqual(
    eligible.map((provider) => provider.provider),
    ['claude-code'],
  )
  const selected = effectiveConversationProvider('codex', eligible)
  assert.equal(selected?.provider, 'claude-code')
  assert.equal(selected?.capabilities.fileRead, true)
  assert.equal(selected?.capabilities.search, true)
  assert.equal(selected?.capabilities.fileEdit, false)
  assert.equal(selected?.capabilities.shell, false)
  assert.equal(selected?.capabilities.modelSelection, false)
  assert.equal(selected?.reasoningLabel, '思考强度')
  assert.deepEqual(
    selected?.reasoningOptions.map((option) => option.id),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.equal(effectiveProviderReasoning('xhigh', selected), 'xhigh')
  assert.equal(effectiveProviderReasoning('invalid', selected), undefined)
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

  assert.match(dialog, /providerPresentationsForMachine\(/u)
  assert.match(dialog, /machineDetailQuery\.data\?\.providers/u)
  assert.match(dialog, /executableConversationProviders/u)
  assert.match(dialog, /effectiveSelectedProvider/u)
  assert.match(dialog, /capabilities\.resume/u)
  assert.doesNotMatch(dialog, /disabled=\{!provider\.available\}/u)
  assert.match(dialog, /capabilities\.modelSelection/u)
  assert.match(dialog, /capabilities\.reasoningControl/u)
  assert.match(dialog, /reasoningOptions/u)
  assert.match(dialog, /supportsReasoningSelection/u)
  assert.match(dialog, /reasoning: effectiveSelectedReasoning/u)
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
