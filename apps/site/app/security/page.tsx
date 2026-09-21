import type { Metadata } from 'next'
import { SecurityPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Security' }

export default function SecurityPage() {
  return <SecurityPageContent />
}
