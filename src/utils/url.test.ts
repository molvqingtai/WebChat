import { describe, expect, it } from 'vitest'
import { safeUrl } from './url'

describe('safeUrl', () => {
  it('keeps the URLs a message is allowed to link to', () => {
    for (const url of [
      'https://example.com/x',
      'http://example.com',
      'mailto:a@b.c',
      'xmpp:a@b.c',
      '/relative/path',
      '//example.com/x',
      '#anchor'
    ]) {
      expect(safeUrl(url)).toBe(url)
    }
  })

  it('keeps media data URLs and drops any other data payload', () => {
    expect(safeUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(safeUrl('data:application/javascript,alert(1)')).toBe('')
  })

  it('drops a scheme the browser would still parse after removing whitespace', () => {
    // Chrome turns every one of these into javascript:alert(1) when it follows the link.
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBe('')
    expect(safeUrl('java\tscript:alert(1)')).toBe('')
    expect(safeUrl('java\nscript:alert(1)')).toBe('')
    expect(safeUrl(' java script:alert(1)')).toBe('')
    expect(safeUrl('\u0001javascript:alert(1)')).toBe('')
  })

  it('drops schemes the product never links to', () => {
    for (const url of [
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/x',
      'about:blank',
      'chrome-extension://abc/x.html'
    ]) {
      expect(safeUrl(url)).toBe('')
    }
  })

  it('does not treat an empty or non-string value as a URL', () => {
    expect(safeUrl('')).toBe('')
    // @ts-expect-error -- the sanitizer also guards callers that pass untrusted values
    expect(safeUrl(undefined)).toBe('')
  })
})
