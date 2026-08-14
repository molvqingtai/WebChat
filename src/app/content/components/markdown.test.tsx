import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_PREVIEW_TRANSITION_PART, MediaPreviewContext } from './media-preview'
import { Markdown } from './markdown'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const catSource = 'data:image/png;base64,iVBORw0KGgo='
const diagramSource =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2260%22%3E%3C%2Fsvg%3E'

interface PreviewActivationCase {
  name: string
  markdown: string
  alt: string
  activate: (trigger: HTMLElement) => void | Promise<void>
}

const previewActivationCases: PreviewActivationCase[] = [
  {
    name: 'pointer',
    markdown: `![Cat](${catSource})`,
    alt: 'Cat',
    activate: (trigger) => fireEvent.click(trigger)
  },
  {
    name: 'touch',
    markdown: `[Diagram](${diagramSource})`,
    alt: 'Diagram',
    activate: (trigger) => {
      fireEvent.pointerDown(trigger, { pointerId: 1, pointerType: 'touch' })
      fireEvent.pointerUp(trigger, { pointerId: 1, pointerType: 'touch' })
      fireEvent.click(trigger)
    }
  },
  {
    name: 'Enter',
    markdown: `![Cat](${catSource})`,
    alt: 'Cat',
    activate: async (trigger) => {
      const user = userEvent.setup()
      trigger.focus()
      await user.keyboard('{Enter}')
    }
  },
  {
    name: 'Space',
    markdown: `![Cat](${catSource})`,
    alt: 'Cat',
    activate: async (trigger) => {
      const user = userEvent.setup()
      trigger.focus()
      await user.keyboard(' ')
    }
  }
]

describe('message image rendering', () => {
  it('uses one query-container and Blob URL policy for Markdown images and image-valued links', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:webchat-cat')
      .mockReturnValueOnce('blob:webchat-diagram')
    const view = render(<Markdown>{`![Cat](${catSource})\n\n[Diagram](${diagramSource})`}</Markdown>)

    const container = view.container.firstElementChild as HTMLElement
    const triggers = screen.getAllByRole('button')
    const images = screen.getAllByRole('img')

    expect(container.style.containerType).toBe('inline-size')
    expect(triggers).toHaveLength(2)
    expect(images).toHaveLength(2)
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['Cat', 'Diagram'])
    expect(images.map((image) => image.getAttribute('src'))).toEqual(['blob:webchat-cat', 'blob:webchat-diagram'])
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    images.forEach((image) => {
      expect(image.style.maxInlineSize).toBe('70cqi')
      expect(image.style.maxBlockSize).toBe('70cqi')
      expect(image.style.inlineSize).toBe('auto')
      expect(image.style.blockSize).toBe('auto')
      expect(image.style.objectFit).toBe('contain')
      expect(image.getAttribute('part')).toBe(MEDIA_PREVIEW_TRANSITION_PART)
      expect(image.closest('button')).not.toBeNull()
    })
  })

  it('reuses one message-image Blob URL across StrictMode, rerender, and preview, then revokes it exactly once', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:webchat-stable')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const openPreview = vi.fn()
    const view = render(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![Cat](${catSource})`}</Markdown>
      </MediaPreviewContext.Provider>,
      { wrapper: StrictMode }
    )

    const trigger = screen.getByRole('button', { name: 'Preview Cat' })
    const inlineImage = screen.getByRole('img', { name: 'Cat' })
    expect(inlineImage.getAttribute('src')).toBe('blob:webchat-stable')

    view.rerender(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![Cat](${catSource})`}</Markdown>
      </MediaPreviewContext.Provider>
    )
    fireEvent.click(trigger)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'blob:webchat-stable',
        activator: trigger,
        transitionElement: inlineImage
      })
    )
    expect(revokeObjectURL).not.toHaveBeenCalled()

    view.unmount()
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1))
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:webchat-stable')
  })

  it('replaces a keyed image source once across StrictMode, rerender, preview, and unmount', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:webchat-old')
      .mockReturnValueOnce('blob:webchat-new')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const openPreview = vi.fn()
    const view = render(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![Cat](${catSource})`}</Markdown>
      </MediaPreviewContext.Provider>,
      { wrapper: StrictMode }
    )

    view.rerender(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![Diagram](${diagramSource})`}</Markdown>
      </MediaPreviewContext.Provider>
    )
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:webchat-old'))

    const trigger = screen.getByRole('button', { name: 'Preview Diagram' })
    const image = screen.getByRole('img', { name: 'Diagram' })
    fireEvent.click(trigger)
    view.rerender(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![Diagram](${diagramSource})`}</Markdown>
      </MediaPreviewContext.Provider>
    )

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(image.getAttribute('src')).toBe('blob:webchat-new')
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'blob:webchat-new', activator: trigger, transitionElement: image })
    )
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === 'blob:webchat-old')).toHaveLength(1)
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:webchat-new')

    view.unmount()
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:webchat-new'))
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === 'blob:webchat-old')).toHaveLength(1)
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === 'blob:webchat-new')).toHaveLength(1)
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
        <Markdown>{`[**Diagram**](${diagramSource})`}</Markdown>
      </MediaPreviewContext.Provider>
    )

    const trigger = screen.getByRole('button', { name: 'Preview Diagram' })
    expect(screen.getByRole('img', { name: 'Diagram' })).not.toBeNull()

    fireEvent.click(trigger)
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        src: expect.stringMatching(/^blob:/),
        alt: 'Diagram',
        activator: trigger,
        transitionElement: trigger.querySelector('img')
      })
    )
  })

  it.each(previewActivationCases)('activates the same sanitized preview request by $name', async (activation) => {
    const openPreview = vi.fn()
    render(
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{activation.markdown}</Markdown>
      </MediaPreviewContext.Provider>
    )
    const trigger = screen.getByRole('button')

    await activation.activate(trigger)

    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(openPreview.mock.calls[0]![0]).toMatchObject({
      src: expect.stringMatching(/^blob:/),
      alt: activation.alt,
      activator: trigger,
      transitionElement: trigger.querySelector('img')
    })
  })
})
