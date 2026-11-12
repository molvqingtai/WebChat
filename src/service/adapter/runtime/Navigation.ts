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
