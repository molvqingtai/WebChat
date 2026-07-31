import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapDependencies } from '@/app/content/Bootstrap'

vi.mock('@/app/content/BootstrapShell', async () => {
  const React = await import('react')
  return {
    useAppTheme: () => vi.fn(),
    default: ({
      phase,
      onRetry,
      application
    }: {
      phase: string
      onRetry: () => void
      application?: React.ReactNode
    }) => {
      const [open, setOpen] = React.useState(false)
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'section',
          { 'data-testid': 'application-frame', 'data-open': String(open) },
          application ??
            React.createElement(
              'section',
              {
                'data-testid': 'bootstrap-shell',
                'data-phase': phase,
                'data-open': String(open),
                'aria-busy': String(phase === 'connecting')
              },
              React.createElement('p', { 'data-testid': 'bootstrap-copy' }, 'Preparing WebChat'),
              React.createElement(
                'button',
                {
                  type: 'button',
                  'data-testid': 'bootstrap-refresh',
                  disabled: phase === 'connecting',
                  'data-rotating': String(phase === 'connecting'),
                  onClick: onRetry
                },
                'Refresh'
              )
            )
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'application-launcher',
            onClick: () => setOpen((current) => !current)
          },
          open ? 'Close WebChat' : 'Open WebChat'
        )
      )
    }
  }
})

const appStatus = vi.hoisted(() => ({ load: 'pending' as 'pending' | 'rejected' | 'finished' }))
const remesh = vi.hoisted(() => {
  const query = new Proxy<Record<string, () => string>>({}, { get: (_, name) => () => String(name) })
  const command = new Proxy<Record<string, (...args: unknown[]) => { name: string; args: unknown[] }>>(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) => ({ name: String(name), args })
    }
  )
  return { domain: { query, command }, send: vi.fn() }
})

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => remesh.domain,
  useRemeshQuery: (query: string) => (query === 'StatusLoadIsFinishedQuery' ? appStatus.load === 'finished' : false),
  useRemeshSend: () => remesh.send
}))
vi.mock('@webcomponents/custom-elements', () => ({}))
vi.mock('@/app/content/views/header', async () => {
  const React = await import('react')
  return { default: () => React.createElement('div', { 'data-testid': 'dependent-content' }) }
})
vi.mock('@/app/content/views/footer', () => ({ default: () => null }))
vi.mock('@/app/content/views/main', () => ({ default: () => null }))
vi.mock('@/app/content/views/setup', () => ({ default: () => null }))
vi.mock('@/app/content/views/app-main', async () => {
  const React = await import('react')
  return {
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('section', { 'data-testid': 'application-frame', 'data-open': 'false' }, children)
  }
})
vi.mock('@/app/content/views/app-button', async () => {
  const React = await import('react')
  return { default: () => React.createElement('button', { type: 'button', 'data-testid': 'application-launcher' }) }
})
vi.mock('@/app/content/components/danmaku-container', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => React.createElement('div', { 'data-testid': 'danmaku-container' })) }
})
vi.mock('@/app/content/components/toast-presentation', () => ({ useToastPresentation: () => null }))
vi.mock('sonner', () => ({ Toaster: () => null }))

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://bootstrap.test/'), configurable: true })
Object.defineProperty(document, 'location', { value: window.location, configurable: true })
window.matchMedia = () =>
  ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }) as unknown as MediaQueryList
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
const { default: ContentBootstrap } = await import('@/app/content/Bootstrap')
const { default: App } = await import('@/app/content/App')

const settle = (milliseconds = 0) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const waitFor = async (predicate: () => boolean, timeout = 2000) => {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) await act(async () => settle(10))
  expect(predicate()).toBe(true)
}

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createFixture = () => {
  const dependencies: BootstrapDependencies = {
    prepareBrowserSyncStorage: vi.fn(async () => {}),
    prepareLocalStorage: vi.fn(async () => {}),
    prepareMessageDatabase: vi.fn(async () => {}),
    initializeRuntime: vi.fn(async () => ({})),
    detachRuntime: vi.fn()
  }
  const createApplication = vi.fn(() => React.createElement('div', { 'data-testid': 'application' }, 'ready'))
  return { dependencies, createApplication }
}

const renderBootstrap = async (fixture: ReturnType<typeof createFixture>, timeoutMs = 1000) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(ContentBootstrap, {
        dependencies: fixture.dependencies,
        createApplication: fixture.createApplication,
        timeoutMs
      })
    )
  })
  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

const phase = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="bootstrap-shell"]')?.dataset.phase

const retry = async (container: HTMLElement) => {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-refresh"]')
  if (!button) throw new Error('Bootstrap Retry is unavailable')
  await act(async () => button.dispatchEvent(new window.Event('click', { bubbles: true })))
}

const bootstrapError = {
  id: 'webchat-bootstrap',
  type: 'error',
  message: 'WebChat unavailable'
}

const expectBootstrapErrorPublished = () => {
  expect(remesh.send).toHaveBeenCalledWith({ name: 'PublishCommand', args: [bootstrapError] })
}

beforeEach(() => {
  remesh.send.mockClear()
  appStatus.load = 'pending'
})

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('ContentBootstrap generation ownership', () => {
  const preparationOrder = ['prepareBrowserSyncStorage', 'prepareLocalStorage', 'prepareMessageDatabase'] as const

  it.each(preparationOrder)('keeps downstream work gated while %s is unready or failed', async (dependency) => {
    const fixture = createFixture()
    const preparation = deferred<void>()
    vi.mocked(fixture.dependencies[dependency]).mockReturnValueOnce(preparation.promise)
    const rendered = await renderBootstrap(fixture)
    const failingIndex = preparationOrder.indexOf(dependency)

    try {
      await waitFor(() => vi.mocked(fixture.dependencies[dependency]).mock.calls.length === 1)
      expect(phase(rendered.container)).toBe('connecting')
      preparationOrder.forEach((name, index) => {
        if (index <= failingIndex) expect(fixture.dependencies[name]).toHaveBeenCalledOnce()
        else expect(fixture.dependencies[name]).not.toHaveBeenCalled()
      })
      expect(fixture.dependencies.initializeRuntime).not.toHaveBeenCalled()
      expect(fixture.createApplication).not.toHaveBeenCalled()

      preparation.reject(new Error('storage unavailable'))
      await waitFor(() => phase(rendered.container) === 'unavailable')

      preparationOrder.slice(failingIndex + 1).forEach((name) => {
        expect(fixture.dependencies[name]).not.toHaveBeenCalled()
      })
      expect(fixture.dependencies.initializeRuntime).not.toHaveBeenCalled()
      expect(fixture.createApplication).not.toHaveBeenCalled()
      expectBootstrapErrorPublished()
    } finally {
      preparation.reject(new Error('test cleanup'))
      await rendered.cleanup()
    }
  })

  it('recovers in the same root and fences a late timed-out storage generation', async () => {
    const fixture = createFixture()
    const stale = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stale.promise).mockResolvedValueOnce()
    const rendered = await renderBootstrap(fixture, 25)

    try {
      await waitFor(() => phase(rendered.container) === 'unavailable')
      await retry(rendered.container)
      await waitFor(() => rendered.container.querySelector('[data-testid="application"]') !== null)

      expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)
      expect(fixture.dependencies.prepareLocalStorage).toHaveBeenCalledOnce()
      expect(fixture.dependencies.prepareMessageDatabase).toHaveBeenCalledOnce()
      expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledOnce()
      expect(fixture.createApplication).toHaveBeenCalledOnce()
      expectBootstrapErrorPublished()

      stale.resolve()
      await act(async () => settle())

      expect(fixture.createApplication).toHaveBeenCalledOnce()
      expect(rendered.container.querySelector('[data-testid="application"]')).not.toBeNull()
    } finally {
      stale.resolve()
      await rendered.cleanup()
    }
  })

  it('detaches a failed Runtime generation before Retry initializes exactly once', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.dependencies.initializeRuntime)
      .mockRejectedValueOnce(new Error('Runtime control-plane request timed out'))
      .mockResolvedValueOnce({})
    const rendered = await renderBootstrap(fixture)

    try {
      await waitFor(() => phase(rendered.container) === 'unavailable')
      expect(fixture.createApplication).not.toHaveBeenCalled()

      await retry(rendered.container)
      await waitFor(() => rendered.container.querySelector('[data-testid="application"]') !== null)

      expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()
      expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledTimes(2)
      expect(fixture.createApplication).toHaveBeenCalledOnce()
      expectBootstrapErrorPublished()
      expect(remesh.send).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'DismissCommand' }))
    } finally {
      await rendered.cleanup()
    }
  })

  it('settles every repeated failure back to retryable unavailable', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mockRejectedValue(new Error('still unavailable'))
    const rendered = await renderBootstrap(fixture)

    try {
      await waitFor(() => phase(rendered.container) === 'unavailable')
      await retry(rendered.container)
      await waitFor(
        () =>
          phase(rendered.container) === 'unavailable' &&
          vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mock.calls.length === 2
      )

      expect(fixture.createApplication).not.toHaveBeenCalled()
      expect(rendered.container.querySelector('[data-testid="bootstrap-shell"]')).not.toBeNull()
      expect(remesh.send.mock.calls.filter(([action]) => action.name === 'PublishCommand')).toHaveLength(2)
    } finally {
      await rendered.cleanup()
    }
  })

  it('keeps initial and accepted Retry attempts single-flight through one disabled rotating control', async () => {
    const fixture = createFixture()
    const retryAttempt = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage)
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockReturnValueOnce(retryAttempt.promise)
    const rendered = await renderBootstrap(fixture)

    try {
      await waitFor(() => phase(rendered.container) === 'unavailable')
      const refresh = rendered.container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-refresh"]')
      expect(refresh?.disabled).toBe(false)
      expect(refresh?.dataset.rotating).toBe('false')

      await act(async () => {
        refresh?.dispatchEvent(new window.Event('click', { bubbles: true }))
        refresh?.dispatchEvent(new window.Event('click', { bubbles: true }))
      })
      await waitFor(() => phase(rendered.container) === 'connecting')

      const busyRefresh = rendered.container.querySelector<HTMLButtonElement>('[data-testid="bootstrap-refresh"]')
      expect(busyRefresh?.disabled).toBe(true)
      expect(busyRefresh?.dataset.rotating).toBe('true')
      expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)
      expect(remesh.send.mock.calls.filter(([action]) => action.name === 'PublishCommand')).toHaveLength(1)
    } finally {
      retryAttempt.resolve()
      await rendered.cleanup()
    }
  })

  it.each(['pending', 'rejected'] as const)(
    'keeps the application frame and launcher after Runtime succeeds while AppStatus loading is %s',
    async (load) => {
      const fixture = createFixture()
      appStatus.load = load
      fixture.createApplication.mockImplementation(() => React.createElement(App))
      const rendered = await renderBootstrap(fixture)

      try {
        await waitFor(() => rendered.container.querySelector('[data-testid="bootstrap-shell"]') === null)

        expect(rendered.container.querySelector('[data-testid="bootstrap-shell"]')).toBeNull()
        expect(rendered.container.querySelectorAll('[data-testid="application-frame"]')).toHaveLength(1)
        expect(rendered.container.querySelectorAll('[data-testid="application-launcher"]')).toHaveLength(1)
        expect(rendered.container.querySelector('[data-testid="dependent-content"]')).toBeNull()
      } finally {
        await rendered.cleanup()
      }
    }
  )

  it('keeps the same open frame and launcher when Runtime success hydrates the application', async () => {
    const fixture = createFixture()
    const runtime = deferred<unknown | null>()
    appStatus.load = 'pending'
    vi.mocked(fixture.dependencies.initializeRuntime).mockReturnValueOnce(runtime.promise)
    fixture.createApplication.mockImplementation(() => React.createElement(App))
    const rendered = await renderBootstrap(fixture)

    try {
      await waitFor(() => phase(rendered.container) === 'connecting')
      const frame = rendered.container.querySelector<HTMLElement>('[data-testid="application-frame"]')
      const launcher = rendered.container.querySelector<HTMLButtonElement>('[data-testid="application-launcher"]')
      if (!launcher) throw new Error('Application launcher is unavailable')

      await act(async () => launcher.dispatchEvent(new window.Event('click', { bubbles: true })))
      expect(frame?.dataset.open).toBe('true')

      runtime.resolve({})
      await waitFor(() => rendered.container.querySelector('[data-testid="bootstrap-shell"]') === null)

      expect(rendered.container.querySelector('[data-testid="application-frame"]')).toBe(frame)
      expect(rendered.container.querySelector('[data-testid="application-launcher"]')).toBe(launcher)
      expect(frame?.dataset.open).toBe('true')
      expect(fixture.createApplication).toHaveBeenCalledOnce()
    } finally {
      runtime.resolve({})
      await rendered.cleanup()
    }
  })
})
