import { Hero } from '../components/hero'
import {
  AccountDevicesStory,
  ContinuityStory,
  FinalCta,
  MobileSupervisorStory,
  RuntimeStory,
  SecurityArchitecture,
  WorkspaceStory,
} from '../components/sections'

export default function HomePage() {
  return (
    <>
      <Hero />
      <WorkspaceStory />
      <RuntimeStory />
      <ContinuityStory />
      <MobileSupervisorStory />
      <AccountDevicesStory />
      <SecurityArchitecture />
      <FinalCta />
    </>
  )
}
