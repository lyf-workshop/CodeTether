import { PreviousConversationsView } from './previous-conversations-view'
import {
  usePreviousConversations,
  type PreviousConversationsStepProps,
} from './use-previous-conversations'

export function PreviousConversationsStep(
  props: PreviousConversationsStepProps,
) {
  const state = usePreviousConversations(props)
  return <PreviousConversationsView {...state} />
}
