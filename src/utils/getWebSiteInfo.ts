export interface WebSiteInfo {
  host: string
  hostname: string
  href: string
  origin: string
  title: string
  icon: string
  description: string
}

const getWebSiteInfo = (): WebSiteInfo => {
  return {
    host: document.location.host,
    hostname: document.location.hostname,
    href: document.location.href,
    origin: document.location.origin,
    title:
      document.querySelector('meta[rel="og:title i"]')?.getAttribute('content') ??
      document.querySelector('meta[rel="og:title i"]')?.getAttribute('content') ??
      document.querySelector('meta[rel="og:site_name i"]')?.getAttribute('content') ??
      document.title,
    icon:
      document.querySelector('meta[property="og:image" i]')?.getAttribute('href') ??
      document.querySelector('link[rel="icon" i]')?.getAttribute('href') ??
      document.querySelector('link[rel="shortcut icon" i]')?.getAttribute('href') ??
      `${document.location.origin}/favicon.ico`,
    description:
      document.querySelector('meta[property="og:description i"]')?.getAttribute('content') ??
      document.querySelector('meta[name="description" i]')?.getAttribute('content') ??
      ''
  }
}

export default getWebSiteInfo
