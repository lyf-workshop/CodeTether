import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type {
  GetOnboardingResponse,
  OnboardingTransition,
  UpdateOnboardingRequest,
  UpdateOnboardingResponse,
} from '@codetether/protocol'

import { createBrowserActionId, type ActionIdFactory } from './action-id.js'

export interface OnboardingReadClient {
  getOnboarding(options?: {
    readonly signal?: AbortSignal
  }): Promise<GetOnboardingResponse>
}

export interface OnboardingMutationClient {
  updateOnboarding(
    request: UpdateOnboardingRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<UpdateOnboardingResponse>
}

export const onboardingQueryKeys = {
  all: ['host', 'onboarding'] as const,
  progress: ['host', 'onboarding', 'progress'] as const,
}

export function onboardingQueryOptions(client: OnboardingReadClient) {
  return queryOptions({
    queryKey: onboardingQueryKeys.progress,
    queryFn: async ({ signal }) =>
      (await client.getOnboarding({ signal })).onboarding,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

interface TransitionAttempt {
  readonly identity: string
  readonly promise: Promise<UpdateOnboardingResponse>
}

/** Owns action identity and coalesces duplicate UI transitions. */
export class OnboardingActions {
  readonly #client: OnboardingMutationClient
  readonly #queryClient: QueryClient
  readonly #createActionId: ActionIdFactory
  #attempt?: TransitionAttempt

  constructor(
    client: OnboardingMutationClient,
    queryClient: QueryClient,
    createActionId: ActionIdFactory = createBrowserActionId,
  ) {
    this.#client = client
    this.#queryClient = queryClient
    this.#createActionId = createActionId
  }

  update(
    expectedRevision: number,
    transition: OnboardingTransition,
  ): Promise<UpdateOnboardingResponse> {
    const identity = JSON.stringify([expectedRevision, transition])
    if (this.#attempt?.identity === identity) return this.#attempt.promise

    const request: UpdateOnboardingRequest = {
      actionId: this.#createActionId(),
      expectedRevision,
      transition,
    }
    const promise = this.#client
      .updateOnboarding(request)
      .then((response) => {
        this.#queryClient.setQueryData(
          onboardingQueryKeys.progress,
          response.data.onboarding,
        )
        return response
      })
      .finally(() => {
        if (this.#attempt?.promise === promise) this.#attempt = undefined
      })
    this.#attempt = { identity, promise }
    return promise
  }
}
