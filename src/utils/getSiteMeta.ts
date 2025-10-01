import { buildFullURL } from '@/utils'

export interface SiteMeta {
  host: string
  hostname: string
  href: string
  origin: string
  title: string
  icon: string
  description: string
}

const getIcon = (): string => {
  const path =
    document.querySelector('link[rel="icon" i]')?.getAttribute('href') ??
    document.querySelector('link[rel="shortcut icon" i]')?.getAttribute('href') ??
    document.querySelector('link[rel^="apple-touch-icon" i]')?.getAttribute('href') ??
    document.querySelector('link[rel="mask-icon" i]')?.getAttribute('href') ??
    document.querySelector('link[rel="fluid-icon" i]')?.getAttribute('href') ??
    document.querySelector('meta[property="og:image" i]')?.getAttribute('content') ??
    document.querySelector('meta[name^="msapplication" i]')?.getAttribute('content') ??
    document.querySelector('meta[itemprop="image" i]')?.getAttribute('content') ??
    `/favicon.ico`

  if (/^(data:|\/\/|https?:\/\/)/.test(path)) {
    return path
  } else {
    return buildFullURL(document.location.origin, path)
  }
}

const getSiteMeta = (): SiteMeta => {
  return {
    host: document.location.host,
    hostname: document.location.hostname,
    href: document.location.href,
    origin: document.location.origin,
    title:
      document.querySelector('meta[property="og:site_name" i]')?.getAttribute('content') ??
      document.querySelector('meta[property="og:title" i]')?.getAttribute('content') ??
      document.querySelector('meta[name="twitter:title" i]')?.getAttribute('content') ??
      document.querySelector('meta[itemprop="name" i]')?.getAttribute('content') ??
      document.querySelector('meta[name="application-name" i]')?.getAttribute('content') ??
      document.title,
    icon: getIcon(),
    description:
      document.querySelector('meta[property="og:description" i]')?.getAttribute('content') ??
      document.querySelector('meta[name="description" i]')?.getAttribute('content') ??
      document.querySelector('meta[name="twitter:description" i]')?.getAttribute('content') ??
      document.querySelector('meta[itemprop="description" i]')?.getAttribute('content') ??
      ''
  }
}

export default getSiteMeta
