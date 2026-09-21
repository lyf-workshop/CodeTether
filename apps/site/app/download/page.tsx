import type { Metadata } from 'next'
import { DownloadPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Download' }

export default function DownloadPage() {
  return <DownloadPageContent />
}
