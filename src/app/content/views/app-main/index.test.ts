import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const fixture = vi.hoisted(() => ({
  open: false,
  position: { x: 50, y: 22 },
  viewport: { width: 1200, height: 800 },
  resizeDirection: null as 'left' | 'right' | null,
  initialX: null as string | number | null,
  animateX: null as string | number | null
}))

vi.mock('@/domain/AppStatus', () => ({
  default: () => ({
    query: {
      OpenQuery: () => 'open',
      PositionQuery: () => 'position'
    }
  })
}))
vi.mock('remesh-react', () => ({
  useRemeshDomain: (domain: unknown) => domain,
  useRemeshQuery: (query: string) => (query === 'open' ? fixture.open : fixture.position)
}))
vi.mock('@/hooks/useResizable', () => ({
  default: ({ direction }: { direction: 'left' | 'right' }) => {
    fixture.resizeDirection = direction
    return { size: 400, setRef: () => {} }
  }
}))
vi.mock('@/hooks/useWindowResize', () => ({ default: () => fixture.viewport }))
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
        onAnimationEnd: _onAnimationEnd,
        onAnimationStart: _onAnimationStart,
        ...props
      }: { children?: React.ReactNode } & Record<string, unknown>) => {
        fixture.initialX = (initial as { x?: string | number } | undefined)?.x ?? null
        fixture.animateX = (animate as { x?: string | number } | undefined)?.x ?? null
        return React.createElement('div', props, children)
      }
    }
  }
})

import AppMain from '.'

afterEach(() => {
  fixture.open = false
  fixture.position = { x: 50, y: 22 }
  fixture.viewport = { width: 1200, height: 800 }
  fixture.resizeDirection = null
  fixture.initialX = null
  fixture.animateX = null
  cleanup()
})

const content = () =>
  createElement(
    AppMain,
    null,
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
      expectedLeft: '200px',
      direction: 'right' as const,
      animationX: '0',
      handleClass: '-right-0.5'
    },
    {
      side: 'right',
      position: { x: 200, y: 100 },
      expectedLeft: '800px',
      direction: 'left' as const,
      animationX: '-100%',
      handleClass: '-left-0.5'
    },
    {
      side: 'midpoint',
      position: { x: 500, y: 100 },
      expectedLeft: '500px',
      direction: 'left' as const,
      animationX: '-100%',
      handleClass: '-left-0.5'
    }
  ])('projects the $side anchor once for panel placement, animation, and resize direction', (expected) => {
    fixture.open = true
    fixture.viewport = { width: 1000, height: 800 }
    fixture.position = expected.position
    render(content())

    const panel = document.querySelector<HTMLElement>('[data-webchat-panel]')!
    const resizeHandle = panel.lastElementChild!
    expect(panel.style.left).toBe(expected.expectedLeft)
    expect(panel.style.bottom).toBe('calc(100vh - 700px + 22px)')
    expect(fixture.initialX).toBe(expected.animationX)
    expect(fixture.animateX).toBe(expected.animationX)
    expect(fixture.resizeDirection).toBe(expected.direction)
    expect(resizeHandle.className).toContain(expected.handleClass)
  })

  it('reprojects a bounded shared coordinate on resize and derives the panel side from the rendered point', () => {
    fixture.open = true
    fixture.position = { x: 500, y: 500 }
    fixture.viewport = { width: 400, height: 250 }
    const view = render(content())

    const panel = document.querySelector<HTMLElement>('[data-webchat-panel]')!
    expect(panel.style.left).toBe('50px')
    expect(panel.style.bottom).toBe('calc(100vh - 44px + 22px)')
    expect(fixture.resizeDirection).toBe('right')
    expect(fixture.animateX).toBe('0')

    fixture.viewport = { width: 1200, height: 900 }
    view.rerender(content())

    expect(panel.style.left).toBe('700px')
    expect(panel.style.bottom).toBe('calc(100vh - 400px + 22px)')
    expect(fixture.resizeDirection).toBe('left')
    expect(fixture.animateX).toBe('-100%')
    expect(fixture.position).toEqual({ x: 500, y: 500 })
  })
})
