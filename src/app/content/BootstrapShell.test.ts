import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('@/app/content/views/app-button', async () => {
  const React = await import('react')
  return {
    AppLauncherButton: ({ label, onClick }: { label: string; onClick: () => void }) =>
      React.createElement('button', { type: 'button', 'data-testid': 'launcher', 'aria-label': label, onClick }, label)
  }
})
vi.mock('@/app/content/views/app-main', async () => {
  const React = await import('react')
  return {
    AppMainFrame: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? React.createElement('div', { 'data-testid': 'panel' }, children) : null
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

const click = async (element: Element | null) => {
  if (!element) throw new Error('Expected interactive control')
  await act(async () => element.dispatchEvent(new window.Event('click', { bubbles: true })))
}

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('BootstrapShell accessibility', () => {
  it('keeps a named launcher and exposes one alert with a keyboard-native Retry button', async () => {
    const rendered = await renderShell('unavailable')

    try {
      const launcher = rendered.container.querySelector<HTMLButtonElement>('[data-testid="launcher"]')
      expect(launcher?.getAttribute('aria-label')).toBe('WebChat unavailable. Open WebChat')
      expect(launcher?.type).toBe('button')
      expect(rendered.container.querySelector('[data-testid="panel"]')).toBeNull()

      await click(launcher)

      expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('WebChat unavailable')
      const retry = rendered.container.querySelector<HTMLButtonElement>('[aria-label="Retry WebChat setup"]')
      expect(retry?.type).toBe('button')
      expect(launcher?.getAttribute('aria-label')).toBe('WebChat unavailable. Close WebChat')

      await click(retry)
      expect(rendered.onRetry).toHaveBeenCalledOnce()
    } finally {
      await rendered.cleanup()
    }
  })

  it('keeps the closed launcher usable while preparation is still bounded and busy', async () => {
    const rendered = await renderShell('connecting')

    try {
      const launcher = rendered.container.querySelector<HTMLButtonElement>('[data-testid="launcher"]')
      expect(launcher?.getAttribute('aria-label')).toBe('Open WebChat')

      await click(launcher)

      expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain('Preparing WebChat')
      expect(rendered.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
      expect(rendered.container.querySelector('[aria-label="Retry WebChat setup"]')).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })
})
