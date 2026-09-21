import type { Metadata } from 'next'
import './globals.css'
import { SiteFooter } from '../components/site-footer'
import { SiteHeader } from '../components/site-header'
import { siteConfig } from '../lib/site-config'

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: 'CodeTether - The control plane for coding agents',
    template: '%s | CodeTether',
  },
  description: siteConfig.description,
  alternates: { canonical: '/' },
  openGraph: {
    title: 'CodeTether - Keep the agents on your machines',
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: 'CodeTether',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CodeTether - The control plane for coding agents',
    description: siteConfig.description,
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
