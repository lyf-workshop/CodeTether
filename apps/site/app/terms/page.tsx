import type { Metadata } from 'next'
import { LegalPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Terms' }

export default function TermsPage() {
  return <LegalPageContent kind="terms" />
}
