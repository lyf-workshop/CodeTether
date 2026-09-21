import type { Metadata } from 'next'
import { DocsPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Docs' }

export default function DocsPage() {
  return <DocsPageContent />
}
