import { describe, expect, it } from 'vitest'
import {
  captureAppButtonPosition,
  getAppButtonDragBounds,
  projectAppButtonPosition
} from '@/app/content/views/app-button/position'

describe('AppButton edge-relative position', () => {
  const viewport = { width: 1000, height: 800 }

  it('captures and projects the launcher center from the selected bottom edge', () => {
    expect(captureAppButtonPosition({ x: 200, y: 700 }, viewport)).toEqual({ x: -200, y: 100 })
    expect(projectAppButtonPosition({ x: -200, y: 100 }, viewport)).toEqual({ x: 200, y: 700 })

    expect(captureAppButtonPosition({ x: 800, y: 700 }, viewport)).toEqual({ x: 200, y: 100 })
    expect(projectAppButtonPosition({ x: 200, y: 100 }, viewport)).toEqual({ x: 800, y: 700 })
  })

  it('assigns the exact midpoint to the right edge without moving the rendered center', () => {
    const captured = captureAppButtonPosition({ x: 500, y: 640 }, viewport)

    expect(captured).toEqual({ x: 500, y: 160 })
    expect(projectAppButtonPosition(captured, viewport)).toEqual({ x: 500, y: 640 })
  })

  it('keeps midpoint crossing visually continuous while changing anchors', () => {
    const before = captureAppButtonPosition({ x: 499, y: 600 }, viewport)
    const after = captureAppButtonPosition({ x: 501, y: 600 }, viewport)

    expect(before).toEqual({ x: -499, y: 200 })
    expect(after).toEqual({ x: 499, y: 200 })
    expect(projectAppButtonPosition(before, viewport).x).toBe(499)
    expect(projectAppButtonPosition(after, viewport).x).toBe(501)
  })

  it('bounds only a narrow viewport projection and restores the unchanged coordinate when widened', () => {
    const shared = { x: 500, y: 500 }

    expect(projectAppButtonPosition(shared, { width: 400, height: 250 })).toEqual({ x: 22, y: 44 })
    expect(projectAppButtonPosition(shared, { width: 1200, height: 900 })).toEqual({ x: 700, y: 400 })
    expect(shared).toEqual({ x: 500, y: 500 })
  })

  it('projects one shared coordinate independently in different tab viewports', () => {
    const shared = { x: -180, y: 60 }

    expect(projectAppButtonPosition(shared, { width: 500, height: 400 })).toEqual({ x: 180, y: 340 })
    expect(projectAppButtonPosition(shared, { width: 1000, height: 800 })).toEqual({ x: 180, y: 740 })
  })

  it('derives stable bounds from the launcher geometry and current viewport', () => {
    expect(getAppButtonDragBounds(viewport)).toEqual({ minX: 22, maxX: 978, minY: 44, maxY: 800 })
    expect(getAppButtonDragBounds({ width: 30, height: 20 })).toEqual({ minX: 15, maxX: 15, minY: 20, maxY: 20 })
  })
})
