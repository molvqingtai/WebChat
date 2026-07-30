import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const { getURL } = vi.hoisted(() => ({
  getURL: vi.fn((path: string) => `moz-extension://webchat${path}`)
}))

vi.mock('#imports', () => ({ browser: { runtime: { getURL } } }))

import VersionLink from './version-link'

it('navigates the existing version control to the internal Changelog page', () => {
  const html = renderToStaticMarkup(createElement(VersionLink))

  expect(getURL).toHaveBeenCalledWith('/changelog.html')
  expect(html).toContain('href="moz-extension://webchat/changelog.html"')
  expect(html).not.toContain('/releases"')
})
