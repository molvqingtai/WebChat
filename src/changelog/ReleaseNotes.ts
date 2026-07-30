export interface ReleaseNotes {
  version: string
  date: string
  body: string
}

export interface ReleaseLinks {
  repository: string
  release: string
  issues: string
}

const releaseHeading = () => /^(?:#|##)\s+\[([^\]]+)\](?:\([^\n)]+\))?\s+\((\d{4}-\d{2}-\d{2})\)\s*$/gm

export const extractTopRelease = (source: string): ReleaseNotes | null => {
  const matches = [...source.matchAll(releaseHeading())]
  const current = matches[0]
  if (!current || current.index === undefined) return null

  const version = current[1]?.trim()
  const date = current[2]
  if (!version || !date) return null

  const bodyStart = current.index + current[0].length
  const bodyEnd = matches[1]?.index ?? source.length
  const body = source.slice(bodyStart, bodyEnd).trim()
  if (!body) return null

  return { version, date, body }
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const createReleaseLinks = (homepage: string, bugsUrl: string, version: string): ReleaseLinks => {
  const repository = withoutTrailingSlash(homepage)
  return {
    repository,
    release: `${repository}/releases/tag/v${version}`,
    issues: `${withoutTrailingSlash(bugsUrl)}/new`
  }
}
