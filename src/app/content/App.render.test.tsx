import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  ready: false,
  danmakuEnabled: false,
  visibilityState: 'visible' as DocumentVisibilityState,
  documentIsVisible: null as null | (() => boolean),
  onDanmakuClick: null as null | (() => void),
  send: vi.fn()
}))

vi.mock('remesh-react', () => ({
  useRemeshDomain: (domain: unknown) => domain,
  useRemeshSend: () => fixture.send,
  useRemeshQuery: (query: string) => {
    switch (query) {
      case 'initialization-ready':
        return fixture.ready
      case 'user-load-finished':
        return true
      case 'user-info':
        return { danmakuEnabled: fixture.danmakuEnabled, themeMode: 'system' }
      default:
        return false
    }
  }
}))
vi.mock('@/domain/AppStatus', () => ({
  default: () => ({
    query: {
      ReadyQuery: () => 'initialization-ready',
      OpenQuery: () => 'app-open'
    },
    command: {
      UpdateOpenCommand: (open: boolean) => `update-open-${open}`
    }
  })
}))
vi.mock('@/domain/ChatRoom', () => ({
  default: () => ({
    query: { JoinIsFinishedQuery: () => 'chat-joined' },
    command: { JoinRoomCommand: () => 'join-chat' }
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
    }
  })
}))
vi.mock('@/domain/MessageList', () => ({
  default: () => ({ query: { LoadIsFinishedQuery: () => 'message-load-finished' } })
}))
vi.mock('@/domain/Danmaku', () => ({
  default: () => ({
    command: {
      MountCommand: ({
        onOpen,
        documentIsVisible
      }: {
        container: HTMLElement
        onOpen: () => void
        documentIsVisible: () => boolean
      }) => {
        fixture.onDanmakuClick = onOpen
        fixture.documentIsVisible = documentIsVisible
        return 'mount-danmaku'
      },
      UnmountCommand: () => 'unmount-danmaku'
    }
  })
}))
vi.mock('@/app/content/views/header', () => ({ default: () => <header data-testid="header" /> }))
vi.mock('@/app/content/views/main', () => ({ default: () => <main data-testid="main" /> }))
vi.mock('@/app/content/views/footer', () => ({ default: () => <footer data-testid="footer" /> }))
vi.mock('@/app/content/views/setup', () => ({ default: () => <aside data-testid="setup" /> }))
vi.mock('@/app/content/views/app-layout', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <>
      <section data-testid="app-main">{children}</section>
      <button aria-label="Open WebChat" data-testid="app-button" />
    </>
  )
}))
vi.mock('@/app/content/components/danmaku-container', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => <div data-testid="danmaku" />) }
})
vi.mock('sonner', () => ({ Toaster: () => <div data-testid="toaster" /> }))
vi.mock('@/utils', () => ({
  checkDarkMode: () => false,
  clamp: (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value)),
  isInRange: (value: number, minimum: number, maximum: number) => value >= minimum && value <= maximum,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' ')
}))

import App from '@/app/content/App'

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => fixture.visibilityState)
})

afterEach(() => {
  cleanup()
  fixture.ready = false
  fixture.danmakuEnabled = false
  fixture.visibilityState = 'visible'
  fixture.documentIsVisible = null
  fixture.onDanmakuClick = null
  fixture.send.mockClear()
  vi.restoreAllMocks()
})

describe('normal App composition', () => {
  it('keeps one business tree and Toaster before and after initialization readiness', () => {
    const view = render(<App />)
    const appMain = screen.getByTestId('app-main')
    const appButton = screen.getByTestId('app-button')
    const toaster = screen.getByTestId('toaster')
    const danmaku = screen.getByTestId('danmaku')

    expect([...appMain.children]).toEqual([
      screen.getByTestId('header'),
      screen.getByTestId('main'),
      screen.getByTestId('footer'),
      screen.getByTestId('setup'),
      toaster
    ])
    expect(appMain.contains(toaster)).toBe(true)
    expect(screen.getAllByTestId('toaster')).toHaveLength(1)

    fixture.ready = true
    view.rerender(<App />)

    expect(screen.getByTestId('app-main')).toBe(appMain)
    expect(screen.getByTestId('app-button')).toBe(appButton)
    expect(screen.getByTestId('toaster')).toBe(toaster)
    expect(screen.getByTestId('danmaku')).toBe(danmaku)
  })

  it('routes a Danmaku click directly to the existing AppStatus open command', () => {
    fixture.danmakuEnabled = true
    render(<App />)
    expect(fixture.onDanmakuClick).toEqual(expect.any(Function))
    fixture.send.mockClear()

    fixture.onDanmakuClick!()

    expect(fixture.send).toHaveBeenCalledExactlyOnceWith('update-open-true')
  })

  it('reads local visibility through the binding without making visibility a lifecycle owner', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    fixture.danmakuEnabled = true
    fixture.visibilityState = 'hidden'
    const view = render(<App />)

    expect(fixture.send).toHaveBeenCalledExactlyOnceWith('mount-danmaku')
    expect(fixture.documentIsVisible?.()).toBe(false)
    expect(addEventListener).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    fixture.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fixture.documentIsVisible?.()).toBe(true)
    expect(fixture.send).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(fixture.send).toHaveBeenNthCalledWith(2, 'unmount-danmaku')
    expect(removeEventListener).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('keeps the existing setting as the sole manager lifecycle owner', () => {
    const view = render(<App />)
    expect(fixture.send).not.toHaveBeenCalled()

    fixture.danmakuEnabled = true
    view.rerender(<App />)
    expect(fixture.send).toHaveBeenCalledExactlyOnceWith('mount-danmaku')

    fixture.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    fixture.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fixture.send).toHaveBeenCalledTimes(1)

    fixture.danmakuEnabled = false
    view.rerender(<App />)
    expect(fixture.send).toHaveBeenNthCalledWith(2, 'unmount-danmaku')
  })

  it('keeps visibility eligibility local to the content document', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/content/App.tsx'), 'utf8')

    expect(source).toContain("document.visibilityState === 'visible'")
    expect(source).not.toContain("addEventListener('visibilitychange'")
    expect(source).not.toContain("removeEventListener('visibilitychange'")
    expect(source).not.toMatch(/\b(?:browser|chrome)\.(?:tabs|windows)\b/)
  })
})
