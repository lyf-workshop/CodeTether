export interface ActiveConversation {
  readonly machineId: string
  readonly status: string
}

/** Undefined means the local Machine or the Host snapshot is not known yet. */
export function countLocalActiveConversations(
  conversations: readonly ActiveConversation[] | undefined,
  localMachineId: string | undefined,
): number | undefined {
  if (conversations === undefined || localMachineId === undefined)
    return undefined
  let count = 0
  for (const conversation of conversations) {
    if (
      conversation.machineId === localMachineId &&
      (conversation.status === 'running' || conversation.status === 'waiting')
    ) {
      count += 1
    }
  }
  return count
}

export function updateNotesText(notes: string | undefined): string | undefined {
  return notes === undefined
    ? undefined
    : Array.from(notes).slice(0, 2000).join('')
}
