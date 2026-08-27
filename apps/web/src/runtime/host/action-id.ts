import { ActionIdSchema, type ActionId } from '@codetether/protocol'

export type ActionIdFactory = () => ActionId

/** Generates an unguessable identity for one browser-originated mutation. */
export function createBrowserActionId(): ActionId {
  const randomUUID = globalThis.crypto?.randomUUID
  if (randomUUID === undefined) {
    throw new Error('Secure random action IDs are unavailable')
  }
  return ActionIdSchema.parse(`act_${randomUUID.call(globalThis.crypto)}`)
}
