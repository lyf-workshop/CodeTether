import type {
  MachineProviderLifecycle,
  ProviderDescriptor,
  ProviderInstallationSummary,
} from '@codetether/protocol'

import {
  CLAUDE_CODE_REASONING_LABEL,
  claudeCodeReasoningOptions,
} from './claude-code-host-runtime.js'

/**
 * Combines Provider-wide discovery metadata with the exact installation
 * selected by the durable Machine lifecycle. Once lifecycle truth exists,
 * facts from a previously selected installation never remain effective.
 */
export function providerDescriptorForSelectedInstallation(
  descriptor: ProviderDescriptor,
  lifecycle: MachineProviderLifecycle | undefined,
): ProviderDescriptor
export function providerDescriptorForSelectedInstallation(
  descriptor: undefined,
  lifecycle: MachineProviderLifecycle | undefined,
): undefined
export function providerDescriptorForSelectedInstallation(
  descriptor: ProviderDescriptor | undefined,
  lifecycle: MachineProviderLifecycle | undefined,
): ProviderDescriptor | undefined
export function providerDescriptorForSelectedInstallation(
  descriptor: ProviderDescriptor | undefined,
  lifecycle: MachineProviderLifecycle | undefined,
): ProviderDescriptor | undefined {
  if (descriptor === undefined || lifecycle === undefined) return descriptor

  // With no durable default there is no installation identity to reconcile.
  // Preserve the Provider discovery result (including `not_installed`) until
  // the lifecycle owns an exact selection.
  if (lifecycle.selectedInstallationId === undefined) return descriptor

  const selected = lifecycle.installations.find(
    ({ installationId }) => installationId === lifecycle.selectedInstallationId,
  )
  const compatibility = selected?.compatibility
  const availability = selectedProviderAvailability(selected)
  const executionReady =
    availability === 'available' &&
    compatibility !== undefined &&
    compatibility.capabilities.execution.effective === true &&
    compatibility.capabilities.streaming.effective === true &&
    (descriptor.provider === 'codex' ||
      (compatibility.capabilities.fileRead.effective === true &&
        compatibility.capabilities.search.effective === true &&
        compatibility.capabilities.toolEvents.effective === true))
  const effective = (
    capability:
      | 'streaming'
      | 'nativeResume'
      | 'fileRead'
      | 'search'
      | 'toolEvents'
      | 'reasoningControl',
  ): boolean =>
    executionReady && compatibility?.capabilities[capability].effective === true
  const capabilities = {
    ...descriptor.capabilities,
    streaming: effective('streaming'),
    resume: effective('nativeResume'),
    ...(descriptor.provider === 'claude-code'
      ? {
          fileRead: effective('fileRead'),
          search: effective('search'),
          toolEvents: effective('toolEvents'),
          reasoningControl: effective('reasoningControl'),
        }
      : {}),
  }
  const providerMetadata = { ...descriptor }
  const { reasoningLabel, reasoningOptions } = providerMetadata
  delete providerMetadata.version
  delete providerMetadata.reasoningLabel
  delete providerMetadata.reasoningOptions

  return {
    ...providerMetadata,
    availability,
    ...(selected?.version === undefined ? {} : { version: selected.version }),
    capabilities,
    ...(capabilities.reasoningControl
      ? {
          reasoningLabel:
            reasoningLabel ??
            (descriptor.provider === 'claude-code'
              ? CLAUDE_CODE_REASONING_LABEL
              : undefined),
          reasoningOptions:
            reasoningOptions ??
            (descriptor.provider === 'claude-code'
              ? claudeCodeReasoningOptions()
              : undefined),
        }
      : {}),
  }
}

function selectedProviderAvailability(
  selected: ProviderInstallationSummary | undefined,
): ProviderDescriptor['availability'] {
  const compatibility = selected?.compatibility
  if (
    selected?.availability !== 'available' ||
    selected.revision === undefined ||
    compatibility?.freshness !== 'current'
  ) {
    return 'unavailable'
  }
  if (compatibility.state === 'incompatible') return 'unsupported_version'
  if (compatibility.state === 'unavailable') return 'unavailable'
  return 'available'
}
