import changelog from '../../CHANGELOG.md?raw'
import { bugs, homepage, version } from '../../package.json'
import { describe, expect, it } from 'vitest'
import { createReleaseLinks, extractTopRelease } from './ReleaseNotes'

describe('extractTopRelease', () => {
  it('keeps the checked-in package and top changelog versions aligned', () => {
    expect(extractTopRelease(changelog)?.version).toBe(version)
  })

  it.each(['#', '##'])('parses %s semantic-release headings and stops at the next release', (level) => {
    const source = `${level} [2.0.1](https://example.test/v2.0.1) (2026-07-29)\n\n### Fixed\n\n- current\n\n## [2.0.0](https://example.test/v2.0.0) (2026-07-28)\n\n- stale`

    expect(extractTopRelease(source)).toEqual({
      version: '2.0.1',
      date: '2026-07-29',
      body: '### Fixed\n\n- current'
    })
  })

  it('rejects malformed release sources instead of returning stale content', () => {
    expect(extractTopRelease('# Changelog\n\nNo release heading')).toBeNull()
  })
})

it('derives exact repository, release, and issue destinations from package metadata', () => {
  expect(createReleaseLinks(homepage, bugs.url, version)).toEqual({
    repository: homepage,
    release: `${homepage}/releases/tag/v${version}`,
    issues: `${bugs.url}/new`
  })
})
