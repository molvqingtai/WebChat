import { cleanup, render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import '@/assets/styles/tailwind.css'
import Header from '.'

const queries = vi.hoisted(() => [] as unknown[][])

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => ({ query: { UserListQuery: () => ({}) } }),
  useRemeshQuery: () => queries.shift()
}))

vi.mock('@/components/ui/hover-card', async () => {
  const React = await import('react')
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    HoverCard: PassThrough,
    HoverCardTrigger: PassThrough,
    HoverCardContent: PassThrough
  }
})

// No `@/utils` mock here: `getSiteMeta` only reads document.location/meta and is deterministic
// inside the real browser page, and an `importOriginal` factory on an aliased module stalls
// vitest browser-mode module resolution.

const user = (id: string) => ({ id, name: id, avatar: '' })

afterEach(() => {
  cleanup()
})

describe('Header high-count room list geometry', () => {
  it('keeps every room row in real DOM with reserved 56px geometry and anchor semantics', async () => {
    const sites = Array.from({ length: 120 }, (_, index) => ({
      origin: `https://room-${index}.test`,
      icon: '',
      users: [user(`user-${index}`)]
    }))
    queries.splice(0, queries.length, [], sites)

    await render(createElement(Header))

    // The world hover card viewport is the one containing the 56px-reserved room rows.
    const worldViewport = [...document.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')].find(
      (element) => element.querySelector('[class*="contain-intrinsic-size:auto_56px"]')
    )!
    expect(worldViewport).not.toBeNull()

    // No virtualization: all 120 room rows are real DOM nodes.
    const rows = worldViewport.querySelectorAll('[class*="contain-intrinsic-size:auto_56px"]')
    expect(rows).toHaveLength(120)

    // Geometry: content-visibility reserves each offscreen row's intrinsic 56px, so the
    // viewport stays scrollable with a bounded, reservation-driven scroll height.
    await vi.waitFor(() => {
      expect(worldViewport.scrollHeight).toBeGreaterThan(120 * 40)
      expect(worldViewport.scrollHeight).toBeLessThan(120 * 120)
    })
    expect(worldViewport.scrollHeight).toBeGreaterThan(worldViewport.clientHeight)
    expect(getComputedStyle(rows[0]).contentVisibility).toBe('auto')
    expect(getComputedStyle(rows[0]).containIntrinsicSize).toContain('56px')

    // Accessible room semantics: every row exposes a real anchor to its room origin.
    const firstAnchor = rows[0].querySelector('a')
    expect(firstAnchor?.getAttribute('href')).toBe('https://room-0.test')
    expect(rows[0].textContent).toContain('room-0.test')
  })
})
