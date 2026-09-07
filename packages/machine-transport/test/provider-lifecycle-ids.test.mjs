import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerBackendConfigurationRevisionFor,
  providerInstallationIdFor,
  providerInstallationRevisionFor,
} from '../dist/index.js'

test('opaque Provider lifecycle identities remain schema-valid for every base64url prefix', () => {
  const machineId = 'machine_provider_lifecycle_identity_fixture'
  for (let index = 0; index < 1_024; index += 1) {
    const privateValue = `test-owned-private-value-${String(index)}`
    assert.match(
      providerInstallationIdFor(machineId, 'claude-code', privateValue),
      /^pinst_[A-Za-z0-9][A-Za-z0-9_-]+$/u,
    )
    assert.match(
      providerInstallationRevisionFor(machineId, 'claude-code', privateValue),
      /^prev_[A-Za-z0-9][A-Za-z0-9_-]+$/u,
    )
    assert.match(
      providerBackendConfigurationRevisionFor(
        machineId,
        'claude-code',
        privateValue,
      ),
      /^pbcfg_[A-Za-z0-9][A-Za-z0-9_-]+$/u,
    )
  }
})
