import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, useCallback, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './markdown'
import {
  clampMediaPreviewTransform,
  getMediaPreviewLayout,
  getMediaPreviewPanBounds,
  zoomMediaPreviewAtPoint
} from './media-preview-geometry'
import MediaPreview, {
  MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY,
  MEDIA_PREVIEW_TRANSITION_PART,
  MediaPreviewContext,
  type MediaPreviewHandle,
  type MediaPreviewRequest
} from './media-preview'

const firstSource = 'data:image/png;base64,iVBORw0KGgo='
const secondSource =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2260%22%3E%3C%2Fsvg%3E'

const matchMedia = (matches: boolean) =>
  vi.fn(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))

const Harness = ({ shellOpen = true }: { shellOpen?: boolean }) => {
  const previewRef = useRef<MediaPreviewHandle>(null)
  const openPreview = useCallback((request: MediaPreviewRequest) => previewRef.current?.open(request), [])

  return (
    <div id="app">
      <MediaPreviewContext.Provider value={openPreview}>
        <Markdown>{`![First](${firstSource})\n\n![Second](${secondSource})`}</Markdown>
        <input aria-label="Message draft" />
        <MediaPreview ref={previewRef} shellOpen={shellOpen} />
      </MediaPreviewContext.Provider>
    </div>
  )
}

const DirectHarness = ({ shellOpen = true }: { shellOpen?: boolean }) => {
  const previewRef = useRef<MediaPreviewHandle>(null)
  const activatorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={activatorRef}
        type="button"
        onClick={() => {
          const activator = activatorRef.current
          if (activator) {
            previewRef.current?.open({
              src: firstSource,
              alt: 'External',
              activator,
              transitionElement: activator
            })
          }
        }}
      >
        Open external preview
      </button>
      <MediaPreview ref={previewRef} shellOpen={shellOpen} />
    </>
  )
}

const openFirst = () => fireEvent.click(screen.getByRole('button', { name: 'Preview First' }))
const previewImage = (name: string) =>
  within(screen.getByRole('dialog', { name: 'Image preview' })).getByRole('img', { name })
const previewBackdrop = () => document.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!
const previewTransform = (name: string) => previewImage(name).style.transform
const transitionName = (element: HTMLElement) => element.style.getPropertyValue(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const viewTransition = (
  finished: Promise<void> = Promise.resolve(),
  updateCallbackDone: Promise<void> = Promise.resolve(),
  ready: Promise<void> = Promise.resolve()
): ViewTransition => ({
  finished,
  ready,
  types: new Set<string>() as ViewTransitionTypeSet,
  updateCallbackDone,
  skipTransition: vi.fn()
})

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia(false) })
  Reflect.deleteProperty(document, 'startViewTransition')
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('MediaPreview geometry', () => {
  it('fits inside the 24px viewport margin without upscaling natural dimensions', () => {
    expect(getMediaPreviewLayout({ width: 120, height: 60 }, { width: 1000, height: 800 }).fit).toEqual({
      availableWidth: 952,
      availableHeight: 704,
      width: 120,
      height: 60
    })
    expect(getMediaPreviewLayout({ width: 2000, height: 1000 }, { width: 1000, height: 800 }).fit).toEqual({
      availableWidth: 952,
      availableHeight: 704,
      width: 952,
      height: 476
    })
  })

  it('clamps pan only on overflowing axes and preserves a focal point through zoom', () => {
    const fit = getMediaPreviewLayout({ width: 1000, height: 500 }, { width: 500, height: 500 }).fit!
    expect(clampMediaPreviewTransform({ zoom: 2, x: 999, y: 999 }, fit)).toEqual({ zoom: 2, x: 226, y: 24 })
    expect(clampMediaPreviewTransform({ zoom: 1.5, x: 999, y: 999 }, fit)).toEqual({ zoom: 1.5, x: 113, y: 0 })
    expect(clampMediaPreviewTransform({ zoom: 0.5, x: 999, y: -999 }, fit)).toEqual({ zoom: 0.5, x: 0, y: 0 })
    expect(zoomMediaPreviewAtPoint({ zoom: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, fit)).toEqual({
      zoom: 2,
      x: -100,
      y: -24
    })
  })

  it('derives fit, interaction clipping, focal center, and toolbar band from one layout', () => {
    expect(getMediaPreviewLayout({ width: 1200, height: 1200 }, { width: 900, height: 700 })).toEqual({
      interaction: { x: 24, y: 24, width: 852, height: 604 },
      toolbar: { x: 24, y: 640, width: 852, height: 36 },
      center: { x: 450, y: 326 },
      fit: {
        availableWidth: 852,
        availableHeight: 604,
        width: 604,
        height: 604
      }
    })
  })
})

describe('MediaPreview ownership and settlement', () => {
  it('switches only the image while preserving the preview surface, reset state, and activator focus', () => {
    render(<Harness />)
    const firstTrigger = screen.getByRole('button', { name: 'Preview First' })
    const secondTrigger = screen.getByRole('button', { name: 'Preview Second' })
    firstTrigger.focus()
    openFirst()

    expect(screen.getAllByRole('dialog', { name: 'Image preview' })).toHaveLength(1)
    const firstImage = previewImage('First')
    const previewBody = firstImage.parentElement
    Object.defineProperties(firstImage, {
      naturalWidth: { configurable: true, value: 2000 },
      naturalHeight: { configurable: true, value: 1000 }
    })
    fireEvent.load(firstImage)
    for (const name of ['Zoom out', 'Zoom in', 'Reset zoom', 'Close preview']) {
      const control = screen.getByRole('button', { name })
      expect(control.getAttribute('title')).toBe(name)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const backdrop = previewBackdrop()
    const toolbar = within(dialog).getByRole('toolbar', { name: 'Image preview controls' })
    fireEvent.pointerDown(dialog, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(dialog, { pointerId: 1, pointerType: 'mouse', clientX: 450, clientY: 300 })
    expect(previewTransform('First')).not.toBe('translate3d(0px, 0px, 0) scale(1)')

    fireEvent.click(secondTrigger)
    expect(screen.getAllByRole('dialog', { name: 'Image preview' })).toHaveLength(1)
    const replacementDialog = screen.getByRole('dialog', { name: 'Image preview' })
    expect(replacementDialog).toBe(dialog)
    expect(previewBackdrop()).toBe(backdrop)
    expect(within(replacementDialog).getByRole('toolbar', { name: 'Image preview controls' })).toBe(toolbar)
    expect(within(replacementDialog).queryByRole('img', { name: 'First' })).toBeNull()
    expect(previewImage('Second')).not.toBe(firstImage)
    expect(previewImage('Second').parentElement).toBe(previewBody)
    expect(previewTransform('Second')).toBe('translate3d(0px, 0px, 0) scale(1)')

    fireEvent.pointerMove(dialog, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 300 })
    expect(previewTransform('Second')).toBe('translate3d(0px, 0px, 0) scale(1)')
    fireEvent.pointerUp(dialog, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 300 })

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(document.activeElement).toBe(secondTrigger)
  })

  it('renders the named icon toolbar after the preview image', () => {
    render(<Harness />)
    openFirst()

    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const image = previewImage('First')
    const toolbar = within(dialog).getByRole('toolbar', { name: 'Image preview controls' })

    expect(image.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(toolbar.className).not.toContain('top-6')
  })

  it('uses fixed button and keyboard steps with exact limits and reset', () => {
    render(<Harness />)
    openFirst()
    const image = () => previewImage('First')
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement

    expect(zoomOut.disabled).toBe(false)
    for (let index = 0; index < 3; index += 1) fireEvent.click(zoomOut)
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(0.25)')
    expect(zoomOut.disabled).toBe(true)

    const lowerBoundary = image().style.transform
    fireEvent.click(zoomOut)
    fireEvent.keyDown(dialog, { key: '-' })
    expect(image().style.transform).toBe(lowerBoundary)

    fireEvent.keyDown(dialog, { key: '+' })
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(0.5)')
    fireEvent.click(zoomOut)
    expect(image().style.transform).toBe(lowerBoundary)

    fireEvent.keyDown(dialog, { key: '0' })
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(dialog, { key: '+' })
    expect(image().style.transform).toContain('scale(4)')
    expect(zoomIn.disabled).toBe(true)

    const upperBoundary = image().style.transform
    fireEvent.keyDown(dialog, { key: '+' })
    fireEvent.click(zoomIn)
    expect(image().style.transform).toBe(upperBoundary)
  })

  it('resets and reopens at the fitted 1x transform after zooming below it', () => {
    render(<Harness />)
    openFirst()
    const image = () => previewImage('First')
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' })

    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(0.5)')
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')

    fireEvent.click(zoomOut)
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(0.75)')
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    openFirst()
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
  })

  it('uses pinch focal zoom and clamps a continued single-pointer pan to explicit axis bounds', () => {
    render(<Harness />)
    openFirst()
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const image = previewImage('First')
    const naturalSize = { width: 1000, height: 500 }
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: naturalSize.width },
      naturalHeight: { configurable: true, value: naturalSize.height }
    })
    fireEvent.load(image)

    const layout = getMediaPreviewLayout(naturalSize, { width: window.innerWidth, height: window.innerHeight })
    const center = layout.center
    const fit = layout.fit!
    fireEvent.pointerDown(dialog, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: center.x - 50,
      clientY: center.y
    })
    fireEvent.pointerDown(dialog, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: center.x + 50,
      clientY: center.y
    })
    fireEvent.pointerMove(dialog, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: center.x + 150,
      clientY: center.y
    })

    const pinchExpected = clampMediaPreviewTransform({ zoom: 2, x: 50, y: 0 }, fit)
    expect(image.style.transform).toBe(
      `translate3d(${pinchExpected.x}px, ${pinchExpected.y}px, 0) scale(${pinchExpected.zoom})`
    )

    fireEvent.pointerUp(dialog, { pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(dialog, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: center.x + fit.availableWidth * 4,
      clientY: center.y + fit.availableHeight * 4
    })

    const bounds = getMediaPreviewPanBounds(fit, 2)
    expect(image.style.transform).toBe(`translate3d(${bounds.x}px, ${bounds.y}px, 0) scale(2)`)
  })

  it('closes through backdrop, control, Escape, and shell collapse while restoring focus', async () => {
    const view = render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Preview First' })

    trigger.focus()
    openFirst()
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Image preview' })))
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    if (trigger.isConnected) expect(document.activeElement).toBe(trigger)

    openFirst()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Image preview' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(document.activeElement).toBe(trigger)

    openFirst()
    fireEvent.click(previewBackdrop())
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()

    openFirst()
    view.rerender(<Harness shellOpen={false} />)
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull())
    if (trigger.isConnected) expect(document.activeElement).toBe(trigger)
  })

  it('keeps editable zoom keys local but closes from an editable sibling on Escape', () => {
    render(<Harness />)
    openFirst()
    const input = screen.getByRole('textbox', { name: 'Message draft' })
    const image = previewImage('First')

    input.focus()
    fireEvent.keyDown(input, { key: '+' })
    fireEvent.keyDown(input, { key: '0' })
    expect(image.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })

  it('restores focus to a surviving activator when shell collapse closes the preview', async () => {
    const view = render(<DirectHarness />)
    const trigger = screen.getByRole('button', { name: 'Open external preview' })
    trigger.focus()
    fireEvent.click(trigger)
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Image preview' })))

    view.rerender(<DirectHarness shellOpen={false} />)

    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps wheel, pointer drag, and drag-release handling local to the preview', async () => {
    const originalBodyStyle = document.body.getAttribute('style')
    render(<Harness />)
    openFirst()
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const image = previewImage('First')
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 500 }
    })
    fireEvent.load(image)

    const wheel = new Event('wheel', { bubbles: true, cancelable: true })
    Object.defineProperties(wheel, {
      deltaY: { value: -100 },
      clientX: { value: 400 },
      clientY: { value: 300 }
    })
    fireEvent(dialog, wheel)
    expect(image.style.transform).not.toContain('scale(1)')

    fireEvent.pointerDown(image, { pointerId: 1, clientX: 300, clientY: 300, pointerType: 'mouse' })
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 380, clientY: 300, pointerType: 'mouse' })
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 380, clientY: 300, pointerType: 'mouse' })
    fireEvent.click(previewBackdrop())

    expect(screen.getByRole('dialog', { name: 'Image preview' })).not.toBeNull()
    expect(document.body.getAttribute('style')).toBe(originalBodyStyle)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    fireEvent.click(previewBackdrop())
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })
})

describe('MediaPreview View Transition fallback', () => {
  it('closes a delayed opening after shell collapse commits its update', async () => {
    const transitions: Array<{
      operation: () => void
      ready: ReturnType<typeof deferred>
      updateCallbackDone: ReturnType<typeof deferred>
      finished: ReturnType<typeof deferred>
    }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const ready = deferred()
        const updateCallbackDone = deferred()
        const finished = deferred()
        transitions.push({ operation, ready, updateCallbackDone, finished })
        return viewTransition(finished.promise, updateCallbackDone.promise, ready.promise)
      }
    })
    const view = render(<Harness />)

    const triggerImage = screen.getByRole('button', { name: 'Preview First' }).querySelector('img')!
    openFirst()
    view.rerender(<Harness shellOpen={false} />)
    await act(async () => Promise.resolve())

    act(() => transitions[0]!.operation())
    transitions[0]!.updateCallbackDone.resolve()
    await act(async () => Promise.resolve())
    expect(transitions).toHaveLength(2)

    act(() => transitions[1]!.operation())
    transitions[0]!.ready.resolve()
    transitions[0]!.finished.resolve()
    transitions[1]!.ready.resolve()
    transitions[1]!.updateCallbackDone.resolve()
    transitions[1]!.finished.resolve()
    await act(async () => Promise.resolve())

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(transitionName(triggerImage)).toBe('')
    openFirst()
    expect(transitions).toHaveLength(2)
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
  })

  it('fences collapsed opening and close settlement from the next image', async () => {
    const transitions: Array<{
      operation: () => void
      updateCallbackDone: ReturnType<typeof deferred>
      finished: ReturnType<typeof deferred>
    }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const updateCallbackDone = deferred()
        const finished = deferred()
        transitions.push({ operation, updateCallbackDone, finished })
        return viewTransition(finished.promise, updateCallbackDone.promise)
      }
    })
    const view = render(<Harness />)

    const first = screen.getByRole('button', { name: 'Preview First' }).querySelector('img')!
    openFirst()
    const openingIdentity = transitionName(first)
    view.rerender(<Harness shellOpen={false} />)
    await act(async () => Promise.resolve())
    expect(transitionName(first)).toBe(openingIdentity)

    act(() => transitions[0]!.operation())
    transitions[0]!.updateCallbackDone.resolve()
    await act(async () => Promise.resolve())
    expect(transitions).toHaveLength(2)
    act(() => transitions[1]!.operation())
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()

    view.rerender(<Harness shellOpen />)
    const secondButton = screen.getByRole('button', { name: 'Preview Second' })
    const second = secondButton.querySelector('img')!
    fireEvent.click(secondButton)
    expect(transitions).toHaveLength(3)
    act(() => transitions[2]!.operation())
    expect(previewImage('Second')).not.toBeNull()

    transitions[0]!.finished.resolve()
    transitions[1]!.updateCallbackDone.resolve()
    transitions[1]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(previewImage('Second'))).toMatch(/^webchat-media-preview-/)

    transitions[2]!.updateCallbackDone.resolve()
    transitions[2]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(second)).toBe('')
    expect(transitionName(previewImage('Second'))).toBe('')
  })

  it('supersedes an opening image without close motion and gives the next image one complete opening', async () => {
    const transitions: Array<{
      operation: () => void
      finished: ReturnType<typeof deferred>
      transition: ViewTransition
    }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const finished = deferred()
        const transition = viewTransition(finished.promise)
        transitions.push({ operation, finished, transition })
        return transition
      }
    })
    render(<Harness />)

    const first = screen.getByRole('button', { name: 'Preview First' }).querySelector('img')!
    const secondButton = screen.getByRole('button', { name: 'Preview Second' })
    const second = secondButton.querySelector('img')!
    openFirst()
    const openingIdentity = transitionName(first)
    fireEvent.click(secondButton)

    expect(transitions).toHaveLength(2)
    expect(transitions[0]!.transition.skipTransition).toHaveBeenCalledOnce()
    expect(openingIdentity).toMatch(/^webchat-media-preview-/)
    expect(transitionName(first)).toBe('')
    expect(transitionName(second)).toMatch(/^webchat-media-preview-/)

    act(() => {
      transitions[0]!.operation()
      transitions[1]!.operation()
    })
    expect(previewImage('Second')).not.toBeNull()
    expect(previewTransform('Second')).toBe('translate3d(0px, 0px, 0) scale(1)')

    transitions[0]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(first)).toBe('')
    expect(transitionName(previewImage('Second'))).toMatch(/^webchat-media-preview-/)

    transitions[1]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(second)).toBe('')
    expect(transitionName(previewImage('Second'))).toBe('')
  })

  it('skips one opening visual and starts a complete close as soon as its update is done', async () => {
    const transitions: Array<{
      operation: () => void
      ready: ReturnType<typeof deferred>
      updateCallbackDone: ReturnType<typeof deferred>
      finished: ReturnType<typeof deferred>
      transition: ViewTransition
    }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const ready = deferred()
        const updateCallbackDone = deferred()
        const finished = deferred()
        const transition = viewTransition(finished.promise, updateCallbackDone.promise, ready.promise)
        transitions.push({ operation, ready, updateCallbackDone, finished, transition })
        return transition
      }
    })
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Preview First' })
    const image = trigger.querySelector('img')!
    image.style.setProperty(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY, 'host-owned-source', 'important')
    openFirst()
    const openingIdentity = transitionName(image)
    fireEvent.click(trigger)
    transitions[0]!.ready.reject(new Error('opening skipped'))
    await act(async () => Promise.resolve())
    fireEvent.click(trigger)

    expect(transitions).toHaveLength(1)
    expect(transitions[0]!.transition.skipTransition).toHaveBeenCalledOnce()
    expect(openingIdentity).toMatch(/^webchat-media-preview-/)
    expect(transitionName(image)).toBe('host-owned-source')
    act(() => transitions[0]!.operation())
    expect(previewImage('First')).not.toBeNull()

    transitions[0]!.updateCallbackDone.resolve()
    await act(async () => Promise.resolve())
    expect(transitions).toHaveLength(2)

    act(() => transitions[1]!.operation())
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    const closingIdentity = transitionName(image)
    expect(closingIdentity).toMatch(/^webchat-media-preview-/)

    transitions[0]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(image)).toBe(closingIdentity)

    transitions[1]!.updateCallbackDone.resolve()
    transitions[1]!.finished.resolve()
    await act(async () => Promise.resolve())
    expect(transitionName(image)).toBe('host-owned-source')
    expect(image.style.getPropertyPriority(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)).toBe('important')
  })

  it.each(['open first', 'close first'])('fences applied-open and close settlement when %s settles', async (order) => {
    const transitions: Array<{ operation: () => void; finished: ReturnType<typeof deferred> }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const finished = deferred()
        transitions.push({ operation, finished })
        return viewTransition(finished.promise)
      }
    })
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Preview First' })
    const triggerImage = trigger.querySelector('img')!
    trigger.focus()
    openFirst()
    transitions[0]!.operation()
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await act(async () => Promise.resolve())
    transitions[1]!.operation()

    const [first, second] = order === 'open first' ? transitions : [...transitions].reverse()
    first!.finished.resolve()
    await act(async () => Promise.resolve())
    second!.finished.resolve()
    await act(async () => Promise.resolve())

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(transitionName(triggerImage)).toBe('')
    expect(document.activeElement).toBe(trigger)
  })

  it('uses supported transitions for open and close and removes each request-local identity', async () => {
    const hostParticipant = document.createElement('div')
    hostParticipant.style.viewTransitionName = 'host-owned'
    document.body.append(hostParticipant)
    let snapshotChecks = 0
    const namedElements = () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter((element) =>
        transitionName(element).includes('webchat-media-preview')
      )
    let transitionCalls = 0
    const startViewTransition = (operation: () => void) => {
      transitionCalls += 1
      expect(namedElements()).toHaveLength(1)
      snapshotChecks += 1
      operation()
      expect(namedElements()).toHaveLength(1)
      snapshotChecks += 1
      return viewTransition()
    }
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Preview First' })
    trigger.focus()
    openFirst()
    expect(transitionCalls).toBe(1)
    await act(async () => Promise.resolve())

    const triggerImage = trigger.querySelector('img')!
    expect(transitionName(triggerImage)).not.toContain('webchat-media-preview')
    expect(transitionName(previewImage('First'))).not.toContain('webchat-media-preview')
    expect(previewImage('First').getAttribute('part')).toBe(MEDIA_PREVIEW_TRANSITION_PART)
    expect(previewImage('First').style.getPropertyValue('view-transition-name')).toBe('')

    fireEvent.click(trigger)
    expect(transitionCalls).toBe(2)
    await act(async () => Promise.resolve())

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(transitionName(triggerImage)).not.toContain('webchat-media-preview')
    expect(document.activeElement).toBe(trigger)
    expect(snapshotChecks).toBe(4)
    expect(hostParticipant.style.viewTransitionName).toBe('host-owned')
  })

  it('applies a doubly rejected close fallback and focus restoration exactly once', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Preview First' })
    trigger.focus()
    openFirst()
    const focus = vi.spyOn(trigger, 'focus')
    const rejected = Promise.reject(new Error('rejected'))
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn(() => viewTransition(rejected, rejected))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await act(async () => Promise.resolve())

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it.each(['reduced motion', 'missing API', 'synchronous failure', 'rejected transition', 'skipped transition'])(
    'settles immediately for %s',
    async (mode) => {
      const startViewTransition = vi.fn((operation: () => void) => {
        if (mode === 'synchronous failure') throw new Error('unsupported')
        if (mode === 'rejected transition') return viewTransition(Promise.reject(new Error('rejected')))
        if (mode === 'skipped transition') return viewTransition()
        operation()
        return viewTransition()
      })
      if (mode === 'reduced motion') {
        Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia(true) })
        Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
      } else if (mode !== 'missing API') {
        Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
      }
      render(<Harness />)

      openFirst()
      await act(async () => Promise.resolve())

      expect(screen.getAllByRole('dialog', { name: 'Image preview' })).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
      await act(async () => Promise.resolve())

      expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
      if (mode === 'reduced motion') expect(startViewTransition).not.toHaveBeenCalled()
    }
  )
})

describe('MediaPreview imperative owner', () => {
  it('accepts one sanitized image request without another state owner', () => {
    const ref = createRef<MediaPreviewHandle>()
    const activator = document.createElement('button')
    document.body.append(activator)
    render(<MediaPreview ref={ref} shellOpen />)

    act(() => ref.current?.open({ src: firstSource, alt: 'Direct', activator, transitionElement: activator }))
    expect(screen.getByRole('img', { name: 'Direct' })).not.toBeNull()

    activator.remove()
  })
})
