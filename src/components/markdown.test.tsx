import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_PREVIEW_TRANSITION_PART, MediaPreviewContext } from './media-preview'
import { Markdown } from './markdown'

afterEach(cleanup)

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('message image rendering', () => {
  it('uses one query-container policy for Markdown images and image-valued links', () => {
    const view = render(
      <Markdown>{'![Cat](https://example.com/cat.png)\n\n[Diagram](https://example.com/diagram.webp)'}</Markdown>
    )

    const container = view.container.firstElementChild as HTMLElement
    const triggers = screen.getAllByRole('button')
    const images = screen.getAllByRole('img')

    expect(container.style.containerType).toBe('inline-size')
    expect(triggers).toHaveLength(2)
    expect(images).toHaveLength(2)
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['Cat', 'Diagram'])
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'https://example.com/cat.png',
      'https://example.com/diagram.webp'
    ])

    for (const image of images) {
      expect(image.style.maxInlineSize).toBe('70cqi')
      expect(image.style.maxBlockSize).toBe('70cqi')
      expect(image.style.inlineSize).toBe('auto')
      expect(image.style.blockSize).toBe('auto')
      expect(image.style.objectFit).toBe('contain')
      expect(image.getAttribute('part')).toBe(MEDIA_PREVIEW_TRANSITION_PART)
      expect(image.closest('button')).not.toBeNull()
    }
  })

  it('keeps invalid image sources sanitized instead of creating a raw-source preview path', () => {
    render(<Markdown>{'![Unsafe](javascript:alert(1))'}</Markdown>)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('preserves formatted image-link text in the inline image and preview request', () => {
    const openPreview = vi.fn()
    render(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{'[**Diagram**](https://example.com/diagram.webp)'}</Markdown>
      </MediaPreviewContext.Provider>
    )

    const trigger = screen.getByRole('button', { name: 'Preview Diagram' })
    expect(screen.getByRole('img', { name: 'Diagram' })).not.toBeNull()

    fireEvent.click(trigger)
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'https://example.com/diagram.webp',
        alt: 'Diagram',
        activator: trigger,
        transitionElement: trigger.querySelector('img')
      })
    )
  })

  it('activates the same sanitized preview request by pointer, touch, Enter, and Space', async () => {
    const openPreview = vi.fn()
    const user = userEvent.setup()
    render(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{'![Cat](https://example.com/cat.png)\n\n[Diagram](https://example.com/diagram.webp)'}</Markdown>
      </MediaPreviewContext.Provider>
    )
    const [first, second] = screen.getAllByRole('button')

    fireEvent.click(first)
    first.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    fireEvent.pointerDown(second, { pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(second, { pointerId: 1, pointerType: 'touch' })
    fireEvent.click(second)

    expect(openPreview).toHaveBeenCalledTimes(4)
    expect(openPreview.mock.calls[0]![0]).toMatchObject({
      src: 'https://example.com/cat.png',
      alt: 'Cat',
      activator: first,
      transitionElement: first.querySelector('img')
    })
    expect(openPreview.mock.calls[3]![0]).toMatchObject({
      src: 'https://example.com/diagram.webp',
      alt: 'Diagram',
      activator: second,
      transitionElement: second.querySelector('img')
    })
  })

  it('keeps one inline image policy and excludes parallel sizing or preview ownership', () => {
    const markdown = source('./markdown.tsx')
    const preview = source('./media-preview.tsx')

    expect(markdown.match(/const MessageImage\b/g)).toHaveLength(1)
    expect(markdown.match(/<img\b/g)).toHaveLength(1)
    expect(markdown.match(/<MessageImage\b/g)).toHaveLength(2)
    for (const policy of [
      "maxInlineSize: '70cqi'",
      "maxBlockSize: '70cqi'",
      "inlineSize: 'auto'",
      "blockSize: 'auto'",
      "objectFit: 'contain'"
    ]) {
      expect(markdown.split(policy)).toHaveLength(2)
    }
    expect(markdown).not.toMatch(
      /ResizeObserver|getBoundingClientRect|natural(?:Width|Height)|\buseState\b|aspect-square/
    )
    expect(preview).not.toMatch(
      /createPortal|createRoot|ReactDOM|document\.body|ResizeObserver|localStorage|sessionStorage|indexedDB|\bRemesh\b|\bDomain\b|\bExtern\b/
    )
    expect(preview).not.toMatch(/matchMedia\?\.|(?:set|has|release)PointerCapture\?\./)
    expect(preview).toContain("startViewTransition?: Document['startViewTransition']")
    expect(preview).not.toMatch(/(?:ready|updateCallbackDone)\?\./)
  })

  it('uses the committed shell prop without a copied lifecycle truth', () => {
    const preview = source('./media-preview.tsx')

    expect.soft(preview).not.toMatch(/\bshellOpenRef\b/)
    expect.soft(preview).toContain('if (!request.src || !shellOpen) return')
    expect.soft(preview).not.toContain('operationRef.current !== requestId || !shellOpenRef.current')
  })

  it('delegates transition identity ownership exactly once', () => {
    const preview = source('./media-preview.tsx')
    const transfer = preview.match(/const transferTransitionIdentity[\s\S]*?\n\n  const open/)?.[0]

    expect(transfer).toBeDefined()
    expect.soft(transfer?.match(/\bclaimTransitionIdentity\(/g)).toHaveLength(1)
    expect.soft(transfer).not.toMatch(/\breleaseTransitionIdentity\b/)
    expect
      .soft(transfer)
      .not.toMatch(
        /previousValue|previousPriority|\.style\b|getPropertyValue|getPropertyPriority|setProperty|removeProperty/
      )
  })
})
