import { createRequire } from 'node:module'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { InitializationDependencies, InitializationPhase } from '@/app/content/Initialization'

const initialization = vi.hoisted(() => {
  let phase: InitializationPhase = 'connecting'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => phase,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setPhase: (value: InitializationPhase) => {
      phase = value
      listeners.forEach((listener) => listener())
    },
    retry: vi.fn()
  }
})

vi.mock('@/app/content/Initialization', async () => {
  const React = await import('react')
  return {
    useInitialization: () => ({
      phase: React.useSyncExternalStore(
        initialization.subscribe,
        initialization.getSnapshot,
        initialization.getSnapshot
      ),
      retry: initialization.retry
    })
  }
})
vi.mock('remesh-react', async () => {
  const React = await import('react')
  return {
    RemeshScope: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  }
})
vi.mock('@/app/content/Application', async () => {
  const React = await import('react')
  return { default: () => React.createElement('div', { 'data-testid': 'application' }) }
})
vi.mock('@/app/content/views/app-main', async () => {
  const React = await import('react')
  return {
    default: ({ children, toaster }: { children?: React.ReactNode; toaster?: React.ReactNode }) =>
      React.createElement(
        'section',
        { 'data-testid': 'normal-shell' },
        toaster,
        React.createElement('div', { 'data-testid': 'chat-area' }, children)
      )
  }
})
vi.mock('@/app/content/views/app-button', async () => {
  const React = await import('react')
  return {
    default: ({
      initializationPhase,
      onInitializationRetry
    }: {
      initializationPhase?: Exclude<InitializationPhase, 'ready'>
      onInitializationRetry: () => void
    }) =>
      React.createElement('button', {
        type: 'button',
        'data-testid': 'app-button',
        'data-phase': initializationPhase ?? 'ready',
        onClick: onInitializationRetry
      })
  }
})
vi.mock('@/app/content/components/danmaku-presentation', async () => {
  const React = await import('react')
  return { default: () => React.createElement('div', { 'data-testid': 'danmaku' }) }
})
vi.mock('@/app/content/components/toast-presentation', () => ({ useToastPresentation: () => () => {} }))
vi.mock('sonner', async () => {
  const React = await import('react')
  return {
    Toaster: React.forwardRef((props: Record<string, unknown>, ref) =>
      React.createElement('div', { ...props, ref, 'data-testid': 'toaster' })
    )
  }
})
vi.mock('@/utils', () => ({
  checkDarkMode: () => false,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' ')
}))

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://app.test/'), configurable: true })
Object.defineProperty(document, 'location', { value: window.location, configurable: true })
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  location: window.location,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('@/app/content/App')

const roots: Root[] = []
const containers: HTMLElement[] = []

const dependencies: InitializationDependencies = {
  prepareBrowserSyncStorage: vi.fn(async () => {}),
  prepareLocalStorage: vi.fn(async () => {}),
  prepareMessageDatabase: vi.fn(async () => {}),
  initializeRuntime: vi.fn(async () => ({})),
  detachRuntime: vi.fn()
}

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  containers.splice(0).forEach((container) => container.remove())
  initialization.retry.mockClear()
})

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('normal App shell lifecycle', () => {
  it('preserves one shell, AppButton, chat area, and Toaster through initialization context switching', async () => {
    initialization.setPhase('connecting')
    const container = document.createElement('div')
    document.body.append(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () =>
      root.render(
        React.createElement(App, {
          dependencies,
          activateApplicationDependencies: vi.fn()
        })
      )
    )

    const shell = container.querySelector('[data-testid="normal-shell"]')
    const toaster = container.querySelector('[data-testid="toaster"]')
    const appButton = container.querySelector<HTMLButtonElement>('[data-testid="app-button"]')
    const chatArea = container.querySelector('[data-testid="chat-area"]')
    expect(shell?.contains(toaster)).toBe(true)
    expect(appButton?.dataset.phase).toBe('connecting')
    expect(chatArea).not.toBeNull()
    expect(container.textContent).not.toMatch(/Preparing WebChat|WebChat unavailable/)

    await act(async () => initialization.setPhase('unavailable'))
    expect(container.querySelector('[data-testid="normal-shell"]')).toBe(shell)
    expect(container.querySelector('[data-testid="toaster"]')).toBe(toaster)
    expect(container.querySelector('[data-testid="app-button"]')).toBe(appButton)
    expect(appButton?.dataset.phase).toBe('unavailable')

    await act(async () => appButton?.dispatchEvent(new window.Event('click', { bubbles: true })))
    expect(initialization.retry).toHaveBeenCalledOnce()

    await act(async () => initialization.setPhase('ready'))
    expect(container.querySelector('[data-testid="normal-shell"]')).toBe(shell)
    expect(container.querySelector('[data-testid="toaster"]')).toBe(toaster)
    expect(container.querySelector('[data-testid="app-button"]')).toBe(appButton)
    expect(appButton?.dataset.phase).toBe('ready')
    expect(container.querySelector('[data-testid="application"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="danmaku"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="toaster"]')).toHaveLength(1)
  })
})
