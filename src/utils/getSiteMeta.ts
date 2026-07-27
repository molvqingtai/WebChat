import { buildFullURL } from '@/utils'
import type { ChatSite } from '@/protocol/WorldRoom'

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
    '/favicon.ico'

  return /^(data:|\/\/|https?:\/\/)/.test(path) ? path : buildFullURL(document.location.origin, path)
}

/** Display-safe World presence metadata. Raw href/host/hostname never leave this helper. */
const getSiteMeta = (): ChatSite => {
  const title =
    document.querySelector('meta[property="og:site_name" i]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:title" i]')?.getAttribute('content') ??
    document.querySelector('meta[name="twitter:title" i]')?.getAttribute('content') ??
    document.querySelector('meta[itemprop="name" i]')?.getAttribute('content') ??
    document.querySelector('meta[name="application-name" i]')?.getAttribute('content') ??
    document.title
  const description =
    document.querySelector('meta[property="og:description" i]')?.getAttribute('content') ??
    document.querySelector('meta[name="description" i]')?.getAttribute('content') ??
    document.querySelector('meta[name="twitter:description" i]')?.getAttribute('content') ??
    document.querySelector('meta[itemprop="description" i]')?.getAttribute('content') ??
    ''

  return {
    origin: document.location.origin,
    ...(title ? { title } : {}),
    icon: getIcon(),
    ...(description ? { description } : {})
  }
}

export default getSiteMeta
