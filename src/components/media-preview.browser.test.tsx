import { useCallback, useRef } from 'react'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { Markdown } from './markdown'
import MediaPreview, { MediaPreviewContext, type MediaPreviewHandle, type MediaPreviewRequest } from './media-preview'
import '@/assets/styles/tailwind.css'

const wide =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2260%22%3E%3Crect%20width%3D%22120%22%20height%3D%2260%22%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E'
const tall = '/src/assets/images/example.jpg'

const Harness = () => {
  const previewRef = useRef<MediaPreviewHandle>(null)
  const openPreview = useCallback((request: MediaPreviewRequest) => previewRef.current?.open(request), [])
  return (
    <MediaPreviewContext.Provider value={openPreview}>
      <div data-testid="shell" style={{ position: 'fixed', top: 0, left: 0, inlineSize: '400px', zIndex: 2147483647 }}>
        <Markdown>{`![Wide](${wide})\n\n[Tall](${tall})`}</Markdown>
      </div>
      <MediaPreview ref={previewRef} shellOpen />
      <div data-testid="danmaku" style={{ position: 'fixed', zIndex: 2147483647 }} />
    </MediaPreviewContext.Provider>
  )
}

describe('message image browser geometry', () => {
  it('keeps both inline image forms within the same 70cqi axes and opens a natural-size centered preview', async () => {
    await render(<Harness />)
    const content = document.querySelector<HTMLElement>('[style*="container-type"]')!
    content.style.inlineSize = '400px'
    const [wideImage, tallImage] = [...content.querySelectorAll<HTMLImageElement>('img')]

    await vi.waitFor(() => expect(wideImage.complete && tallImage.complete).toBe(true))
    const wideInlineRect = wideImage.getBoundingClientRect()
    const tallInlineRect = tallImage.getBoundingClientRect()
    expect(wideInlineRect.width).toBeLessThanOrEqual(280)
    expect(wideInlineRect.height).toBeLessThanOrEqual(280)
    expect(tallInlineRect.width).toBeLessThanOrEqual(280)
    expect(tallInlineRect.height).toBeLessThanOrEqual(280)

    await page.getByRole('button', { name: 'Preview Wide' }).click()
    await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="Image preview"]')).not.toBeNull())
    const preview = document.querySelector<HTMLImageElement>('dialog[aria-label="Image preview"] img')!
    await vi.waitFor(() => expect(preview.complete && preview.naturalWidth > 0).toBe(true))
    await vi.waitFor(() => expect(Math.round(preview.getBoundingClientRect().width)).toBe(120))

    await vi.waitFor(() => {
      const settled = preview.getBoundingClientRect()
      expect(Math.abs(settled.left + settled.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1)
      expect(Math.abs(settled.top + settled.height / 2 - window.innerHeight / 2)).toBeLessThanOrEqual(1)
    })
    const rect = preview.getBoundingClientRect()
    expect(Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2)).toBeLessThanOrEqual(1)
    expect(rect.left).toBeGreaterThanOrEqual(24)
    expect(rect.top).toBeGreaterThanOrEqual(24)

    await page.getByRole('button', { name: 'Preview Tall' }).click()
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLImageElement>('dialog[aria-label="Image preview"] img')?.alt).toBe('Tall')
    )
    const replacement = document.querySelector<HTMLImageElement>('dialog[aria-label="Image preview"] img')!
    expect(document.querySelectorAll('dialog[aria-label="Image preview"]')).toHaveLength(1)
    expect(replacement.dataset.zoom).toBe('1')
    expect(replacement.dataset.translateX).toBe('0')
    expect(replacement.dataset.translateY).toBe('0')
  })

  it('keeps the preview below shell and Danmaku while backdrop, zoom, Escape, and focus remain functional', async () => {
    await render(<Harness />)
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Preview Wide"]')!
    trigger.focus()
    await page.getByRole('button', { name: 'Preview Wide' }).click()

    await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="Image preview"]')).not.toBeNull())
    const dialog = document.querySelector<HTMLElement>('dialog[aria-label="Image preview"]')!
    const previewLayer = Number.parseInt(getComputedStyle(dialog).zIndex, 10)
    const shellLayer = Number.parseInt(getComputedStyle(document.querySelector('[data-testid="shell"]')!).zIndex, 10)
    const danmakuLayer = Number.parseInt(
      getComputedStyle(document.querySelector('[data-testid="danmaku"]')!).zIndex,
      10
    )
    expect(previewLayer).toBeLessThan(shellLayer)
    expect(previewLayer).toBeLessThan(danmakuLayer)
    expect(getComputedStyle(dialog).backgroundColor).toMatch(/0\.18|18%/)

    await page
      .getByTestId('media-preview-backdrop')
      .click({ position: { x: window.innerWidth - 8, y: window.innerHeight - 8 } })
    await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="Image preview"]')).toBeNull())
    expect(document.activeElement).toBe(trigger)

    await page.getByRole('button', { name: 'Preview Wide' }).click()
    await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="Image preview"]')).not.toBeNull())
    const reopenedDialog = document.querySelector<HTMLElement>('dialog[aria-label="Image preview"]')!

    reopenedDialog.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }))
    await vi.waitFor(() =>
      expect(
        Number(document.querySelector<HTMLImageElement>('dialog[aria-label="Image preview"] img')!.dataset.zoom)
      ).toBeGreaterThan(1)
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await vi.waitFor(() => expect(document.querySelector('dialog[aria-label="Image preview"]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
