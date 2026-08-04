import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  ready: false,
  danmakuEnabled: false,
  visibilityState: 'visible' as DocumentVisibilityState,
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
        return `sync-danmaku-${documentIsVisible?.() === false ? 'hidden' : 'visible'}`
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
  fixture.onDanmakuClick = null
  fixture.send.mockClear()
  vi.restoreAllMocks()
})

const setDocumentVisibility = (visibilityState: DocumentVisibilityState) => {
  fixture.visibilityState = visibilityState
  act(() => document.dispatchEvent(new Event('visibilitychange')))
}

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

  it('synchronously reports local document visibility through one persistent Danmaku binding', () => {
    fixture.danmakuEnabled = true
    fixture.visibilityState = 'hidden'
    const view = render(<App />)

    expect(fixture.send).toHaveBeenCalledExactlyOnceWith('sync-danmaku-hidden')

    setDocumentVisibility('visible')
    expect(fixture.send).toHaveBeenNthCalledWith(2, 'sync-danmaku-visible')

    setDocumentVisibility('hidden')
    expect(fixture.send).toHaveBeenNthCalledWith(3, 'sync-danmaku-hidden')

    view.unmount()
    expect(fixture.send).toHaveBeenNthCalledWith(4, 'unmount-danmaku')
  })

  it('removes each document visibility subscription when its App is disposed', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')

    const first = render(<App />)
    const firstListener = addEventListener.mock.calls.find(([type]) => type === 'visibilitychange')?.[1]
    expect(firstListener).toEqual(expect.any(Function))
    first.unmount()
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', firstListener)

    const second = render(<App />)
    const visibilityListeners = addEventListener.mock.calls.filter(([type]) => type === 'visibilitychange')
    const secondListener = visibilityListeners.at(-1)?.[1]
    expect(secondListener).toEqual(expect.any(Function))
    second.unmount()
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', secondListener)
  })

  it('keeps visibility eligibility local to the content document', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/content/App.tsx'), 'utf8')

    expect(source).toContain("document.visibilityState === 'visible'")
    expect(source).not.toMatch(/\b(?:browser|chrome)\.(?:tabs|windows)\b/)
  })
})
