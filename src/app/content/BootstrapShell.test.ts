import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const shellState = vi.hoisted(() => {
  let open = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setOpen: (value: boolean) => {
      open = value
      listeners.forEach((listener) => listener())
    }
  }
})

vi.mock('@/app/content/views/app-button', async () => {
  const React = await import('react')
  return {
    default: ({
      bootstrapPhase,
      onBootstrapRetry
    }: {
      bootstrapPhase?: 'connecting' | 'unavailable'
      onBootstrapRetry?: () => void
    }) => {
      const open = React.useSyncExternalStore(shellState.subscribe, shellState.getSnapshot, shellState.getSnapshot)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const action = open ? 'Close WebChat' : 'Open WebChat'
      return React.createElement(
        React.Fragment,
        null,
        menuOpen &&
          bootstrapPhase &&
          React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'bootstrap-refresh',
              'aria-label': bootstrapPhase === 'connecting' ? 'Preparing WebChat setup' : 'Retry WebChat setup',
              disabled: bootstrapPhase === 'connecting',
              onClick: onBootstrapRetry
            },
            React.createElement('span', {
              'data-testid': 'bootstrap-refresh-icon',
              'data-rotating': String(bootstrapPhase === 'connecting')
            })
          ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'launcher',
            'aria-label': action,
            onClick: () => shellState.setOpen(!open),
            onContextMenu: (event: Event) => {
              event.preventDefault()
              setMenuOpen((current) => !current)
            }
          },
          action
        )
      )
    }
  }
})
vi.mock('@/app/content/views/app-main', async () => {
  const React = await import('react')
  return {
    default: ({ children }: { children: ReactNode }) => {
      const open = React.useSyncExternalStore(shellState.subscribe, shellState.getSnapshot, shellState.getSnapshot)
      return open ? React.createElement('div', { 'data-testid': 'panel' }, children) : null
    }
  }
})
vi.mock('@/app/content/components/danmaku-presentation', () => ({ default: () => null }))
vi.mock('@/app/content/components/toast-presentation', () => ({ useToastPresentation: () => () => {} }))
vi.mock('sonner', async () => {
  const React = await import('react')
  return {
    Toaster: React.forwardRef((props: Record<string, unknown>, ref) =>
      React.createElement('div', { ...props, ref, 'data-testid': 'generic-toaster' })
    )
  }
})
vi.mock('@/components/ui/button', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) =>
      React.createElement('button', props, children)
  }
})
vi.mock('lucide-react', async () => {
  const React = await import('react')
  const Icon = (props: Record<string, unknown>) => React.createElement('span', props)
  return { AlertCircleIcon: Icon, LoaderCircleIcon: Icon, RefreshCwIcon: Icon }
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
Object.defineProperty(window, 'location', { value: new URL('https://bootstrap-shell.test/'), configurable: true })
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
const { default: BootstrapShell } = await import('@/app/content/BootstrapShell')

const renderShell = async (phase: 'connecting' | 'unavailable', onRetry = vi.fn()) => {
  shellState.setOpen(false)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(BootstrapShell, { phase, onRetry })))
  return {
    container,
    onRetry,
    cleanup: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

const dispatch = async (element: Element | null, type = 'click') => {
  if (!element) throw new Error('Expected interactive control')
  await act(async () => element.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })))
}

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('BootstrapShell accessibility', () => {
  it('keeps one Toaster outside the panel and routes unavailable recovery through actions Refresh', async () => {
    const rendered = await renderShell('unavailable')

    try {
      const launcher = rendered.container.querySelector<HTMLButtonElement>('[data-testid="launcher"]')
      const toaster = rendered.container.querySelector('[data-testid="generic-toaster"]')
      expect(launcher?.getAttribute('aria-label')).toBe('Open WebChat')
      expect(launcher?.type).toBe('button')
      expect(rendered.container.querySelector('[data-testid="panel"]')).toBeNull()
      expect(toaster).not.toBeNull()

      await dispatch(launcher, 'contextmenu')
      const refresh = rendered.container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-refresh"]')
      expect(refresh?.disabled).toBe(false)
      expect(refresh?.getAttribute('aria-label')).toBe('Retry WebChat setup')
      expect(
        rendered.container.querySelector('[data-testid="bootstrap-refresh-icon"]')?.getAttribute('data-rotating')
      ).toBe('false')
      await dispatch(refresh)
      expect(rendered.onRetry).toHaveBeenCalledOnce()

      await dispatch(launcher)

      const panel = rendered.container.querySelector('[data-testid="panel"]')
      expect(panel?.textContent).toContain('Preparing WebChat')
      expect(panel?.textContent).not.toContain('WebChat unavailable')
      expect(panel?.querySelector('[role="alert"]')).toBeNull()
      expect(panel?.querySelector('[aria-label="Retry WebChat setup"]')).toBeNull()
      expect(panel?.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
      expect(rendered.container.querySelector('[data-testid="generic-toaster"]')).toBe(toaster)
    } finally {
      await rendered.cleanup()
    }
  })

  it('projects an active bootstrap through busy loading content and disabled rotating actions Refresh', async () => {
    const rendered = await renderShell('connecting')

    try {
      const launcher = rendered.container.querySelector<HTMLButtonElement>('[data-testid="launcher"]')
      expect(launcher?.getAttribute('aria-label')).toBe('Open WebChat')

      await dispatch(launcher, 'contextmenu')
      const refresh = rendered.container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-refresh"]')
      expect(refresh?.disabled).toBe(true)
      expect(refresh?.getAttribute('aria-label')).toBe('Preparing WebChat setup')
      expect(
        rendered.container.querySelector('[data-testid="bootstrap-refresh-icon"]')?.getAttribute('data-rotating')
      ).toBe('true')
      await dispatch(refresh)
      expect(rendered.onRetry).not.toHaveBeenCalled()

      await dispatch(launcher)

      expect(rendered.container.querySelector('output')?.textContent).toContain('Preparing WebChat')
      expect(rendered.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
      expect(rendered.container.querySelector('[role="alert"]')).toBeNull()
      expect(rendered.container.querySelector('[data-testid="generic-toaster"]')).not.toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })
})
