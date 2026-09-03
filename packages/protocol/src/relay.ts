import { z } from 'zod'

import { CanonicalFailureSchema } from './errors.js'
import {
  ActionIdSchema,
  MachineIdSchema,
  ProtocolVersionSchema,
  TimestampSchema,
} from './ids.js'

export const RelayIdentityFingerprintSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u)
export type RelayIdentityFingerprint = z.infer<
  typeof RelayIdentityFingerprintSchema
>

export const RelayTransportSecuritySchema = z.enum([
  'public_ca',
  'pinned_identity',
])
export type RelayTransportSecurity = z.infer<
  typeof RelayTransportSecuritySchema
>

export const RelayEndpointSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine(
        (value) =>
          !/[\s\0/@\\]/u.test(value) &&
          !value.includes('://') &&
          value !== '.' &&
          value !== '..',
        'Relay host must be a hostname or IP address',
      ),
    port: z.number().int().min(1).max(65_535),
    transportSecurity: RelayTransportSecuritySchema,
  })
  .strict()
export type RelayEndpoint = z.infer<typeof RelayEndpointSchema>

export const RelayConnectionStateSchema = z.enum([
  'not_configured',
  'enrollment_required',
  'connecting',
  'connected',
  'reconnecting',
  'offline',
  'identity_mismatch',
  'authentication_failed',
  'revoked',
  'incompatible',
])
export type RelayConnectionState = z.infer<typeof RelayConnectionStateSchema>

export const RelayEnrollmentStateSchema = z.enum([
  'not_configured',
  'required',
  'enrolled',
  'revoked',
])
export type RelayEnrollmentState = z.infer<typeof RelayEnrollmentStateSchema>

/** Infrastructure reachability only; never Provider or execution health. */
export const RelayNodePresenceSchema = z.enum([
  'not_observed',
  'online',
  'offline',
  'unauthorized',
])
export type RelayNodePresence = z.infer<typeof RelayNodePresenceSchema>

export const RelayMachineConnectivitySchema = z
  .object({
    state: RelayConnectionStateSchema,
    enrollment: RelayEnrollmentStateSchema,
    nodePresence: RelayNodePresenceSchema,
    /** Phase 7A is control/presence only. This value must remain false. */
    internetExecutionEnabled: z.literal(false),
    endpoint: RelayEndpointSchema.optional(),
    relayIdentityFingerprint: RelayIdentityFingerprintSchema.optional(),
    displayLabel: z.string().trim().min(1).max(120).optional(),
    lastConnectedAt: TimestampSchema.optional(),
    lastAttemptAt: TimestampSchema.optional(),
    failure: CanonicalFailureSchema.optional(),
  })
  .strict()
  .superRefine((relay, context) => {
    const configured = relay.state !== 'not_configured'
    if (
      configured !==
      (relay.endpoint !== undefined &&
        relay.relayIdentityFingerprint !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Configured Relay state requires one endpoint and identity',
        path: ['endpoint'],
      })
    }
    if (
      (relay.state === 'not_configured') !==
      (relay.enrollment === 'not_configured')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Relay configuration and enrollment state must agree',
        path: ['enrollment'],
      })
    }
    if (
      relay.state === 'enrollment_required' &&
      relay.enrollment !== 'required'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Relay enrollment-required state must be explicit',
        path: ['enrollment'],
      })
    }
    if (
      relay.enrollment === 'required' &&
      (relay.state === 'connecting' ||
        relay.state === 'connected' ||
        relay.state === 'reconnecting')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unenrolled Relay cannot be connecting or connected',
        path: ['state'],
      })
    }
    if ((relay.state === 'revoked') !== (relay.enrollment === 'revoked')) {
      context.addIssue({
        code: 'custom',
        message: 'Relay revocation state must be explicit',
        path: ['enrollment'],
      })
    }
    if (
      relay.enrollment === 'enrolled' &&
      (relay.state === 'not_configured' ||
        relay.state === 'enrollment_required' ||
        relay.state === 'revoked')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Enrolled Relay state conflicts with its connection state',
        path: ['state'],
      })
    }
    if (relay.state !== 'connected' && relay.nodePresence === 'online') {
      context.addIssue({
        code: 'custom',
        message: 'Online Node presence requires a connected Relay',
        path: ['nodePresence'],
      })
    }
    if (relay.failure !== undefined && relay.failure.source !== 'relay') {
      context.addIssue({
        code: 'custom',
        message: 'Relay status may contain only Relay-sourced diagnostics',
        path: ['failure', 'source'],
      })
    }
  })
export type RelayMachineConnectivity = z.infer<
  typeof RelayMachineConnectivitySchema
>

export const ConfigureMachineRelayRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    endpoint: RelayEndpointSchema,
    relayIdentityFingerprint: RelayIdentityFingerprintSchema,
    displayLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
export type ConfigureMachineRelayRequest = z.infer<
  typeof ConfigureMachineRelayRequestSchema
>

export const RelayEnrollmentTokenSchema = z
  .string()
  .trim()
  .regex(/^relay_enroll_[A-Za-z0-9_-]{43}$/u)
export type RelayEnrollmentToken = z.infer<typeof RelayEnrollmentTokenSchema>

export const EnrollMachineRelayRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    enrollmentToken: RelayEnrollmentTokenSchema,
  })
  .strict()
export type EnrollMachineRelayRequest = z.infer<
  typeof EnrollMachineRelayRequestSchema
>

export const RetryMachineRelayRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type RetryMachineRelayRequest = z.infer<
  typeof RetryMachineRelayRequestSchema
>

export const DisconnectMachineRelayRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type DisconnectMachineRelayRequest = z.infer<
  typeof DisconnectMachineRelayRequestSchema
>

export const RemoveMachineRelayRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type RemoveMachineRelayRequest = z.infer<
  typeof RemoveMachineRelayRequestSchema
>

export const MachineRelayMutationDataSchema = z
  .object({
    machineId: MachineIdSchema,
    relay: RelayMachineConnectivitySchema,
  })
  .strict()
export type MachineRelayMutationData = z.infer<
  typeof MachineRelayMutationDataSchema
>

function relayMutationResponseSchema() {
  return z
    .object({
      protocolVersion: ProtocolVersionSchema,
      actionId: ActionIdSchema,
      status: z.enum(['accepted', 'completed', 'rejected']),
      data: MachineRelayMutationDataSchema,
    })
    .strict()
}

export const ConfigureMachineRelayResponseSchema = relayMutationResponseSchema()
export type ConfigureMachineRelayResponse = z.infer<
  typeof ConfigureMachineRelayResponseSchema
>

export const EnrollMachineRelayResponseSchema = relayMutationResponseSchema()
export type EnrollMachineRelayResponse = z.infer<
  typeof EnrollMachineRelayResponseSchema
>

export const RetryMachineRelayResponseSchema = relayMutationResponseSchema()
export type RetryMachineRelayResponse = z.infer<
  typeof RetryMachineRelayResponseSchema
>

export const DisconnectMachineRelayResponseSchema =
  relayMutationResponseSchema()
export type DisconnectMachineRelayResponse = z.infer<
  typeof DisconnectMachineRelayResponseSchema
>

export const RemoveMachineRelayResponseSchema = relayMutationResponseSchema()
export type RemoveMachineRelayResponse = z.infer<
  typeof RemoveMachineRelayResponseSchema
>

export const relayWireLimits = {
  displayLabelCharacters: 120,
  enrollmentTokenCharacters: 56,
} as const
