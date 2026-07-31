import { createRequire } from 'node:module'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type * as RemeshExports from 'remesh'

interface ShadowRootOptions {
  onMount: (container: HTMLElement) => Root | undefined
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

const fixture = vi.hoisted(() => {
  const database = {
    read: vi.fn(),
    write: vi.fn(),
    watch: vi.fn(),
    close: vi.fn()
  }
  return {
    database,
    createShadowRootUi: vi.fn(),
    mount: vi.fn(),
    requestBrowserSyncStoragePreparation: vi.fn<() => Promise<void>>(),
    prepareLocalConfigurationStorage: vi.fn<() => Promise<void>>(),
    prepareIndexedDBMessageDatabase: vi.fn<() => Promise<void>>(),
    createIndexedDBMessageDatabase: vi.fn(() => database),
    initClient: vi.fn<() => Promise<object | null>>(),
    detachClient: vi.fn(),
    whenReady: vi.fn(() => vi.fn()),
    whenHostPhase: vi.fn(() => vi.fn()),
    createChatRoomImpl: vi.fn(),
    createWorldRoomImpl: vi.fn(),
    createReadinessImpl: vi.fn(),
    createStore: vi.fn(() => ({})),
    createElement: vi.fn()
  }
})

vi.mock('#imports', () => ({
  defineContentScript: <Definition>(definition: Definition) => definition,
  createShadowRootUi: fixture.createShadowRootUi
}))
vi.mock('remesh', async (importOriginal) => {
  const actual = await importOriginal<typeof RemeshExports>()
  return { ...actual, Remesh: { ...actual.Remesh, store: fixture.createStore } }
})
vi.mock('remesh-react', async () => {
  const React = await import('react')
  const PassThrough = ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children)
  return { RemeshRoot: PassThrough, RemeshScope: PassThrough }
})
vi.mock('@/app/content/App', async () => {
  const React = await import('react')
  return { default: () => React.createElement('div', { 'data-testid': 'application' }, 'ready') }
})
vi.mock('@/app/content/BootstrapShell', async () => {
  const React = await import('react')
  return {
    default: ({ phase, onRetry, application }: { phase: string; onRetry: () => void; application?: ReactNode }) =>
      React.createElement(
        'section',
        { 'data-testid': 'bootstrap-shell', 'data-phase': phase },
        React.createElement('button', { type: 'button', 'data-testid': 'retry', onClick: onRetry }, 'Retry'),
        application
      )
  }
})
vi.mock('@/domain/impls/Storage', () => ({
  LocalStorageImpl: {},
  BrowserSyncStorageImpl: {},
  prepareLocalConfigurationStorage: fixture.prepareLocalConfigurationStorage
}))
vi.mock('@/domain/impls/database/IndexedDB', () => ({
  MessageDatabaseImpl: { value: fixture.database },
  createIndexedDBMessageDatabase: fixture.createIndexedDBMessageDatabase,
  prepareIndexedDBMessageDatabase: fixture.prepareIndexedDBMessageDatabase
}))
vi.mock('@/domain/impls/runtime/Client', () => ({
  detachClient: fixture.detachClient,
  getSnapshot: vi.fn(() => ({ hostId: 'host', hostPhase: 'ready' })),
  initClient: fixture.initClient,
  pageDomain: 'https://content.test',
  pageId: 'page',
  server: {},
  whenHostPhase: fixture.whenHostPhase,
  whenReady: fixture.whenReady
}))
vi.mock('@/domain/impls/ChatRoom', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    createChatRoomImpl: (database: typeof fixture.database) => { value: unknown }
  }
  fixture.createChatRoomImpl.mockImplementation(actual.createChatRoomImpl)
  return { ...actual, createChatRoomImpl: fixture.createChatRoomImpl }
})
vi.mock('@/domain/impls/WorldRoom', async (importOriginal) => {
  const actual = (await importOriginal()) as { createWorldRoomImpl: () => { value: unknown } }
  fixture.createWorldRoomImpl.mockImplementation(actual.createWorldRoomImpl)
  return { ...actual, createWorldRoomImpl: fixture.createWorldRoomImpl }
})
vi.mock('@/domain/impls/Readiness', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    createReadinessImpl: (onHostPhase: typeof fixture.whenHostPhase) => { value: unknown }
  }
  fixture.createReadinessImpl.mockImplementation(actual.createReadinessImpl)
  return { ...actual, createReadinessImpl: fixture.createReadinessImpl }
})
vi.mock('@/domain/impls/Danmaku', () => ({ DanmakuImpl: {} }))
vi.mock('@/domain/impls/Notification', () => ({ NotificationImpl: {} }))
vi.mock('@/domain/impls/Toast', () => ({ ToastImpl: {} }))
vi.mock('@/domain/impls/AppAction', () => ({ AppActionImpl: {} }))
vi.mock('@/domain/Notification', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/Toast', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/ToastPresentation', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/AppFeedback', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/AppStatusEffects', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/utils', () => ({ createElement: fixture.createElement }))
vi.mock('@/service/StoragePreparation', () => ({
  requestBrowserSyncStoragePreparation: fixture.requestBrowserSyncStoragePreparation
}))

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://content.test/'), configurable: true })
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
  IS_REACT_ACT_ENVIRONMENT: true,
  __NAME__: 'WEB-CHAT'
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

const React = await import('react')
const { act } = React
const { CONTENT_BOOTSTRAP_TIMEOUT_MS } = await import('@/app/content/Bootstrap')
const { default: content } = await import('@/app/content')

const roots: Root[] = []
const containers: HTMLElement[] = []

const startContent = async () => {
  if (typeof content.main !== 'function') throw new Error('Content main is unavailable')
  await act(async () => content.main({} as never))
}

const phase = () => document.querySelector<HTMLElement>('[data-testid="bootstrap-shell"]')?.dataset.phase

const flushMicrotasks = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

const expectDependenciesUnconstructed = () => {
  expect(fixture.createIndexedDBMessageDatabase).not.toHaveBeenCalled()
  expect(fixture.createChatRoomImpl).not.toHaveBeenCalled()
  expect(fixture.createWorldRoomImpl).not.toHaveBeenCalled()
  expect(fixture.createReadinessImpl).not.toHaveBeenCalled()
  expect(fixture.whenReady).not.toHaveBeenCalled()
}

const expectDependenciesConstructedOnce = () => {
  expect(fixture.createIndexedDBMessageDatabase).toHaveBeenCalledOnce()
  expect(fixture.createChatRoomImpl).toHaveBeenCalledOnce()
  expect(fixture.createWorldRoomImpl).toHaveBeenCalledOnce()
  expect(fixture.createReadinessImpl).toHaveBeenCalledOnce()
  expect(fixture.whenReady).toHaveBeenCalledTimes(2)
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.requestBrowserSyncStoragePreparation.mockResolvedValue()
  fixture.prepareLocalConfigurationStorage.mockResolvedValue()
  fixture.prepareIndexedDBMessageDatabase.mockResolvedValue()
  fixture.initClient.mockResolvedValue({})
  fixture.createElement.mockImplementation(() => {
    const element = document.createElement('div')
    element.id = 'root'
    return element
  })
  fixture.createShadowRootUi.mockImplementation(async (_context: unknown, options: ShadowRootOptions) => {
    const container = document.createElement('div')
    document.body.append(container)
    containers.push(container)
    return {
      mount: () => {
        fixture.mount()
        const root = options.onMount(container)
        if (root) roots.push(root)
      }
    }
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  containers.splice(0).forEach((container) => container.remove())
  window.removeEventListener('beforeunload', fixture.detachClient)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('content production bootstrap dependency boundary', () => {
  const prerequisites = [
    'requestBrowserSyncStoragePreparation',
    'prepareLocalConfigurationStorage',
    'prepareIndexedDBMessageDatabase',
    'initClient'
  ] as const

  it.each(prerequisites)(
    'constructs no dependent extern or Runtime listener while %s is held or failed',
    async (name) => {
      const prerequisite = deferred<void | object | null>()
      fixture[name].mockReturnValueOnce(prerequisite.promise as Promise<void> & Promise<object | null>)

      try {
        await startContent()
        await vi.waitFor(() => expect(fixture[name]).toHaveBeenCalledOnce())

        expect(fixture.createShadowRootUi).toHaveBeenCalledOnce()
        expect(fixture.mount).toHaveBeenCalledOnce()
        expect(fixture.createStore).toHaveBeenCalledOnce()
        expect(phase()).toBe('connecting')
        expectDependenciesUnconstructed()

        prerequisite.reject(new Error('prerequisite unavailable'))
        await vi.waitFor(() => expect(phase()).toBe('unavailable'))

        expectDependenciesUnconstructed()
      } finally {
        prerequisite.reject(new Error('test cleanup'))
      }
    }
  )

  it('constructs each dependency and Runtime listener exactly once after the matching attempt is ready', async () => {
    await startContent()

    await vi.waitFor(expectDependenciesConstructedOnce)
    expect(document.querySelector('[data-testid="application"]')).not.toBeNull()
    expect(fixture.createStore).toHaveBeenCalledOnce()
  })

  it('constructs only the successful Retry generation after a stale preparation times out and resolves late', async () => {
    vi.useFakeTimers()
    const stale = deferred<void>()
    fixture.requestBrowserSyncStoragePreparation.mockReturnValueOnce(stale.promise).mockResolvedValueOnce()

    try {
      await startContent()
      expectDependenciesUnconstructed()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTENT_BOOTSTRAP_TIMEOUT_MS)
        await flushMicrotasks()
      })
      expect(phase()).toBe('unavailable')
      expectDependenciesUnconstructed()

      const retry = document.querySelector<HTMLButtonElement>('[data-testid="retry"]')
      if (!retry) throw new Error('Retry control is unavailable')
      await act(async () => {
        retry.dispatchEvent(new window.Event('click', { bubbles: true }))
        await flushMicrotasks()
      })

      expectDependenciesConstructedOnce()
      expect(document.querySelector('[data-testid="application"]')).not.toBeNull()

      stale.resolve()
      await act(flushMicrotasks)

      expectDependenciesConstructedOnce()
    } finally {
      stale.resolve()
    }
  })

  it('mounts one fresh shell store for each content document generation', async () => {
    await startContent()
    await startContent()

    await vi.waitFor(() => expect(fixture.createStore).toHaveBeenCalledTimes(2))
    expect(fixture.createShadowRootUi).toHaveBeenCalledTimes(2)
    expect(fixture.mount).toHaveBeenCalledTimes(2)
  })
})
