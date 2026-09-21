export const siteConfig = {
  name: 'CodeTether',
  description:
    'Keep coding agents on the machines where your code already lives. Take the control plane everywhere.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  githubUrl: 'https://github.com/codetether/codetether',
  downloads: {
    windows: null,
    macos: null,
    linux: null,
    ios: null,
    android: null,
  },
} as const

export const navItems = [
  { label: 'Product', href: '/product' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Security', href: '/security' },
  { label: 'Docs', href: '/docs' },
  { label: 'Download', href: '/download' },
] as const

export type DownloadKey = keyof typeof siteConfig.downloads
