import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const fixture = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('remesh-react', () => ({
  useRemeshDomain: (domain: unknown) => domain,
  useRemeshSend: () => fixture.send,
  useRemeshQuery: (query: string) => {
    if (query === 'app-open') return true
    if (query === 'app-position') return { x: 50, y: 22 }
    if (query === 'user-load-finished') return true
    if (query === 'user-info') return null
    return false
  }
}))
vi.mock('@/domain/AppStatus', () => ({
  default: () => ({
    query: {
      OpenQuery: () => 'app-open',
      PositionQuery: () => 'app-position'
    }
  })
}))
vi.mock('@/app/content/Initialization', () => ({
  default: () => ({ query: { ReadyQuery: () => 'initialization-ready' } })
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
    query: { IsEnabledQuery: () => 'danmaku-enabled' },
    command: { MountCommand: () => 'mount-danmaku', UnmountCommand: () => 'unmount-danmaku' }
  })
}))
vi.mock('@/app/content/views/header', () => ({ default: () => <header data-testid="header" /> }))
vi.mock('@/app/content/views/main', () => ({ default: () => <main data-testid="main" /> }))
vi.mock('@/app/content/views/footer', () => ({ default: () => <footer data-testid="footer" /> }))
vi.mock('@/app/content/views/setup', () => ({ default: () => <aside data-testid="setup" /> }))
vi.mock('@/app/content/views/app-button', () => ({ default: () => <button aria-label="Open WebChat" /> }))
vi.mock('@/app/content/components/danmaku-container', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => <div data-testid="danmaku" />) }
})
vi.mock('@/hooks/useResizable', () => ({ default: () => ({ size: 400, setRef: () => {} }) }))
vi.mock('@/hooks/useWindowResize', () => ({ default: () => ({ width: 1200, height: 800 }) }))
vi.mock('@/utils', () => ({
  checkDarkMode: () => false,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === 'string').join(' ')
}))

import App from '@/app/content/App'

describe('App browser ancestry', () => {
  it('renders the real Sonner Toaster inside the positioned AppMain panel before initialization is ready', async () => {
    await render(<App />)
    const toastId = toast.loading('Preparing WebChat')

    await vi.waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    const panel = document.querySelector<HTMLElement>('[data-webchat-panel]')!
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
})
