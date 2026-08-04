import type { ComponentProps } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FramerMotionModule from 'framer-motion'

const fixture = vi.hoisted(() => ({
  identityPresenceRenders: 0
}))

vi.mock('date-fns', () => ({ getDay: () => 0 }))
vi.mock('@/assets/images/logo-0.svg', () => ({
  default: () => <svg data-testid="daily-logo" aria-hidden="true" />
}))
vi.mock('framer-motion', async (importOriginal) => {
  const original = await importOriginal<typeof FramerMotionModule>()
  return {
    ...original,
    AnimatePresence: ({ children, mode }: ComponentProps<typeof original.AnimatePresence>) => {
      if (mode === 'sync') fixture.identityPresenceRenders += 1
      return children
    },
    useReducedMotion: () => true
  }
})

import { AppLauncherButton } from '@/app/content/views/app-button'

beforeEach(() => {
  fixture.identityPresenceRenders = 0
})

afterEach(cleanup)

describe('AppButton reduced-motion identity', () => {
  it('never enters the presence lifetime that can retain an outgoing plain identity', () => {
    const view = render(<AppLauncherButton label="Open WebChat" size={44} onClick={() => {}} />)
    view.rerender(
      <AppLauncherButton
        author={{ id: 'alpha', name: 'Alpha', avatar: '' }}
        label="Open WebChat"
        size={44}
        onClick={() => {}}
      />
    )

    expect(fixture.identityPresenceRenders).toBe(0)
  })

  it('settles every latest logo or author identity directly without retaining the outgoing identity', () => {
    const view = render(<AppLauncherButton label="Open WebChat" size={44} onClick={() => {}} />)
    const button = view.getByRole('button', { name: 'Open WebChat' })

    view.rerender(
      <AppLauncherButton
        author={{ id: 'alpha', name: 'Alpha', avatar: '' }}
        label="Open WebChat"
        size={44}
        onClick={() => {}}
      />
    )
    expect(button.querySelector('[data-testid="daily-logo"]')).toBeNull()
    expect(button.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
    expect(button.querySelector('[data-slot="avatar"]')?.textContent).toBe('A')

    view.rerender(
      <AppLauncherButton
        author={{ id: 'beta', name: 'Beta', avatar: '' }}
        label="Open WebChat"
        size={44}
        onClick={() => {}}
      />
    )
    expect(button.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
    expect(button.querySelector('[data-slot="avatar"]')?.textContent).toBe('B')

    view.rerender(<AppLauncherButton label="Open WebChat" size={44} onClick={() => {}} />)
    expect(button.querySelector('[data-slot="avatar"]')).toBeNull()
    expect(button.querySelectorAll('[data-testid="daily-logo"]')).toHaveLength(1)
    expect(button.querySelectorAll('[data-slot="app-launcher-identity"]')).toHaveLength(1)
  })
})
