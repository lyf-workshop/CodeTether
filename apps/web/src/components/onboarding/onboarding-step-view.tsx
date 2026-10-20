import type { SetupStepProps } from './onboarding-step-props'
import { InvalidSetupState, PrimaryContinue } from './onboarding-step-feedback'
import { OnboardingWelcome } from './onboarding-step-layout'
import { OnboardingProviderCheck } from './onboarding-provider-check'
import { OnboardingProjectStep } from './onboarding-project-step'
import { OnboardingRemoteStep } from './onboarding-remote-step'
import { OnboardingReadyStep } from './onboarding-ready-step'
import { PreviousConversationsStep } from '../projects/previous-conversations-step'

export function OnboardingStepView(props: SetupStepProps) {
  const { onboarding } = props
  switch (onboarding.step) {
    case 'welcome':
      return (
        <OnboardingWelcome>
          <PrimaryContinue busy={props.busy} onClick={props.onContinue}>
            开始设置
          </PrimaryContinue>
        </OnboardingWelcome>
      )
    case 'computer_check':
    case 'provider_check':
      return <OnboardingProviderCheck {...props} />
    case 'project_setup':
      return <OnboardingProjectStep {...props} />
    case 'previous_conversations':
      return onboarding.projectId === undefined ||
        onboarding.machineId === undefined ? (
        <InvalidSetupState
          busy={props.busy}
          onReselectProject={props.onProjectContextLost}
        />
      ) : (
        <div className="ct-onboarding-previous">
          <PreviousConversationsStep
            presentation="page"
            projectId={onboarding.projectId}
            machineId={onboarding.machineId}
            onFinished={props.onPreviousConversationsFinished}
          />
        </div>
      )
    case 'remote_setup':
      return <OnboardingRemoteStep {...props} />
    case 'ready':
      return <OnboardingReadyStep {...props} />
  }
}
