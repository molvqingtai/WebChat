import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChangelogView } from './App'

const links = {
  repository: 'https://github.com/molvqingtai/WebChat',
  release: 'https://github.com/molvqingtai/WebChat/releases/tag/v2.0.1',
  issues: 'https://github.com/molvqingtai/WebChat/issues/new'
}

describe('ChangelogView', () => {
  it('renders the local release record and exact outbound commands', () => {
    const html = renderToStaticMarkup(
      createElement(ChangelogView, {
        version: '2.0.1',
        release: {
          version: '2.0.1',
          date: '2026-07-29',
          body: '### Bug Fixes\n\n- Preserved `offline` notes.'
        },
        links
      })
    )

    expect(html).toContain('WebChat v2.0.1')
    expect(html).toContain('2026-07-29')
    expect(html).toContain('Bug Fixes')
    expect(html).not.toContain('data-release-spine')
    expect(html.match(/data-slot="badge"/g)).toHaveLength(2)
    expect(html.match(/data-slot="button"/g)).toHaveLength(3)
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(header).toContain('<header class="flex flex-col items-center text-center">')
    expect(header).not.toContain('New version')
    expect(header).not.toContain('border-b')
    expect(header).toContain('justify-center')
    expect(header.indexOf('<img')).toBeLessThan(header.indexOf('<h1'))
    expect(header.indexOf('<h1')).toBeLessThan(header.indexOf('data-slot="badge"'))
    expect(html).toContain('aria-label="WebChat v2.0.1"')
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('sm:grid-cols-3')
    expect(html).toContain('h-10')
    expect(html).toContain(`href="${links.repository}"`)
    expect(html).toContain(`href="${links.release}"`)
    expect(html).toContain(`href="${links.issues}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders a nonblank local fallback and suppresses remote Markdown media or raw HTML', () => {
    const fallback = renderToStaticMarkup(createElement(ChangelogView, { version: '2.0.1', release: null, links }))
    expect(fallback).toContain('Release notes are unavailable in this build.')
    expect(fallback).toContain('WebChat v2.0.1')
    expect(fallback).not.toContain('data-release-spine')
    expect(fallback.match(/data-slot="badge"/g)).toHaveLength(1)
    expect(fallback.match(/data-slot="button"/g)).toHaveLength(3)

    const hostile = renderToStaticMarkup(
      createElement(ChangelogView, {
        version: '2.0.1',
        release: {
          version: '2.0.1',
          date: '2026-07-29',
          body: '![remote](https://evil.example/image.png)\n\n<script src="https://evil.example/run.js"></script>'
        },
        links
      })
    )
    expect(hostile).not.toContain('https://evil.example/image.png')
    expect(hostile).not.toContain('<script')
  })
})
