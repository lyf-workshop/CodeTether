/**
 * `overview`, `terminal`, and `context` remain accepted as legacy route/state
 * values so old deep links and callers do not fail. They are normalized to the
 * current product surfaces and are never rendered as tabs.
 */
export type InspectorTab =
  'files' | 'changes' | 'tools' | 'overview' | 'terminal' | 'context'

export type VisibleInspectorTab = 'files' | 'changes' | 'tools'

export function normalizeConversationInspectorTab(
  tab: InspectorTab,
): VisibleInspectorTab {
  if (tab === 'changes') return 'changes'
  if (tab === 'terminal') return 'tools'
  if (tab === 'tools') return 'tools'
  return 'files'
}

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
