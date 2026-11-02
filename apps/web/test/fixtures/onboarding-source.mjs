import { readFileSync } from 'node:fs'

/** The page's directly connected presentation tree; no safety assertion is dropped. */
export function onboardingPresentationSource() {
  return [
    'onboarding-page.tsx',
    'onboarding-step-view.tsx',
    'onboarding-provider-check.tsx',
    'onboarding-project-step.tsx',
    'onboarding-remote-step.tsx',
    'onboarding-ready-step.tsx',
    'onboarding-step-feedback.tsx',
  ]
    .map((name) =>
      readFileSync(
        new URL('../../src/components/onboarding/' + name, import.meta.url),
        'utf8',
      ),
    )
    .join('\n')
}
