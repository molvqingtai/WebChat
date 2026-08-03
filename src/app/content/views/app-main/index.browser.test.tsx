import { page } from 'vitest/browser'
import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import '@/assets/styles/tailwind.css'

const fixture = vi.hoisted(() => {
  const initialState = {
    open: true,
    position: { x: 50, y: 22 },
    ready: false
  }
  let state = { ...initialState, position: { ...initialState.position } }
  const listeners = new Set<() => void>()
  const positionWrites: Array<{ x: number; y: number }> = []

  const update = (next: Partial<typeof state>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }

  const send = vi.fn((command: unknown) => {
    if (typeof command !== 'object' || command === null) return
    const value = command as { type: 'open'; value: boolean } | { type: 'position'; value: { x: number; y: number } }
    if (value.type === 'open') update({ open: value.value })
    if (value.type === 'position') {
      positionWrites.push(value.value)
      update({ position: value.value })
    }
  })

  return {
    get state() {
      return state
    },
    positionWrites,
    send,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => state,
    reset: (next: Partial<typeof state> = {}) => {
      state = { ...initialState, position: { ...initialState.position }, ...next }
      positionWrites.length = 0
      send.mockClear()
    },
    synchronizeOpen: (open: boolean) => update({ open }),
    synchronizePosition: (position: { x: number; y: number }) => update({ position })
  }
})

vi.mock('remesh-react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useRemeshDomain: (domain: unknown) => domain,
    useRemeshSend: () => fixture.send,
    useRemeshQuery: (query: string) => {
      const state = useSyncExternalStore(fixture.subscribe, fixture.snapshot)
      switch (query) {
        case 'app-open':
          return state.open
        case 'app-position':
          return state.position
        case 'initialization-ready':
          return state.ready
        case 'app-phase':
          return state.ready ? 'ready' : 'connecting'
        case 'user-load-finished':
          return true
        case 'user-info':
          return null
        default:
          return false
      }
    }
  }
})
vi.mock('@/domain/AppStatus', () => ({
  default: () => ({
    query: {
      OpenQuery: () => 'app-open',
      PositionQuery: () => 'app-position',
      HasUnreadQuery: () => 'app-unread',
      PhaseQuery: () => 'app-phase',
      ReadyQuery: () => 'initialization-ready'
    },
    command: {
      UpdateOpenCommand: (value: boolean) => ({ type: 'open', value }),
      UpdatePositionCommand: (value: { x: number; y: number }) => ({ type: 'position', value }),
      RetryCommand: () => 'retry-initialization'
    }
  })
}))
vi.mock('@/domain/ChatRoom', () => ({
  default: () => ({
    query: {
      JoinIsFinishedQuery: () => 'chat-joined',
      ConnectionIsLoadingQuery: () => 'chat-connecting',
      ReconnectAvailableQuery: () => 'chat-reconnect-available'
    },
    command: { JoinRoomCommand: () => 'join-chat', ReconnectCommand: () => 'reconnect-chat' }
  })
}))
vi.mock('@/domain/WorldRoom', () => ({
  default: () => ({
    query: { JoinIsFinishedQuery: () => 'world-joined' },
    command: { JoinRoomCommand: () => 'join-world' }
  })
}))
vi.mock('@/domain/UserInfo', () => ({
  default: () => ({
    query: {
      UserInfoSetIsFinishedQuery: () => 'user-set-finished',
      UserInfoLoadIsFinishedQuery: () => 'user-load-finished',
      UserInfoQuery: () => 'user-info'
    },
    command: { UpdateUserInfoCommand: () => 'update-user-info' }
  })
}))
vi.mock('@/domain/MessageList', () => ({
  default: () => ({ query: { LoadIsFinishedQuery: () => 'message-load-finished' } })
}))
vi.mock('@/domain/Danmaku', () => ({
  default: () => ({
    command: { MountCommand: () => 'mount-danmaku', UnmountCommand: () => 'unmount-danmaku' }
  })
}))
vi.mock('@/domain/AppAction', () => ({
  default: () => ({ command: { OpenOptionsCommand: () => 'open-options' } })
}))
vi.mock('@/app/content/views/header', () => ({ default: () => <header data-testid="header" /> }))
vi.mock('@/app/content/views/main', () => ({ default: () => <main data-testid="main" /> }))
vi.mock('@/app/content/views/footer', () => ({ default: () => <footer data-testid="footer" /> }))
vi.mock('@/app/content/views/setup', () => ({ default: () => <aside data-testid="setup" /> }))
vi.mock('@/app/content/components/danmaku-container', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => <div data-testid="danmaku" />) }
})
vi.mock('date-fns', () => ({ getDay: () => 0 }))
vi.mock('@/assets/images/logo-0.svg', () => ({ default: () => <svg aria-hidden="true" /> }))
vi.mock('@/utils', () => ({
  checkDarkMode: () => false,
  clamp: (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value)),
  isInRange: (value: number, minimum: number, maximum: number) => value >= minimum && value <= maximum,
  cn: (...values: Array<string | Record<string, boolean> | undefined>) =>
    values
      .flatMap((value) =>
        typeof value === 'string'
          ? value
          : Object.entries(value ?? {})
              .filter(([, enabled]) => enabled)
              .map(([key]) => key)
      )
      .join(' ')
}))

import App from '@/app/content/App'

const getLauncher = () => document.querySelector<HTMLButtonElement>('button[aria-label$="WebChat"]')!
const getLauncherPositioner = () => getLauncher().closest<HTMLElement>('div.fixed')!
const getPanel = () => document.querySelector<HTMLElement>('[data-webchat-panel]')
const getLauncherToShellOffset = () => {
  const panel = getPanel()!
  return (
    Number.parseFloat(getComputedStyle(panel).bottom) -
    Number.parseFloat(getComputedStyle(getLauncherPositioner()).bottom)
  )
}

beforeEach(async () => {
  fixture.reset()
  await page.viewport(1200, 800)
})

afterEach(() => {
  cleanup()
})

describe('App browser ancestry', () => {
  it('renders the real Sonner Toaster inside the positioned AppMain panel before initialization is ready', async () => {
    await render(<App />)
    const toastId = toast.loading('Preparing WebChat')

    await vi.waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    const panel = getPanel()!
    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')!

    expect(panel.classList.contains('fixed')).toBe(true)
    expect(toaster.closest('[data-webchat-panel]')).toBe(panel)
    expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
    expect([...panel.children].slice(0, 4).map((element) => element.getAttribute('data-testid'))).toEqual([
      'header',
      'main',
      'footer',
      'setup'
    ])
    expect(panel.children[4]?.contains(toaster)).toBe(true)
    toast.dismiss(toastId)
  })

  it('keeps one rendered point through open, close presence, and same-domain reopen without a position write', async () => {
    fixture.reset({ open: false, position: { x: -200, y: 756 } })
    await page.viewport(1000, 800)
    await render(<App />)

    expect(getComputedStyle(getLauncherPositioner()).bottom).toBe('756px')
    getLauncher().click()

    await vi.waitFor(() => {
      expect(getLauncher().ariaLabel).toBe('Close WebChat')
      expect(getPanel()).not.toBeNull()
      expect(getLauncherToShellOffset()).toBeCloseTo(22, 5)
    })

    getLauncher().click()
    await vi.waitFor(() => expect(getComputedStyle(getLauncherPositioner()).bottom).toBe('756px'))
    const closePresenceOffset = getLauncherToShellOffset()

    await vi.waitFor(() => expect(getPanel()).toBeNull())
    fixture.synchronizeOpen(true)
    await vi.waitFor(() => {
      expect(getLauncher().ariaLabel).toBe('Close WebChat')
      expect(getPanel()).not.toBeNull()
      expect(getLauncherToShellOffset()).toBeCloseTo(22, 5)
    })

    expect(closePresenceOffset).toBeCloseTo(22, 5)
    expect(fixture.positionWrites).toEqual([])
    expect(fixture.state.position).toEqual({ x: -200, y: 756 })
  })

  it('keeps the exiting shell anchored when a synchronized position crosses the midpoint', async () => {
    fixture.reset({ position: { x: -200, y: 100 } })
    await page.viewport(1000, 800)
    await render(<App />)

    await vi.waitFor(() => expect(getPanel()?.getBoundingClientRect().left).toBeCloseTo(200, 1))
    await vi.waitFor(() => expect(Number.parseFloat(getComputedStyle(getPanel()!).opacity)).toBeCloseTo(1, 3))
    getLauncher().click()
    fixture.synchronizePosition({ x: 200, y: 100 })

    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>('#app')!.style.getPropertyValue('--webchat-shell-translate-x')).toBe(
        '-100%'
      )
    )
    const launcher = getLauncher().getBoundingClientRect()
    const exitingPanel = getPanel()
    expect(exitingPanel).not.toBeNull()
    expect(launcher.left + launcher.width / 2).toBeCloseTo(800, 1)
    expect(exitingPanel!.getBoundingClientRect().right).toBeCloseTo(800, 1)

    expect(fixture.positionWrites).toEqual([])
    expect(fixture.state.position).toEqual({ x: 200, y: 100 })
    await vi.waitFor(() => expect(getPanel()).toBeNull())
  })

  it('uses only real resizer widths and preserves local-only projection across the height threshold', async () => {
    fixture.reset({ position: { x: -180, y: 400 } })
    await page.viewport(400, 458)
    await render(<App />)

    await vi.waitFor(() => {
      expect(getPanel()?.getBoundingClientRect().height).toBe(375)
      expect(getLauncherToShellOffset()).toBeCloseTo(22, 5)
    })

    await page.viewport(400, 459)
    await vi.waitFor(() => {
      expect(getComputedStyle(getLauncherPositioner()).bottom).toBe('22px')
      expect(getLauncherToShellOffset()).toBeCloseTo(22, 5)
    })

    await page.viewport(1000, 800)
    await vi.waitFor(() => expect(getPanel()?.getBoundingClientRect().width).toBe(375))
    await page.viewport(3000, 800)
    await vi.waitFor(() => expect(getPanel()?.getBoundingClientRect().width).toBe(500))
    await page.viewport(4500, 800)
    await vi.waitFor(() => expect(getPanel()?.getBoundingClientRect().width).toBe(750))

    expect(fixture.positionWrites).toEqual([])
    expect(fixture.state.position).toEqual({ x: -180, y: 400 })
  })
})
