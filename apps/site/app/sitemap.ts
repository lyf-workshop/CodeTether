import type { MetadataRoute } from 'next'
import { siteConfig } from '../lib/site-config'

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '',
    '/product',
    '/security',
    '/download',
    '/docs',
    '/signin',
    '/privacy',
    '/terms',
  ]
  return paths.map((path) => ({
    url: `${siteConfig.url}${path}`,
    lastModified: new Date(),
  }))
}
