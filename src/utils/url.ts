export const cleanURL = (url: string) => url.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '')

/**
 * Determines whether the specified URL is absolute
 * Reference: https://github.com/axios/axios/blob/v1.x/lib/helpers/isAbsoluteURL.js
 */
export const isAbsoluteURL = (url: string) => {
  // A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
  // RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed
  // by any combination of letters, digits, plus, period, or hyphen.
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url)
}

/**
 * Add params to the URL
 */
export const assembleURL = (url: string, params: Record<string, string>) => {
  return Object.entries(params)
    .reduce((url, [key, value]) => {
      url.searchParams.append(key, value)
      return url
    }, new URL(url))
    .toString()
}

/**
 * Creates a new URL by combining the baseURL with the requestedURL,
 * only when the requestedURL is not already an absolute URL.
 * If the requestURL is absolute, this function returns the requestedURL untouched.
 *
 * reference: https://github.com/axios/axios/blob/v1.x/lib/core/buildFullPath.js
 */
export const buildFullURL = (baseURL: string = '', pathURL: string = '', params: Record<string, any> = {}) => {
  const url = cleanURL(isAbsoluteURL(pathURL) ? pathURL : `${baseURL}/${pathURL}`)
  return assembleURL(url, params)
}

/**
 * Sanitize URL to prevent XSS attacks
 * @param url - The URL to sanitize
 * @returns Sanitized URL or empty string if invalid
 */
export const safeUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return ''

  // Block dangerous protocols
  if (/^(javascript|vbscript|file|about):/i.test(url)) return ''

  // Only allow media data URIs (image/video/audio)
  if (url.startsWith('data:') && !/^data:(image|video|audio)\//i.test(url)) return ''

  return url
}
