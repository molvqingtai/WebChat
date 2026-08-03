import { describe, expect, it } from 'vitest'
import {
  APP_BUTTON_SIZE,
  captureAppButtonPosition,
  getAppButtonDragBounds,
  projectAppButtonPosition
} from '@/app/content/views/app-button/position'

describe('AppButton edge-relative position', () => {
  const viewport = { width: 1000, height: 800 }
  const shellMinimumHeight = 375
  const shellTopInset = 40

  const getShellTop = (launcherBottomEdge: number) => launcherBottomEdge - APP_BUTTON_SIZE / 2 - shellMinimumHeight

  it('captures and projects the launcher center from the selected bottom edge', () => {
    expect(captureAppButtonPosition({ x: 200, y: 700 }, viewport, false)).toEqual({ x: -200, y: 100 })
    expect(projectAppButtonPosition({ x: -200, y: 100 }, viewport, false)).toEqual({ x: 200, y: 700 })

    expect(captureAppButtonPosition({ x: 800, y: 700 }, viewport, false)).toEqual({ x: 200, y: 100 })
    expect(projectAppButtonPosition({ x: 200, y: 100 }, viewport, false)).toEqual({ x: 800, y: 700 })
  })

  it('captures both bottom corners at the symmetric fixed margins', () => {
    expect(captureAppButtonPosition({ x: -100, y: 900 }, viewport, false)).toEqual({ x: -50, y: 22 })
    expect(captureAppButtonPosition({ x: 1100, y: 900 }, viewport, false)).toEqual({ x: 50, y: 22 })
  })

  it('projects a right-bottom coordinate inside the fixed margins', () => {
    expect(projectAppButtonPosition({ x: 0, y: 0 }, viewport, false)).toEqual({ x: 950, y: 778 })
  })

  it('assigns the exact midpoint to the right edge without moving the rendered center', () => {
    const captured = captureAppButtonPosition({ x: 500, y: 640 }, viewport, false)

    expect(captured).toEqual({ x: 500, y: 160 })
    expect(projectAppButtonPosition(captured, viewport, false)).toEqual({ x: 500, y: 640 })
  })

  it('keeps midpoint crossing visually continuous while changing anchors', () => {
    const before = captureAppButtonPosition({ x: 499, y: 600 }, viewport, false)
    const after = captureAppButtonPosition({ x: 501, y: 600 }, viewport, false)

    expect(before).toEqual({ x: -499, y: 200 })
    expect(after).toEqual({ x: 499, y: 200 })
    expect(projectAppButtonPosition(before, viewport, false).x).toBe(499)
    expect(projectAppButtonPosition(after, viewport, false).x).toBe(501)
  })

  it('bounds only a narrow viewport projection and restores the unchanged coordinate when widened', () => {
    const shared = { x: 500, y: 500 }

    expect(projectAppButtonPosition(shared, { width: 400, height: 250 }, false)).toEqual({ x: 50, y: 44 })
    expect(projectAppButtonPosition(shared, { width: 1200, height: 900 }, false)).toEqual({ x: 700, y: 400 })
    expect(shared).toEqual({ x: 500, y: 500 })
  })

  it('projects one shared coordinate independently in different tab viewports', () => {
    const shared = { x: -180, y: 60 }

    expect(projectAppButtonPosition(shared, { width: 500, height: 400 }, false)).toEqual({ x: 180, y: 340 })
    expect(projectAppButtonPosition(shared, { width: 1000, height: 800 }, false)).toEqual({ x: 180, y: 740 })
  })

  it.each([
    { side: 'left', position: { x: -200, y: 756 }, expectedX: 200 },
    { side: 'right', position: { x: 200, y: 756 }, expectedX: 800 }
  ])('keeps the expanded shell top inset at the $side anchor', (expected) => {
    const projected = projectAppButtonPosition(expected.position, viewport, true)

    expect(projected).toEqual({ x: expected.expectedX, y: 437 })
    expect(getShellTop(projected.y)).toBe(shellTopInset)
    expect(expected.position).toEqual({ x: expected.side === 'left' ? -200 : 200, y: 756 })
  })

  it('reprojects opening and reopening locally while only a user drag captures the expanded bound', () => {
    const shared = { x: -200, y: 756 }

    expect(projectAppButtonPosition(shared, viewport, false)).toEqual({ x: 200, y: 44 })
    expect(projectAppButtonPosition(shared, viewport, true)).toEqual({ x: 200, y: 437 })
    expect(projectAppButtonPosition(shared, viewport, false)).toEqual({ x: 200, y: 44 })
    expect(projectAppButtonPosition(shared, viewport, true)).toEqual({ x: 200, y: 437 })
    expect(shared).toEqual({ x: -200, y: 756 })

    const dragged = captureAppButtonPosition({ x: 200, y: 100 }, viewport, true)
    expect(dragged).toEqual({ x: -200, y: 363 })
    expect(projectAppButtonPosition(dragged, viewport, true)).toEqual({ x: 200, y: 437 })
  })

  it('keeps launcher bounds and fixed shell geometry below the expanded-inset threshold', () => {
    const shortViewport = { width: 500, height: 458 }
    const shared = { x: -180, y: 400 }
    const launcherBounds = { minX: 50, maxX: 450, minY: 44, maxY: 436 }

    expect(getAppButtonDragBounds(shortViewport, false)).toEqual(launcherBounds)
    expect(getAppButtonDragBounds(shortViewport, true)).toEqual(launcherBounds)
    expect(projectAppButtonPosition(shared, shortViewport, false)).toEqual({ x: 180, y: 58 })
    expect(projectAppButtonPosition(shared, shortViewport, true)).toEqual({ x: 180, y: 58 })
    expect(shared).toEqual({ x: -180, y: 400 })
  })

  it('derives stable bounds from the launcher geometry and current viewport', () => {
    const bounds = getAppButtonDragBounds(viewport, false)
    expect(bounds).toEqual({ minX: 50, maxX: 950, minY: 44, maxY: 778 })
    expect(bounds.minX - APP_BUTTON_SIZE / 2).toBe(28)
    expect(viewport.width - bounds.maxX - APP_BUTTON_SIZE / 2).toBe(28)
    expect(viewport.height - bounds.maxY).toBe(22)

    const constrained = getAppButtonDragBounds({ width: 80, height: 50 }, false)
    expect(constrained).toEqual({ minX: 40, maxX: 40, minY: 44, maxY: 44 })
    expect(constrained.minX - APP_BUTTON_SIZE / 2).toBe(18)
    expect(80 - constrained.maxX - APP_BUTTON_SIZE / 2).toBe(18)
    expect(50 - constrained.maxY).toBe(6)
    expect(projectAppButtonPosition({ x: 0, y: 0 }, { width: 80, height: 50 }, false)).toEqual({ x: 40, y: 44 })
    expect(getAppButtonDragBounds({ width: 30, height: 20 }, false)).toEqual({
      minX: 15,
      maxX: 15,
      minY: 20,
      maxY: 20
    })
  })
})
