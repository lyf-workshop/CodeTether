import Link from 'next/link'
import { siteConfig } from '../lib/site-config'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Link className="footer-brand" href="/">
          CodeTether
        </Link>
        <nav className="footer-nav" aria-label="Footer navigation">
          <Link href="/product">Product</Link>
          <Link href="/security">Security</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/download">Download</Link>
          <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  )
}
