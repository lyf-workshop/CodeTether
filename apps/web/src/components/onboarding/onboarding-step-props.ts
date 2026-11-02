import type {
  DoctorReport,
  MachineId,
  MachineSummary,
  OnboardingProgress,
  ProjectRecord,
} from '@codetether/protocol'

export interface SetupStepProps {
  readonly doctor: DoctorReport
  readonly machines: readonly MachineSummary[]
  readonly onboarding: OnboardingProgress
  readonly projects: readonly ProjectRecord[]
  readonly busy: boolean
  readonly contextCheckFailed: boolean
  readonly contextCheckCurrent: boolean
  readonly providerRefreshFailed: boolean
  readonly projectChoicesPending: boolean
  readonly projectChoicesFailed: boolean
  readonly onRetryProjectChoices: () => void
  readonly onContinue: () => void
  readonly onProviderRefresh: () => void
  readonly onProjectSelected: (
    project: ProjectRecord,
    machineId: MachineId,
  ) => Promise<void> | void
  readonly onProjectContextLost: () => void
  readonly onPreviousConversationsFinished: (
    disposition: 'reviewed' | 'skipped',
  ) => Promise<void> | void
  readonly onRemoteSetupFinished: (
    disposition: 'configured' | 'skipped',
  ) => Promise<void> | void
  readonly onRemotePaired: (machineId: MachineId) => Promise<void> | void
  readonly onRemoteProjectCreated: () => Promise<void> | void
  readonly onCheckSelectedContext: () => void
  readonly onStart: () => void
}
