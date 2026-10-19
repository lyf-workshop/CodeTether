import type {
  OnboardingProgress,
  OnboardingStep,
  OnboardingTransition,
  ProjectRecord,
  MachineSummary,
} from '@codetether/protocol'
import { deviceProjectState } from '../machines/device-project-model.js'

/** Visual grouping only; the Host still owns all seven durable steps. */
export const onboardingScreens = [
  { id: 'welcome', label: '欢迎' },
  { id: 'checks', label: '检查 AI 工具' },
  { id: 'project_setup', label: '选择项目' },
  { id: 'previous_conversations', label: '以前的会话' },
  { id: 'remote_setup', label: '配对设备' },
  { id: 'ready', label: '完成' },
] as const

export function onboardingScreenIndex(step: OnboardingStep): number {
  switch (step) {
    case 'welcome':
      return 0
    case 'computer_check':
    case 'provider_check':
      return 1
    case 'project_setup':
      return 2
    case 'previous_conversations':
      return 3
    case 'remote_setup':
      return 4
    case 'ready':
      return 5
  }
}

export function onboardingProjectChoices(
  projects: readonly ProjectRecord[],
  machines: readonly MachineSummary[],
) {
  return [...machines]
    .sort((a, b) => Number(b.kind === 'local') - Number(a.kind === 'local'))
    .flatMap((machine) =>
      projects.flatMap((project) => {
        const location = project.locations.find(
          (location) => location.machineId === machine.machineId,
        )
        if (!location) return []
        return [
          {
            key: `${project.projectId}:${machine.machineId}`,
            project,
            machine,
            location,
            state: deviceProjectState(machine, location),
          },
        ]
      }),
    )
}

export async function continueOnboardingChecks(
  initial: OnboardingProgress,
  commit: (
    progress: OnboardingProgress,
    transition: OnboardingTransition,
  ) => Promise<OnboardingProgress | undefined>,
): Promise<OnboardingProgress | undefined> {
  const next = await commit(initial, { kind: 'continue' })
  if (initial.step === 'computer_check' && next?.step === 'provider_check') {
    return await commit(next, { kind: 'continue' })
  }
  return next
}

/** UI serialization only: Host mutations still own action IDs and revisions. */
export function createOnboardingTransitionGate() {
  let pending = false
  return {
    isPending: () => pending,
    run<T>(action: () => Promise<T> | T): Promise<T | undefined> {
      if (pending) return Promise.resolve(undefined)
      pending = true
      return Promise.resolve()
        .then(action)
        .finally(() => {
          pending = false
        })
    },
  }
}
