import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('date-fns', () => ({ getDay: () => 0 }))
vi.mock('@/assets/images/logo-0.svg', () => ({ default: () => <svg aria-hidden="true" /> }))

import { AppLauncherButton } from '@/app/content/views/app-button'

const hasClasses = (element: Element, classes: string[]) =>
  classes.every((className) => element.classList.contains(className))

describe('AppButton unread indicator', () => {
  it('renders the exact count-free orange ping and 0.1-second presence transition only while unread', async () => {
    const view = await render(<AppLauncherButton hasUnread label="Open WebChat" onClick={() => {}} />)
    const ping = document.querySelector<HTMLElement>('span.bg-orange-400')!
    const center = document.querySelector<HTMLElement>('span.bg-orange-500')!
    const indicator = ping.parentElement!
    const button = indicator.closest('button')!

    expect(hasClasses(indicator, ['absolute', '-top-1', '-right-1', 'z-30', 'flex', 'size-5'])).toBe(true)
    expect(
      hasClasses(ping, ['absolute', 'inline-flex', 'size-full', 'animate-ping', 'rounded-full', 'opacity-75'])
    ).toBe(true)
    expect(hasClasses(center, ['relative', 'inline-flex', 'size-3', 'rounded-full'])).toBe(true)
    expect(indicator.textContent).toBe('')
    expect(button.classList.contains('size-11')).toBe(true)

    await vi.waitFor(() => {
      const durations = indicator
        .getAnimations()
        .map((animation) => animation.effect?.getTiming().duration)
        .filter((duration): duration is number => typeof duration === 'number')
      expect(durations).toContain(100)
    })

    await view.rerender(<AppLauncherButton hasUnread={false} label="Open WebChat" onClick={() => {}} />)
    expect(indicator.isConnected).toBe(true)
    await vi.waitFor(() => expect(indicator.isConnected).toBe(false))
    expect(document.querySelector('span.bg-orange-400')).toBeNull()
    expect(document.querySelector('span.bg-orange-500')).toBeNull()
  })
})
