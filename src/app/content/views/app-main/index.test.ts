import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const fixture = vi.hoisted(() => ({
  open: false,
  position: { x: 50, y: 22 },
  viewport: { width: 1200, height: 800 },
  resizeDirection: null as 'left' | 'right' | null,
  resizeRange: null as null | { initial: number; minimum: number; maximum: number },
  initialX: null as string | number | null,
  animateX: null as string | number | null,
  cssTranslate: null as string | null
}))

vi.mock('@/hooks/useResizable', () => ({
  default: ({
    direction,
    initSize,
    minSize,
    maxSize
  }: {
    direction: 'left' | 'right'
    initSize: number
    minSize: number
    maxSize: number
  }) => {
    fixture.resizeDirection = direction
    fixture.resizeRange = { initial: initSize, minimum: minSize, maximum: maxSize }
    return { size: initSize, setRef: () => {} }
  }
}))
vi.mock('framer-motion', async () => {
  const React = await import('react')
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: {
      div: ({
        children,
        initial,
        animate,
        exit: _exit,
        transition: _transition,
        ...props
      }: { children?: React.ReactNode } & Record<string, unknown>) => {
        fixture.initialX = (initial as { x?: string | number } | undefined)?.x ?? null
        fixture.animateX = (animate as { x?: string | number } | undefined)?.x ?? null
        fixture.cssTranslate = (props.style as { translate?: string } | undefined)?.translate ?? null
        return React.createElement('div', props, children)
      }
    }
  }
})

import AppMain from '.'
import { getAppGeometry } from '@/app/content/views/app-layout/geometry'

afterEach(() => {
  fixture.open = false
  fixture.position = { x: 50, y: 22 }
  fixture.viewport = { width: 1200, height: 800 }
  fixture.resizeDirection = null
  fixture.resizeRange = null
  fixture.initialX = null
  fixture.animateX = null
  fixture.cssTranslate = null
  cleanup()
})

const content = () =>
  createElement(
    AppMain,
    { open: fixture.open, geometry: getAppGeometry(fixture.position, fixture.viewport, true).shell },
    createElement('header', { 'data-testid': 'header' }),
    createElement('main', { 'data-testid': 'main' }),
    createElement('footer', { 'data-testid': 'footer' }),
    createElement('div', { 'data-testid': 'setup' }),
    createElement('section', { 'data-testid': 'toaster' })
  )

describe('AppMain panel ownership', () => {
  it('mounts every business child, including the Toaster, inside the positioned panel', () => {
    fixture.open = true
    render(content())

    const panel = document.querySelector<HTMLElement>('[data-webchat-panel]')
    const toaster = screen.getByTestId('toaster')
    expect(panel).not.toBeNull()
    expect(panel?.className).toContain('fixed')
    expect(toaster.closest('[data-webchat-panel]')).toBe(panel)
    expect([...panel!.children].slice(0, 5)).toEqual([
      screen.getByTestId('header'),
      screen.getByTestId('main'),
      screen.getByTestId('footer'),
      screen.getByTestId('setup'),
      toaster
    ])
  })

  it('does not externalize the Toaster while the panel is collapsed', () => {
    const view = render(content())
    expect(screen.queryByTestId('toaster')).toBeNull()
    expect(document.querySelector('[data-webchat-panel]')).toBeNull()

    fixture.open = true
    view.rerender(content())
    expect(screen.getByTestId('toaster').closest('[data-webchat-panel]')).not.toBeNull()

    fixture.open = false
    view.rerender(content())
    expect(screen.queryByTestId('toaster')).toBeNull()
    expect(document.querySelector('[data-webchat-panel]')).toBeNull()
  })

  it.each([
    {
      side: 'left',
      position: { x: -200, y: 100 },
      direction: 'right' as const,
      handleClass: '-right-0.5'
    },
    {
      side: 'right',
      position: { x: 200, y: 100 },
      direction: 'left' as const,
      handleClass: '-left-0.5'
    },
    {
      side: 'midpoint',
      position: { x: 500, y: 100 },
      direction: 'left' as const,
      handleClass: '-left-0.5'
    }
  ])('uses the shared $side geometry for animation and resize direction', (expected) => {
    fixture.open = true
    fixture.viewport = { width: 1000, height: 800 }
    fixture.position = expected.position
    render(content())

    const panel = document.querySelector<HTMLElement>('[data-webchat-panel]')!
    const resizeHandle = panel.lastElementChild!
    expect(panel.style.left).toBe('var(--webchat-launcher-left)')
    expect(fixture.cssTranslate).toBe('var(--webchat-shell-translate-x)')
    expect(fixture.initialX).toBeNull()
    expect(fixture.animateX).toBeNull()
    expect(fixture.resizeDirection).toBe(expected.direction)
    expect(fixture.resizeRange).toEqual({ initial: 375, minimum: 375, maximum: 375 })
    expect(resizeHandle.className).toContain(expected.handleClass)
  })
})
