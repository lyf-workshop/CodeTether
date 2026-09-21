import type { Metadata } from 'next'
import { SignInPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  return <SignInPageContent />
}
