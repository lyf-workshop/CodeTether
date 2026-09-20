import { randomUUID } from 'node:crypto'
import { z } from 'zod'

function opaqueIdSchema<const Prefix extends string>(prefix: Prefix) {
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$`),
      `Expected a ${prefix}_ opaque identifier`,
    )
    .brand<`${Prefix}Id`>()
}

export const userIdSchema = opaqueIdSchema('usr')
export type UserId = z.infer<typeof userIdSchema>

export const loginIdentityIdSchema = opaqueIdSchema('login')
export type LoginIdentityId = z.infer<typeof loginIdentityIdSchema>

export const spaceIdSchema = opaqueIdSchema('space')
export type SpaceId = z.infer<typeof spaceIdSchema>

export const productDeviceIdSchema = opaqueIdSchema('dev')
export type ProductDeviceId = z.infer<typeof productDeviceIdSchema>

export const hostIdSchema = opaqueIdSchema('host')
export type HostId = z.infer<typeof hostIdSchema>

export const hostClaimIdSchema = opaqueIdSchema('hclaim')
export type HostClaimId = z.infer<typeof hostClaimIdSchema>

export const hostAuthorizationIdSchema = opaqueIdSchema('hauth')
export type HostAuthorizationId = z.infer<typeof hostAuthorizationIdSchema>

export const deviceSessionBindingIdSchema = opaqueIdSchema('dsb')
export type DeviceSessionBindingId = z.infer<
  typeof deviceSessionBindingIdSchema
>

export const enrollmentChallengeIdSchema = opaqueIdSchema('enroll')
export type EnrollmentChallengeId = z.infer<typeof enrollmentChallengeIdSchema>

export const rendezvousBindingIdSchema = opaqueIdSchema('rvb')
export type RendezvousBindingId = z.infer<typeof rendezvousBindingIdSchema>

export const securityEventIdSchema = opaqueIdSchema('sevt')
export type SecurityEventId = z.infer<typeof securityEventIdSchema>

function createOpaqueId<Schema extends z.ZodType<string>>(
  schema: Schema,
  prefix: string,
): z.infer<Schema> {
  return schema.parse(`${prefix}_${randomUUID().replaceAll('-', '')}`)
}

export const createUserId = (): UserId => createOpaqueId(userIdSchema, 'usr')
export const createLoginIdentityId = (): LoginIdentityId =>
  createOpaqueId(loginIdentityIdSchema, 'login')
export const createSpaceId = (): SpaceId =>
  createOpaqueId(spaceIdSchema, 'space')
export const createProductDeviceId = (): ProductDeviceId =>
  createOpaqueId(productDeviceIdSchema, 'dev')
export const createHostId = (): HostId => createOpaqueId(hostIdSchema, 'host')
export const createHostClaimId = (): HostClaimId =>
  createOpaqueId(hostClaimIdSchema, 'hclaim')
export const createHostAuthorizationId = (): HostAuthorizationId =>
  createOpaqueId(hostAuthorizationIdSchema, 'hauth')
export const createDeviceSessionBindingId = (): DeviceSessionBindingId =>
  createOpaqueId(deviceSessionBindingIdSchema, 'dsb')
export const createEnrollmentChallengeId = (): EnrollmentChallengeId =>
  createOpaqueId(enrollmentChallengeIdSchema, 'enroll')
export const createRendezvousBindingId = (): RendezvousBindingId =>
  createOpaqueId(rendezvousBindingIdSchema, 'rvb')
export const createSecurityEventId = (): SecurityEventId =>
  createOpaqueId(securityEventIdSchema, 'sevt')
