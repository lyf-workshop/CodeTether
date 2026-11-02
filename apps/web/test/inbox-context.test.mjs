import assert from 'node:assert/strict'
import test from 'node:test'
import { inboxItemContext } from '../.tmp/test-dist/components/inbox/inbox-context.js'

const localId = 'machine_local01',
  remoteId = 'machine_remote01'
const item = {
  attentionId: 'attention_test01',
  projectId: 'project_test01',
  conversationId: 'conversation_test01',
  type: 'approval',
}
const conversation = {
  projectId: item.projectId,
  conversationId: item.conversationId,
  machineId: remoteId,
  title: 'Remote Task',
  provider: 'codex',
}
const project = {
  projectId: item.projectId,
  name: 'Shared Project',
  locations: [
    { machineId: localId, availability: 'available' },
    { machineId: remoteId, availability: 'unavailable' },
  ],
}
const machine = {
  machineId: remoteId,
  displayName: 'Build Node',
  availability: 'available',
  connectionState: 'online',
  capabilities: { providerExecution: true },
}
const provider = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
  capabilities: { approvals: false },
  models: [],
  reasoningOptions: [],
}

test('Inbox context uses immutable conversation device and its exact project location', () => {
  const context = inboxItemContext(item, project, conversation, machine, [
    provider,
  ])
  assert.equal(context.machineId, remoteId)
  assert.equal(context.machineName, 'Build Node')
  assert.equal(context.projectAvailability, 'unavailable')
  assert.equal(context.approvalSupported, false)
})

test('missing metadata cannot impersonate local Codex or an available sibling location', () => {
  const missing = inboxItemContext(item, project)
  assert.equal(missing.provider, undefined)
  assert.equal(missing.machineId, undefined)
  assert.equal(missing.projectAvailability, undefined)
  assert.equal(missing.approvalSupported, false)
})

test('cross-project or cross-conversation records are rejected rather than enriching the wrong Attention', () => {
  for (const record of [
    { ...conversation, projectId: 'project_other01' },
    { ...conversation, conversationId: 'conversation_other01' },
  ]) {
    const context = inboxItemContext(item, project, record, machine, [provider])
    assert.equal(context.machineId, undefined)
    assert.equal(context.provider, undefined)
    assert.equal(context.approvalSupported, false)
  }
})

test('different machine descriptor cannot lend approvals to the owning device', () => {
  const context = inboxItemContext(
    item,
    project,
    conversation,
    { ...machine, machineId: localId },
    [{ ...provider, capabilities: { approvals: true } }],
  )
  assert.equal(context.machineId, remoteId)
  assert.equal(context.machineName, undefined)
  assert.equal(context.approvalSupported, false)
})

test('canonical exact provider capabilities enable approvals without tool-name hardcoding', () => {
  const context = inboxItemContext(item, project, conversation, machine, [
    { ...provider, capabilities: { approvals: true } },
  ])
  assert.equal(context.approvalSupported, true)
  const absent = inboxItemContext(item, project, conversation, machine, [
    { ...provider, provider: 'claude-code', capabilities: { approvals: true } },
  ])
  assert.equal(absent.approvalSupported, false)
})

test('offline or unavailable execution device blocks approvals even beside cached capable descriptors', () => {
  for (const overrides of [
    { availability: 'unavailable' },
    { connectionState: 'offline' },
    { capabilities: { providerExecution: false } },
  ])
    assert.equal(
      inboxItemContext(
        item,
        project,
        conversation,
        { ...machine, ...overrides },
        [{ ...provider, capabilities: { approvals: true } }],
      ).approvalSupported,
      false,
    )
})

test('unknown project does not remove readable conversation identity or invent availability', () => {
  const context = inboxItemContext(item, undefined, conversation, machine, [
    provider,
  ])
  assert.equal(context.conversationTitle, 'Remote Task')
  assert.equal(context.projectName, undefined)
  assert.equal(context.projectAvailability, undefined)
})
