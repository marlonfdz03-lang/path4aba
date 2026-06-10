import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/login', '/privacy', '/terms'],
        disallow: ['/dashboard', '/clients', '/bcba', '/admin', '/settings', '/api/'],
      },
    ],
    sitemap: 'https://path4aba.app/sitemap.xml',
  }
}
