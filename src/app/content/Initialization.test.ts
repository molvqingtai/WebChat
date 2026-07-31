import { createRequire } from 'node:module'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { InitializationDependencies } from '@/app/content/Initialization'

const remesh = vi.hoisted(() => {
  const command = new Proxy<Record<string, (...args: unknown[]) => { name: string; args: unknown[] }>>(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) => ({ name: String(name), args })
    }
  )
  return { domain: { command }, send: vi.fn() }
})

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => remesh.domain,
  useRemeshSend: () => remesh.send
}))

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://initialization.test/'), configurable: true })
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
const { useInitialization } = await import('@/app/content/Initialization')

const roots: Root[] = []
const containers: HTMLElement[] = []

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
  const dependencies: InitializationDependencies = {
    prepareBrowserSyncStorage: vi.fn(async () => {}),
    prepareLocalStorage: vi.fn(async () => {}),
    prepareMessageDatabase: vi.fn(async () => {}),
    initializeRuntime: vi.fn(async () => ({})),
    detachRuntime: vi.fn()
  }
  return { dependencies, activateApplicationDependencies: vi.fn() }
}

const Harness = ({
  dependencies,
  activateApplicationDependencies,
  timeoutMs
}: ReturnType<typeof createFixture> & { timeoutMs: number }) => {
  const { phase, retry } = useInitialization({ dependencies, activateApplicationDependencies, timeoutMs })
  return React.createElement(
    'section',
    { 'data-testid': 'state', 'data-phase': phase },
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'retry',
        disabled: phase !== 'unavailable',
        'data-rotating': String(phase === 'connecting'),
        onClick: retry
      },
      'Retry'
    ),
    phase === 'ready' && React.createElement('div', { 'data-testid': 'ready' })
  )
}

const renderInitialization = async (fixture: ReturnType<typeof createFixture>, timeoutMs = 1000) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  await act(async () => root.render(React.createElement(Harness, { ...fixture, timeoutMs })))
  return container
}

const phase = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="state"]')?.dataset.phase

const clickRetry = async (container: HTMLElement, times = 1) => {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="retry"]')
  if (!button) throw new Error('Initialization Retry is unavailable')
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      button.dispatchEvent(new window.Event('click', { bubbles: true }))
    }
  })
}

const loadingDescriptor = {
  id: 'webchat-initialization',
  type: 'loading',
  message: 'Preparing WebChat',
  dismissible: false
}
const errorDescriptor = {
  id: 'webchat-initialization',
  type: 'error',
  message: 'WebChat unavailable'
}

beforeEach(() => {
  remesh.send.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  containers.splice(0).forEach((container) => container.remove())
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('initialization lifecycle ownership', () => {
  const stages = [
    'prepareBrowserSyncStorage',
    'prepareLocalStorage',
    'prepareMessageDatabase',
    'initializeRuntime'
  ] as const

  it.each(stages)('gates downstream work and publishes matching generic feedback when %s fails', async (stage) => {
    const fixture = createFixture()
    const work = deferred<never>()
    vi.mocked(fixture.dependencies[stage]).mockReturnValueOnce(work.promise)
    const container = await renderInitialization(fixture)
    const stageIndex = stages.indexOf(stage)

    try {
      await vi.waitFor(() => expect(fixture.dependencies[stage]).toHaveBeenCalledOnce())
      expect(phase(container)).toBe('connecting')
      stages.forEach((name, index) => {
        if (index <= stageIndex) expect(fixture.dependencies[name]).toHaveBeenCalledOnce()
        else expect(fixture.dependencies[name]).not.toHaveBeenCalled()
      })
      expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
      expect(remesh.send).toHaveBeenCalledWith({ name: 'PublishCommand', args: [loadingDescriptor] })

      work.reject(new Error(`${stage} unavailable`))
      await vi.waitFor(() => expect(phase(container)).toBe('unavailable'))

      expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
      expect(remesh.send).toHaveBeenCalledWith({ name: 'PublishCommand', args: [errorDescriptor] })
      expect(remesh.send).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'DismissCommand' }))
    } finally {
      work.reject(new Error('test cleanup'))
    }
  })

  it('activates dependencies once after all ordered stages and dismisses only matching loading', async () => {
    const fixture = createFixture()
    const container = await renderInitialization(fixture)

    await vi.waitFor(() => expect(phase(container)).toBe('ready'))

    expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()
    expect(vi.mocked(fixture.dependencies.prepareBrowserSyncStorage)).toHaveBeenCalledBefore(
      vi.mocked(fixture.dependencies.prepareLocalStorage)
    )
    expect(vi.mocked(fixture.dependencies.prepareLocalStorage)).toHaveBeenCalledBefore(
      vi.mocked(fixture.dependencies.prepareMessageDatabase)
    )
    expect(vi.mocked(fixture.dependencies.prepareMessageDatabase)).toHaveBeenCalledBefore(
      vi.mocked(fixture.dependencies.initializeRuntime)
    )
    expect(remesh.send).toHaveBeenCalledWith({ name: 'DismissCommand', args: ['webchat-initialization'] })
    expect(remesh.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ args: [expect.objectContaining({ type: 'success' })] })
    )
  })

  it('recovers in the same hook generation owner and fences late timed-out preparation', async () => {
    const fixture = createFixture()
    const stale = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stale.promise).mockResolvedValueOnce()
    const container = await renderInitialization(fixture, 25)

    try {
      await vi.waitFor(() => expect(phase(container)).toBe('unavailable'))
      await clickRetry(container)
      await vi.waitFor(() => expect(phase(container)).toBe('ready'))

      expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)
      expect(fixture.dependencies.prepareLocalStorage).toHaveBeenCalledOnce()
      expect(fixture.dependencies.prepareMessageDatabase).toHaveBeenCalledOnce()
      expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledOnce()
      expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()

      stale.resolve()
      await act(async () => Promise.resolve())
      expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()
      expect(phase(container)).toBe('ready')
    } finally {
      stale.resolve()
    }
  })

  it('detaches a failed Runtime generation before Retry initializes exactly once', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.dependencies.initializeRuntime)
      .mockRejectedValueOnce(new Error('Runtime unavailable'))
      .mockResolvedValueOnce({})
    const container = await renderInitialization(fixture)

    await vi.waitFor(() => expect(phase(container)).toBe('unavailable'))
    expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()

    await clickRetry(container)
    await vi.waitFor(() => expect(phase(container)).toBe('ready'))

    expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledTimes(2)
    expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()
    expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()
  })

  it('keeps accepted Retry single-flight through one disabled rotating projection', async () => {
    const fixture = createFixture()
    const retryWork = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage)
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockReturnValueOnce(retryWork.promise)
    const container = await renderInitialization(fixture)

    try {
      await vi.waitFor(() => expect(phase(container)).toBe('unavailable'))
      await clickRetry(container, 2)
      await vi.waitFor(() => expect(phase(container)).toBe('connecting'))

      const button = container.querySelector<HTMLButtonElement>('[data-testid="retry"]')
      expect(button?.disabled).toBe(true)
      expect(button?.dataset.rotating).toBe('true')
      expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)
    } finally {
      retryWork.resolve()
    }
  })

  it('silently fences unmounted Runtime settlement and detaches the started generation', async () => {
    const fixture = createFixture()
    const runtime = deferred<unknown | null>()
    vi.mocked(fixture.dependencies.initializeRuntime).mockReturnValueOnce(runtime.promise)
    const container = await renderInitialization(fixture)

    await vi.waitFor(() => expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledOnce())
    const root = roots.pop()
    if (!root) throw new Error('Initialization root is unavailable')
    await act(async () => root.unmount())
    runtime.resolve({})
    await act(async () => Promise.resolve())

    expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
    expect(remesh.send).not.toHaveBeenCalledWith({ name: 'DismissCommand', args: ['webchat-initialization'] })
    expect(container.querySelector('[data-testid="state"]')).toBeNull()
  })
})
