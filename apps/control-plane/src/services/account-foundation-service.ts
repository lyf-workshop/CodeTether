import type {
  AppendSecurityEvent,
  CreateDeviceSessionBinding,
  CreateEnrollmentChallenge,
  CreateHost,
  CreateHostClaim,
  CreateHostDeviceAuthorization,
  CreateProductDevice,
  CreateRendezvousBinding,
  CreateUserWithPersonalSpace,
} from '../domain/models.js'
import {
  appendSecurityEventSchema,
  createDeviceSessionBindingSchema,
  createEnrollmentChallengeSchema,
  createHostClaimSchema,
  createHostDeviceAuthorizationSchema,
  createHostSchema,
  createProductDeviceSchema,
  createRendezvousBindingSchema,
  createUserWithPersonalSpaceSchema,
} from '../domain/models.js'
import {
  enrollmentChallengeIdSchema,
  productDeviceIdSchema,
  type EnrollmentChallengeId,
  type ProductDeviceId,
} from '../domain/ids.js'
import type { ControlPlaneDatabase } from '../persistence/database.js'
import { ControlPlaneRepository } from '../persistence/control-plane-repository.js'

export class ControlPlaneInvariantError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ControlPlaneInvariantError'
  }
}

export class AccountFoundationService {
  readonly #repository: ControlPlaneRepository

  public constructor(private readonly database: ControlPlaneDatabase) {
    this.#repository = new ControlPlaneRepository(database)
  }

  public async createUserWithPersonalSpace(
    untrustedInput: CreateUserWithPersonalSpace,
  ): Promise<void> {
    const input = createUserWithPersonalSpaceSchema.parse(untrustedInput)
    await this.database.transaction(async (transaction) => {
      const repository = new ControlPlaneRepository(transaction)
      await repository.createUserWithPersonalSpaceRecords(input)
    })
  }

  public async registerProductDevice(
    untrustedInput: CreateProductDevice,
  ): Promise<void> {
    await this.#repository.createProductDevice(
      createProductDeviceSchema.parse(untrustedInput),
    )
  }

  public async revokeProductDevice(
    untrustedDeviceId: ProductDeviceId,
    revokedAt: Date,
  ): Promise<boolean> {
    const deviceId = productDeviceIdSchema.parse(untrustedDeviceId)
    return this.#repository.revokeProductDevice(deviceId, revokedAt)
  }

  public async registerHost(untrustedInput: CreateHost): Promise<void> {
    await this.#repository.createHost(createHostSchema.parse(untrustedInput))
  }

  public async createEnrollmentChallenge(
    untrustedInput: CreateEnrollmentChallenge,
  ): Promise<void> {
    await this.#repository.createEnrollmentChallenge(
      createEnrollmentChallengeSchema.parse(untrustedInput),
    )
  }

  public async consumeEnrollmentChallenge(
    untrustedChallengeId: EnrollmentChallengeId,
    expectedPurpose: CreateEnrollmentChallenge['purpose'],
    consumedAt: Date,
  ): Promise<void> {
    const challengeId = enrollmentChallengeIdSchema.parse(untrustedChallengeId)
    const consumed = await this.#repository.consumeEnrollmentChallenge(
      challengeId,
      expectedPurpose,
      consumedAt,
    )
    if (!consumed) {
      throw new ControlPlaneInvariantError(
        'Challenge is expired, consumed, absent, or has a different purpose',
      )
    }
  }

  public async recordHostClaim(untrustedInput: CreateHostClaim): Promise<void> {
    const input = createHostClaimSchema.parse(untrustedInput)
    if (!(await this.#repository.createHostClaim(input))) {
      throw new ControlPlaneInvariantError(
        'Host claim does not match the exact active host, space, device, user, generation, and challenge',
      )
    }
  }

  public async recordHostDeviceAuthorization(
    untrustedInput: CreateHostDeviceAuthorization,
  ): Promise<void> {
    const input = createHostDeviceAuthorizationSchema.parse(untrustedInput)
    if (!(await this.#repository.createHostDeviceAuthorization(input))) {
      throw new ControlPlaneInvariantError(
        'Supervisor authorization metadata does not match exact host and device authority',
      )
    }
  }

  public async bindDeviceSession(
    untrustedInput: CreateDeviceSessionBinding,
  ): Promise<void> {
    const input = createDeviceSessionBindingSchema.parse(untrustedInput)
    if (!(await this.#repository.createDeviceSessionBinding(input))) {
      throw new ControlPlaneInvariantError(
        'Device session binding does not match the exact active device generation and owner',
      )
    }
  }

  public async recordRendezvousBinding(
    untrustedInput: CreateRendezvousBinding,
  ): Promise<void> {
    await this.#repository.createRendezvousBinding(
      createRendezvousBindingSchema.parse(untrustedInput),
    )
  }

  public async appendSecurityEvent(
    untrustedInput: AppendSecurityEvent,
  ): Promise<void> {
    await this.#repository.appendSecurityEvent(
      appendSecurityEventSchema.parse(untrustedInput),
    )
  }
}
