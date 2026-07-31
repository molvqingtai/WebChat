import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('framer-motion', async () => {
  const React = await import('react')
  return {
    AnimatePresence: ({ children, onExitComplete }: { children?: React.ReactNode; onExitComplete?: () => void }) => {
      React.useEffect(() => {
        if (!children) onExitComplete?.()
      }, [children, onExitComplete])
      return React.createElement(React.Fragment, null, children)
    },
    motion: {
      div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement('div', props, children)
    }
  }
})
vi.mock('@/hooks/useResizable', () => ({ default: () => ({ size: 400, setRef: () => {} }) }))
vi.mock('@/hooks/useWindowResize', () => ({ default: () => ({ width: 1200, height: 800 }) }))

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://app-main.test/'), configurable: true })
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
const { AppMainFrame } = await import('.')

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('stable normal shell', () => {
  it('keeps the same shell-owned Toaster mounted across collapsed and expanded panel states', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const toaster = React.createElement('div', { 'data-testid': 'toaster' })
    const render = async (open: boolean) => {
      await act(async () => {
        root.render(
          React.createElement(
            AppMainFrame,
            { open, position: { x: 50, y: 22 }, toaster },
            React.createElement('div', { 'data-testid': 'chat-area' })
          )
        )
      })
    }

    try {
      await render(false)
      const shell = container.querySelector<HTMLElement>('[data-webchat-shell]')
      const initialToaster = container.querySelector('[data-testid="toaster"]')
      expect(shell).not.toBeNull()
      expect(initialToaster).not.toBeNull()
      expect(shell?.contains(initialToaster)).toBe(true)
      expect(shell?.className).toBe('contents')
      expect(container.querySelector('[data-webchat-panel]')).toBeNull()

      await render(true)
      expect(container.querySelector('[data-webchat-shell]')).toBe(shell)
      expect(container.querySelector('[data-testid="toaster"]')).toBe(initialToaster)
      expect(shell?.className).not.toBe('contents')
      expect(container.querySelector('[data-webchat-panel]')).not.toBeNull()
      expect(container.querySelector('[data-testid="chat-area"]')).not.toBeNull()

      await render(false)
      expect(container.querySelector('[data-webchat-shell]')).toBe(shell)
      expect(container.querySelector('[data-testid="toaster"]')).toBe(initialToaster)
      expect(shell?.className).toBe('contents')
      expect(container.querySelector('[data-webchat-panel]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
