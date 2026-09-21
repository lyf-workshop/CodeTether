import type { Metadata } from 'next'
import { LegalPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  return <LegalPageContent kind="privacy" />
}
