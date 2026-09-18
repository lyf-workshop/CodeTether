import assert from 'node:assert/strict'
import test from 'node:test'

import { providerDescriptorForSelectedInstallation } from '../dist/api/provider-effective-descriptor.js'

const capabilities = {
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

test('preserves discovery truth when no durable installation is selected', () => {
  const descriptor = {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'not_installed',
    capabilities: {
      ...capabilities,
      fileRead: false,
      search: false,
      toolEvents: false,
      reasoningControl: false,
    },
  }

  assert.deepEqual(
    providerDescriptorForSelectedInstallation(descriptor, {
      provider: 'codex',
      installations: [],
    }),
    descriptor,
  )
})

test('fails closed without retaining metadata from a previously selected installation', () => {
  const effective = providerDescriptorForSelectedInstallation(
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      availability: 'available',
      version: '2.1.276',
      capabilities,
    },
    {
      provider: 'claude-code',
      selectedInstallationId: 'pinst_selected_B',
      installations: [
        {
          installationId: 'pinst_selected_B',
          provider: 'claude-code',
          selected: true,
          version: '2.1.268',
          launcherKind: 'native',
          installMethod: 'manual',
          availability: 'available',
          revision: 'prev_selected_B',
          firstObservedAt: '2026-09-18T00:00:00.000Z',
          lastObservedAt: '2026-09-18T00:00:00.000Z',
        },
      ],
    },
  )

  assert.equal(effective.availability, 'unavailable')
  assert.equal(effective.version, '2.1.268')
  assert.equal(effective.capabilities.streaming, false)
  assert.equal(effective.capabilities.resume, false)
  assert.equal(effective.capabilities.fileRead, false)
  assert.equal(effective.capabilities.search, false)
  assert.equal(effective.capabilities.toolEvents, false)
  assert.equal(effective.capabilities.reasoningControl, false)
})
