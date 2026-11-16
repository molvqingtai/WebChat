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
export const buildFullURL = (baseURL: string = '', pathURL: string = '', params: Record<string, string> = {}) => {
  const url = cleanURL(isAbsoluteURL(pathURL) ? pathURL : `${baseURL}/${pathURL}`)
  return assembleURL(url, params)
}

/** Following these can run code, read local files or probe which extensions are installed. */
const UNSAFE_SCHEME = /^(javascript|vbscript|file|about|blob|filesystem|chrome|chrome-extension|moz-extension):/i
/** A data URL is only useful to us when it is media the renderer knows how to show. */
const DATA_URL = /^data:/i
const MEDIA_DATA_URL = /^data:(image|video|audio)\//i
/** Browsers drop these before parsing a scheme, so the check has to see what they see. */
// oxlint-disable-next-line no-control-regex -- the control characters are the thing being removed
const IGNORED_IN_URL = /[\u0000-\u0020\u007f]+/g

const isSafeUrl = (url: string) => !UNSAFE_SCHEME.test(url) && (!DATA_URL.test(url) || MEDIA_DATA_URL.test(url))

/**
 * Sanitize a URL that came from a message before it reaches an attribute.
 *
 * `java\tscript:alert(1)` navigates as `javascript:alert(1)` because the browser removes tab,
 * newline and leading control characters first, so the scheme is judged on that normalized form.
 * Everything else is left alone: a chat client should not decide that `tel:` or `magnet:` is a
 * scheme its users may not share.
 */
export const safeUrl = (url: string): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- defensive check: this sanitizer also guards untrusted callers
  if (!url || typeof url !== 'string') return ''
  return isSafeUrl(url.replace(IGNORED_IN_URL, '')) ? url : ''
}
