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

/** First non-null `content` among the given meta selectors. */
const readMetaContent = (selectors: readonly string[]): string | undefined => {
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute('content')
    if (content !== null && content !== undefined) return content
  }
  return undefined
}

/** Display-safe World presence metadata. Raw href/host/hostname never leave this helper. */
const getSiteMeta = (): ChatSite => {
  const title =
    readMetaContent([
      'meta[property="og:site_name" i]',
      'meta[property="og:title" i]',
      'meta[name="twitter:title" i]',
      'meta[itemprop="name" i]',
      'meta[name="application-name" i]'
    ]) ?? document.title
  const description =
    readMetaContent([
      'meta[property="og:description" i]',
      'meta[name="description" i]',
      'meta[name="twitter:description" i]',
      'meta[itemprop="description" i]'
    ]) ?? ''

  const site: ChatSite = { origin: document.location.origin, icon: getIcon() }
  if (title) site.title = title
  if (description) site.description = description
  return site
}

export default getSiteMeta
