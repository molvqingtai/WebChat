import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const fixture = vi.hoisted(() => ({ open: false }))

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
  useRemeshQuery: (query: string) => (query === 'open' ? fixture.open : { x: 50, y: 22 })
}))
vi.mock('@/hooks/useResizable', () => ({ default: () => ({ size: 400, setRef: () => {} }) }))
vi.mock('@/hooks/useWindowResize', () => ({ default: () => ({ width: 1200, height: 800 }) }))
vi.mock('framer-motion', async () => {
  const React = await import('react')
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: {
      div: ({
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        onAnimationEnd: _onAnimationEnd,
        onAnimationStart: _onAnimationStart,
        ...props
      }: { children?: React.ReactNode } & Record<string, unknown>) => React.createElement('div', props, children)
    }
  }
})

import AppMain from '.'

afterEach(() => {
  fixture.open = false
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
})
