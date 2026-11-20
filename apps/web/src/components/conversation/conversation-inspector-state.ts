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

export function resolveConversationInspectorTab(
  requested: InspectorTab | undefined,
  options: {
    readonly supportsDiff: boolean
    readonly hasChanges: boolean
    readonly hasViewedFiles: boolean
    readonly supportsToolOutput: boolean
    readonly hasToolOutput: boolean
  },
): VisibleInspectorTab | undefined {
  const {
    supportsDiff,
    hasChanges,
    hasViewedFiles,
    supportsToolOutput,
    hasToolOutput,
  } = options
  const showViewedFiles = !supportsDiff && hasViewedFiles
  if (requested === 'changes' && supportsDiff) return 'changes'
  if (requested === 'files') {
    if (supportsDiff) return 'changes'
    if (showViewedFiles) return 'files'
  }
  if (
    (requested === 'tools' || requested === 'terminal') &&
    supportsToolOutput
  ) {
    return 'tools'
  }
  if (supportsDiff && hasChanges) return 'changes'
  if (showViewedFiles) return 'files'
  if (supportsToolOutput && hasToolOutput) return 'tools'
  if (supportsDiff) return 'changes'
  return supportsToolOutput ? 'tools' : undefined
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
