import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useDraggable, { type DragOptions } from '@/hooks/useDraggable'

const Harness = (options: DragOptions) => {
  const { setRef, x, y } = useDraggable(options)
  return <button ref={setRef} aria-label="Move WebChat" data-testid="drag-handle" data-x={x} data-y={y} />
}

let frameId = 0
let frames: Map<number, FrameRequestCallback>

const flushAnimationFrame = () => {
  const pending = [...frames.values()]
  frames.clear()
  act(() => pending.forEach((callback) => callback(performance.now())))
}

beforeEach(() => {
  frameId = 0
  frames = new Map()
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++frameId
      frames.set(id, callback)
      return id
    })
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames.delete(id)
    })
  )
})

afterEach(() => {
  cleanup()
  document.documentElement.style.cursor = ''
  document.documentElement.style.userSelect = ''
  vi.unstubAllGlobals()
})

describe('useDraggable', () => {
  it('follows the latest pointer once per frame and preserves bounds, cursor, selection, and release', () => {
    const onChange = vi.fn()
    render(<Harness initX={100} initY={100} minX={20} maxX={200} minY={44} maxY={180} onChange={onChange} />)
    const handle = screen.getByTestId('drag-handle')

    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 })
    expect(document.documentElement.style.cursor).toBe('grab')
    expect(document.documentElement.style.userSelect).toBe('none')

    fireEvent.mouseMove(document, { clientX: 130, clientY: 120 })
    fireEvent.mouseMove(document, { clientX: 160, clientY: 140 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)

    flushAnimationFrame()
    expect(handle.dataset.x).toBe('160')
    expect(handle.dataset.y).toBe('140')
    expect(onChange).toHaveBeenLastCalledWith({ x: 160, y: 140 })

    fireEvent.mouseMove(document, { clientX: 600, clientY: 500 })
    flushAnimationFrame()
    expect(handle.dataset.x).toBe('200')
    expect(handle.dataset.y).toBe('180')
    expect(onChange).toHaveBeenLastCalledWith({ x: 200, y: 180 })

    fireEvent.mouseUp(document)
    expect(document.documentElement.style.cursor).toBe('')
    expect(document.documentElement.style.userSelect).toBe('')
    fireEvent.mouseMove(document, { clientX: 150, clientY: 150 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3)
  })

  it('cancels a pending frame on mouse release', () => {
    const onChange = vi.fn()
    render(<Harness initX={100} initY={100} minX={20} maxX={200} minY={44} maxY={180} onChange={onChange} />)
    const handle = screen.getByTestId('drag-handle')

    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 140, clientY: 130 })
    fireEvent.mouseUp(document)
    flushAnimationFrame()

    expect(handle.dataset.x).toBe('100')
    expect(handle.dataset.y).toBe('100')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops an upward drag at the expanded shell bound and reports that bounded point', () => {
    const onChange = vi.fn()
    render(<Harness initX={200} initY={700} minX={50} maxX={950} minY={437} maxY={778} onChange={onChange} />)
    const handle = screen.getByTestId('drag-handle')

    fireEvent.mouseDown(handle, { clientX: 200, clientY: 700 })
    fireEvent.mouseMove(document, { clientX: 200, clientY: 100 })
    flushAnimationFrame()

    expect(handle.dataset.x).toBe('200')
    expect(handle.dataset.y).toBe('437')
    expect(onChange).toHaveBeenLastCalledWith({ x: 200, y: 437 })
  })

  it('reprojects changed inputs and bounds locally without reporting a user drag', async () => {
    const onChange = vi.fn()
    const view = render(
      <Harness initX={180} initY={170} minX={20} maxX={200} minY={44} maxY={180} onChange={onChange} />
    )

    view.rerender(<Harness initX={180} initY={170} minX={22} maxX={150} minY={44} maxY={140} onChange={onChange} />)

    await vi.waitFor(() => {
      expect(screen.getByTestId('drag-handle').dataset.x).toBe('150')
      expect(screen.getByTestId('drag-handle').dataset.y).toBe('140')
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
