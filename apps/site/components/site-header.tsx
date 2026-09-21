'use client'

import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { navItems, siteConfig } from '../lib/site-config'

export function SiteHeader() {
  const [open, setOpen] = useState(false)

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link
          className="brand"
          href="/"
          aria-label="CodeTether home"
          onClick={() => setOpen(false)}
        >
          <img src="/brand/codetether-mark.svg" alt="" width={28} height={28} />
          <span>CodeTether</span>
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <a
            className="button button-ghost button-small"
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <Link className="button button-dark button-small" href="/download">
            Download
          </Link>
        </div>

        <button
          className="mobile-menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <X size={20} strokeWidth={1.7} />
          ) : (
            <Menu size={20} strokeWidth={1.7} />
          )}
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-navigation"
          className="mobile-nav"
          aria-label="Mobile navigation"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className="mobile-nav-actions">
            <a
              className="button button-ghost"
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <Link
              className="button button-dark"
              href="/download"
              onClick={() => setOpen(false)}
            >
              Download
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  )
}
