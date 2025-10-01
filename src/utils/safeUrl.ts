/**
 * Sanitize URL to prevent XSS attacks
 * @param url - The URL to sanitize
 * @returns Sanitized URL or empty string if invalid
 */
export const safeUrl = (url: string): string => {
  if (!url || typeof url !== 'string' || !URL.canParse(url)) return ''

  // Only allow media data URIs (image/video/audio)
  if (url.startsWith('data:')) return /^data:(image|video|audio)\//i.test(url) ? url : ''

  // Block dangerous protocols
  if (/^(javascript|vbscript|file|about):/i.test(url)) return ''

  return url
}
