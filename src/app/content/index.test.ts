import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RemeshExports from 'remesh'

interface ShadowRootOptions {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the mounted owner is opaque to the fixture
  onMount: (container: HTMLElement) => unknown
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the mounted owner is opaque to the fixture
  onRemove: (owner: unknown) => void
}

interface RemoveHandle {
  current: (() => void) | null
}

interface InitializationOptions {
  dependencies: { initializeRuntime: () => Promise<boolean | null>; detachRuntime: () => void }
}

const fixture = vi.hoisted(() => {
  const initialization: InitializationOptions[] = []
  const remove: RemoveHandle = { current: null }
  return {
    runtime: {
      chatRoom: {},
      worldRoom: {},
      readiness: {},
      start: vi.fn(async () => true),
      stop: vi.fn(),
      onHistoryFeedback: vi.fn()
    },
    createRuntimePorts: vi.fn(),
    storeSend: vi.fn(),
    discard: vi.fn(),
    stopInitialization: vi.fn(),
    initialization,
    createIndexedDBMessageDatabase: vi.fn(() => ({})),
    remove
  }
})

const command = (name: string) => (payload?: string | { id: string; message: string }) => ({ name, payload })

vi.mock('#imports', () => ({
  defineContentScript: <Definition>(definition: Definition) => definition,
  createShadowRootUi: async (_context: Record<never, never>, options: ShadowRootOptions) => {
    const shadowHost = document.createElement('web-chat')
    return {
      shadowHost,
      mount: () => {
        const owner = options.onMount(document.createElement('div'))
        fixture.remove.current = () => options.onRemove(owner)
      }
    }
  }
}))
vi.mock('remesh', async (importOriginal) => {
  const actual = await importOriginal<typeof RemeshExports>()
  return {
    ...actual,
    Remesh: {
      ...actual.Remesh,
      store: () => ({
        send: fixture.storeSend,
        discard: fixture.discard,
        getDomain: () => ({
          command: {
            SilenceFeedbackCommand: command('silence'),
            ResumeFeedbackCommand: command('resume'),
            LoadingCommand: command('loading'),
            CancelCommand: command('cancel'),
            ErrorCommand: command('error')
          }
        })
      })
    }
  }
})
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn(), unmount: vi.fn() }) }))
vi.mock('@/app/content/App', () => ({ default: () => null }))
vi.mock('@/app/content/Initialization', () => ({
  startInitializationLifecycle: (options: InitializationOptions) => {
    fixture.initialization.push(options)
    return fixture.stopInitialization
  }
}))
vi.mock('@/domain/impls/Storage', () => ({
  LocalStorageImpl: {},
  BrowserSyncStorageImpl: { value: {} },
  prepareLocalConfigurationStorage: vi.fn()
}))
vi.mock('@/domain/impls/database/IndexedDB', () => ({
  createIndexedDBMessageDatabase: fixture.createIndexedDBMessageDatabase,
  prepareIndexedDBMessageDatabase: vi.fn()
}))
vi.mock('@/domain/impls/ChatRoom', () => ({ createRuntimePorts: fixture.createRuntimePorts }))
vi.mock('@/runtime/locator', () => ({ createHostLocator: () => ({}) }))
vi.mock('@/domain/impls/Danmaku', () => ({ DanmakuImpl: {} }))
vi.mock('@/domain/impls/Notification', () => ({ NotificationImpl: {} }))
vi.mock('@/domain/impls/Toast', () => ({ ToastImpl: {} }))
vi.mock('@/domain/impls/AppAction', () => ({ AppActionImpl: {} }))
vi.mock('@/domain/Notification', () => ({ default: () => ({}) }))
vi.mock('@/domain/AppFeedback', () => ({ default: () => ({}) }))
vi.mock('@/domain/Toast', () => ({ default: () => ({}) }))
vi.mock('@/service/StoragePreparation', () => ({ requestBrowserSyncStoragePreparation: vi.fn() }))

vi.stubGlobal('__NAME__', 'web-chat')
const { default: content } = await import('@/app/content')

const sent = () => fixture.storeSend.mock.calls.map(([action]) => action.name)
const pageTransition = (type: string, persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event(type), { persisted }))

beforeEach(async () => {
  vi.clearAllMocks()
  fixture.initialization.length = 0
  fixture.createRuntimePorts.mockReturnValue(fixture.runtime)
  // SAFETY: the content script context is unused by the mocked shadow root UI.
  await content.main({} as never)
})

afterEach(() => fixture.remove.current?.())

describe('content composition root', () => {
  it('creates one Runtime connection and hands its start and stop to initialization', async () => {
    expect(fixture.createRuntimePorts).toHaveBeenCalledOnce()
    expect(fixture.initialization).toHaveLength(1)
    const { dependencies } = fixture.initialization[0]!
    // Storage is only opened once initialization has prepared it.
    expect(fixture.createIndexedDBMessageDatabase).not.toHaveBeenCalled()
    await dependencies.initializeRuntime()
    expect(fixture.createIndexedDBMessageDatabase).toHaveBeenCalledOnce()
    expect(fixture.runtime.start).toHaveBeenCalledOnce()
    dependencies.detachRuntime()
    expect(fixture.runtime.stop).toHaveBeenCalledOnce()
  })

  it('silences feedback and closes the connection when the page is hidden', () => {
    window.dispatchEvent(new Event('beforeunload'))
    expect(sent()).toEqual(['silence'])
    expect(fixture.runtime.stop).not.toHaveBeenCalled()
    pageTransition('pagehide', false)
    expect(fixture.runtime.stop).toHaveBeenCalledOnce()
  })

  it('reconnects and resumes feedback when the page returns from the back-forward cache', async () => {
    pageTransition('pagehide', true)
    pageTransition('pageshow', false)
    expect(fixture.runtime.start).not.toHaveBeenCalled()
    pageTransition('pageshow', true)
    expect(fixture.runtime.start).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(sent()).toEqual(['silence', 'resume']))
  })

  it('maps history loading to one toast and its dismissal', () => {
    const listener = fixture.runtime.onHistoryFeedback.mock.calls[0]![0]
    listener({ ownerId: 'sync-1', type: 'loading' })
    listener({ ownerId: 'sync-1', type: 'dismiss' })
    expect(fixture.storeSend.mock.calls.map(([action]) => action)).toEqual([
      { name: 'loading', payload: { id: 'sync-1', message: 'Syncing message history...' } },
      { name: 'cancel', payload: 'sync-1' }
    ])
  })

  it('releases everything when the UI is removed', () => {
    fixture.remove.current!()
    fixture.remove.current = null
    expect(fixture.stopInitialization).toHaveBeenCalledOnce()
    expect(fixture.discard).toHaveBeenCalledOnce()
    pageTransition('pagehide', false)
    expect(fixture.runtime.stop).not.toHaveBeenCalled()
  })
})
