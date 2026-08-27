export type InspectorTab = 'overview' | 'changes' | 'terminal' | 'context'

export interface ConversationInspectorState {
  readonly open: boolean
  readonly tab: InspectorTab
}

export function createConversationInspectorState(
  tab: InspectorTab,
  open: boolean,
): ConversationInspectorState {
  return { open, tab }
}

export function setConversationInspectorOpen(
  state: ConversationInspectorState,
  open: boolean,
): ConversationInspectorState {
  return { ...state, open }
}

export function openConversationInspectorTab(
  state: ConversationInspectorState,
  tab: InspectorTab,
  open: boolean,
): ConversationInspectorState {
  return { ...state, open, tab }
}

export function selectConversationInspectorTab(
  state: ConversationInspectorState,
  tab: InspectorTab,
): ConversationInspectorState {
  return { ...state, tab }
}
