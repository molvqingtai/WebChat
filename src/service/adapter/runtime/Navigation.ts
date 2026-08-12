export const canonicalNavigationUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export const isSameNavigation = (left: string, right: string) => {
  const canonicalLeft = canonicalNavigationUrl(left)
  return canonicalLeft !== null && canonicalLeft === canonicalNavigationUrl(right)
}

export const isEligibleContentUrl = (value: string) => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1'
  } catch {
    return false
  }
}
