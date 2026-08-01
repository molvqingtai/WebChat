import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, useCallback, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './markdown'
import {
  clampMediaPreviewTransform,
  getMediaPreviewFit,
  getMediaPreviewPanBounds,
  zoomMediaPreviewAtPoint
} from './media-preview-geometry'
import MediaPreview, { MediaPreviewContext, type MediaPreviewHandle, type MediaPreviewRequest } from './media-preview'

const firstSource = 'https://example.com/first.png'
const secondSource = 'https://example.com/second.webp'

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
    <MediaPreviewContext.Provider value={openPreview}>
      <Markdown>{`![First](${firstSource})\n\n[Second](${secondSource})`}</Markdown>
      <MediaPreview ref={previewRef} shellOpen={shellOpen} />
    </MediaPreviewContext.Provider>
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

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

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
    expect(getMediaPreviewFit({ width: 120, height: 60 }, { width: 1000, height: 800 })).toEqual({
      availableWidth: 952,
      availableHeight: 752,
      width: 120,
      height: 60
    })
    expect(getMediaPreviewFit({ width: 2000, height: 1000 }, { width: 1000, height: 800 })).toEqual({
      availableWidth: 952,
      availableHeight: 752,
      width: 952,
      height: 476
    })
  })

  it('clamps pan only on overflowing axes and preserves a focal point through zoom', () => {
    const fit = getMediaPreviewFit({ width: 1000, height: 500 }, { width: 500, height: 500 })
    expect(clampMediaPreviewTransform({ zoom: 2, x: 999, y: 999 }, fit)).toEqual({ zoom: 2, x: 226, y: 0 })
    expect(zoomMediaPreviewAtPoint({ zoom: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, fit)).toEqual({
      zoom: 2,
      x: -100,
      y: 0
    })
  })
})

describe('MediaPreview ownership and settlement', () => {
  it('replaces rather than stacks, resets transform, and exposes named icon controls', () => {
    render(<Harness />)
    openFirst()

    expect(screen.getAllByRole('dialog', { name: 'Image preview' })).toHaveLength(1)
    expect(previewImage('First')).not.toBeNull()
    for (const name of ['Zoom out', 'Zoom in', 'Reset zoom', 'Close preview']) {
      const control = screen.getByRole('button', { name })
      expect(control.getAttribute('title')).toBe(name)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(previewTransform('First')).toBe('translate3d(0px, 0px, 0) scale(1.5)')

    fireEvent.click(screen.getByRole('button', { name: 'Preview Second' }))
    expect(screen.getAllByRole('dialog', { name: 'Image preview' })).toHaveLength(1)
    expect(
      within(screen.getByRole('dialog', { name: 'Image preview' })).queryByRole('img', { name: 'First' })
    ).toBeNull()
    expect(previewTransform('Second')).toBe('translate3d(0px, 0px, 0) scale(1)')
  })

  it('uses fixed button and keyboard steps with exact limits and reset', () => {
    render(<Harness />)
    openFirst()
    const image = () => previewImage('First')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1.25)')

    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    fireEvent.keyDown(dialog, { key: '+' })
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1.5)')
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(dialog, { key: '+' })
    expect(image().style.transform).toContain('scale(4)')
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(dialog, { key: '-' })
    expect(image().style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')

    fireEvent.keyDown(dialog, { key: '+' })
    fireEvent.keyDown(dialog, { key: '0' })
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

    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const fit = getMediaPreviewFit(naturalSize, { width: window.innerWidth, height: window.innerHeight })
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
  it('cleans a superseded activator identity before a different image transition starts', async () => {
    const transitions: Array<{ operation: () => void; finished: ReturnType<typeof deferred> }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const finished = deferred()
        transitions.push({ operation, finished })
        return { finished: finished.promise }
      }
    })
    render(<Harness />)

    const first = screen.getByRole('button', { name: 'Preview First' }).querySelector('img')!
    const secondButton = screen.getByRole('button', { name: 'Preview Second' })
    const second = secondButton.querySelector('img')!
    openFirst()
    fireEvent.click(secondButton)

    expect(first.style.viewTransitionName).toBe('')
    expect(second.style.viewTransitionName).toMatch(/^webchat-media-preview-/)

    transitions[1].operation()
    transitions[1].finished.resolve()
    await act(async () => Promise.resolve())
    transitions[0].finished.resolve()
    await act(async () => Promise.resolve())

    expect(previewImage('Second')).not.toBeNull()
    expect(first.style.viewTransitionName).toBe('')
    expect(second.style.viewTransitionName).toBe('')
  })

  it('does not restore a stale identity when the same activator reopens before settlement', async () => {
    const transitions: Array<{ operation: () => void; finished: ReturnType<typeof deferred> }> = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (operation: () => void) => {
        const finished = deferred()
        transitions.push({ operation, finished })
        return { finished: finished.promise }
      }
    })
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Preview First' })
    const image = trigger.querySelector('img')!
    openFirst()
    fireEvent.click(trigger)

    transitions[0].finished.resolve()
    await act(async () => Promise.resolve())
    transitions[1].operation()
    transitions[1].finished.resolve()
    await act(async () => Promise.resolve())

    expect(previewImage('First')).not.toBeNull()
    expect(image.style.viewTransitionName).toBe('')
  })

  it('uses supported transitions for open and close and removes each request-local identity', async () => {
    const hostParticipant = document.createElement('div')
    hostParticipant.style.viewTransitionName = 'host-owned'
    document.body.append(hostParticipant)
    let snapshotChecks = 0
    const namedElements = () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter((element) =>
        (element.style.viewTransitionName ?? '').includes('webchat-media-preview')
      )
    let transitionCalls = 0
    const startViewTransition = (operation: () => void) => {
      transitionCalls += 1
      expect(namedElements()).toHaveLength(1)
      snapshotChecks += 1
      operation()
      expect(namedElements()).toHaveLength(1)
      snapshotChecks += 1
      return { finished: Promise.resolve() }
    }
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Preview First' })
    trigger.focus()
    openFirst()
    expect(transitionCalls).toBe(1)
    await act(async () => Promise.resolve())

    const triggerImage = trigger.querySelector('img')!
    expect(triggerImage.style.viewTransitionName ?? '').not.toContain('webchat-media-preview')
    expect(previewImage('First').style.viewTransitionName).not.toContain('webchat-media-preview')

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(transitionCalls).toBe(2)
    await act(async () => Promise.resolve())

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).toBeNull()
    expect(triggerImage.style.viewTransitionName ?? '').not.toContain('webchat-media-preview')
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
      value: vi.fn(() => ({ updateCallbackDone: rejected, finished: rejected }))
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
        if (mode === 'rejected transition') return { finished: Promise.reject(new Error('rejected')) }
        if (mode === 'skipped transition') return { finished: Promise.resolve() }
        operation()
        return { finished: Promise.resolve() }
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
