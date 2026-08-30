import { z } from 'zod'

/** Durable Provider identity. A Conversation never changes this value. */
export const ProviderIdSchema = z.enum(['codex', 'claude-code'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const ProviderAvailabilitySchema = z.enum([
  'available',
  'not_installed',
  'unsupported_version',
  'misconfigured',
  'unavailable',
])
export type ProviderAvailability = z.infer<typeof ProviderAvailabilitySchema>

/** Presentation-safe capabilities discovered and cached by the Host. */
export const ProviderCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    resume: z.boolean(),
    interrupt: z.boolean(),
    approvals: z.boolean(),
    fileRead: z.boolean(),
    fileEdit: z.boolean(),
    shell: z.boolean(),
    search: z.boolean(),
    diff: z.boolean(),
    toolEvents: z.boolean(),
    modelSelection: z.boolean(),
    reasoningControl: z.boolean(),
  })
  .strict()
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>

export const ProviderModelSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    label: z.string().trim().min(1).max(240),
    isDefault: z.boolean().optional(),
  })
  .strict()
export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ProviderReasoningOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
  })
  .strict()
export type ProviderReasoningOption = z.infer<
  typeof ProviderReasoningOptionSchema
>

/** Public Provider detection result. Executable paths and raw diagnostics stay private. */
export const ProviderDescriptorSchema = z
  .object({
    provider: ProviderIdSchema,
    displayName: z.string().trim().min(1).max(120),
    availability: ProviderAvailabilitySchema,
    capabilities: ProviderCapabilitiesSchema,
    version: z.string().trim().min(1).max(120).optional(),
    testedVersion: z.string().trim().min(1).max(120).optional(),
    models: z.array(ProviderModelSchema).max(64).optional(),
    reasoningLabel: z.string().trim().min(1).max(120).optional(),
    reasoningOptions: z.array(ProviderReasoningOptionSchema).max(16).optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const modelIds = new Set<string>()
    let defaultCount = 0
    for (const [index, model] of (descriptor.models ?? []).entries()) {
      if (modelIds.has(model.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Provider model identities must be unique',
          path: ['models', index, 'id'],
        })
      }
      modelIds.add(model.id)
      if (model.isDefault === true) defaultCount += 1
    }
    if (defaultCount > 1) {
      context.addIssue({
        code: 'custom',
        message: 'A Provider can expose at most one default model',
        path: ['models'],
      })
    }
    const reasoningOptionIds = new Set<string>()
    for (const [index, option] of (
      descriptor.reasoningOptions ?? []
    ).entries()) {
      if (reasoningOptionIds.has(option.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Provider reasoning option identities must be unique',
          path: ['reasoningOptions', index, 'id'],
        })
      }
      reasoningOptionIds.add(option.id)
    }
  })
export type ProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>
