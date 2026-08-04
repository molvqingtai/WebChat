import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('date-fns', () => ({ getDay: () => 0 }))
vi.mock('@/assets/images/logo-0.svg', () => ({ default: () => <svg aria-hidden="true" /> }))

import { AppLauncherButton } from '@/app/content/views/app-button'

const hasClasses = (element: Element, classes: string[]) =>
  classes.every((className) => element.classList.contains(className))

describe('AppButton unread indicator', () => {
  it('replaces only the daily logo with the selected author avatar and name fallback', async () => {
    const avatarSource = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    const author = { id: 'remote-user', name: 'Remote', avatar: avatarSource }
    const view = await render(
      <AppLauncherButton author={author} hasUnread label="Open WebChat" size={44} onClick={() => {}} />
    )

    const button = document.querySelector('button')!
    const avatar = button.querySelector('[data-slot="avatar"]')!
    expect(avatar).not.toBeNull()
    await vi.waitFor(() => expect(avatar.querySelector('img')?.getAttribute('src')).toBe(avatarSource))
    expect(button.querySelector('svg')).toBeNull()
    expect(button.querySelector('span.bg-orange-400')).not.toBeNull()
    expect(button.style.width).toBe('44px')
    expect(button.style.height).toBe('44px')

    await view.rerender(
      <AppLauncherButton
        author={{ ...author, avatar: '' }}
        hasUnread
        label="Open WebChat"
        size={44}
        onClick={() => {}}
      />
    )
    await vi.waitFor(() => expect(button.querySelector('[data-slot="avatar"]')?.textContent).toBe('R'))

    await view.rerender(<AppLauncherButton label="Open WebChat" size={44} onClick={() => {}} />)
    expect(button.querySelector('[data-slot="avatar"]')).toBeNull()
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('renders the exact count-free orange ping and 0.1-second presence transition only while unread', async () => {
    const view = await render(<AppLauncherButton hasUnread label="Open WebChat" size={44} onClick={() => {}} />)
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
    expect(button.style.width).toBe('44px')
    expect(button.style.height).toBe('44px')
    expect(button.classList.contains('size-11')).toBe(false)

    await vi.waitFor(() => {
      const durations = indicator
        .getAnimations()
        .map((animation) => animation.effect?.getTiming().duration)
        .filter((duration): duration is number => typeof duration === 'number')
      expect(durations).toContain(100)
    })

    await view.rerender(<AppLauncherButton hasUnread={false} label="Open WebChat" size={44} onClick={() => {}} />)
    expect(indicator.isConnected).toBe(true)
    await vi.waitFor(() => expect(indicator.isConnected).toBe(false))
    expect(document.querySelector('span.bg-orange-400')).toBeNull()
    expect(document.querySelector('span.bg-orange-500')).toBeNull()
  })
})
