import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const fixture = vi.hoisted(() => ({
  createShadowRootUi: vi.fn(),
  mount: vi.fn(),
  requestBrowserSyncStoragePreparation: vi.fn<() => Promise<void>>(),
  prepareLocalConfigurationStorage: vi.fn<() => Promise<void>>(),
  prepareIndexedDBMessageDatabase: vi.fn<() => Promise<void>>(),
  initClient: vi.fn<() => Promise<object | null>>(),
  detachClient: vi.fn(),
  createStore: vi.fn()
}))

vi.mock('#imports', () => ({
  defineContentScript: <Definition>(definition: Definition) => definition,
  createShadowRootUi: fixture.createShadowRootUi
}))
vi.mock('remesh', () => ({ Remesh: { store: fixture.createStore } }))
vi.mock('remesh-react', () => ({ RemeshRoot: 'remesh-root', RemeshScope: 'remesh-scope' }))
vi.mock('react-dom/client', () => ({ createRoot: vi.fn() }))
vi.mock('@/app/content/App', () => ({ default: () => null }))
vi.mock('@/app/content/Bootstrap', () => ({ default: () => null }))
vi.mock('@/domain/impls/Storage', () => ({
  LocalStorageImpl: {},
  BrowserSyncStorageImpl: {},
  prepareLocalConfigurationStorage: fixture.prepareLocalConfigurationStorage
}))
vi.mock('@/domain/impls/database/IndexedDB', () => ({
  MessageDatabaseImpl: { value: {} },
  prepareIndexedDBMessageDatabase: fixture.prepareIndexedDBMessageDatabase
}))
vi.mock('@/domain/impls/runtime/Client', () => ({
  detachClient: fixture.detachClient,
  initClient: fixture.initClient,
  whenHostPhase: vi.fn()
}))
vi.mock('@/domain/impls/Danmaku', () => ({ DanmakuImpl: {} }))
vi.mock('@/domain/impls/Notification', () => ({ NotificationImpl: {} }))
vi.mock('@/domain/impls/Toast', () => ({ ToastImpl: {} }))
vi.mock('@/domain/impls/ChatRoom', () => ({ createChatRoomImpl: vi.fn(() => ({})) }))
vi.mock('@/domain/impls/WorldRoom', () => ({ createWorldRoomImpl: vi.fn(() => ({})) }))
vi.mock('@/domain/impls/Readiness', () => ({ createReadinessImpl: vi.fn(() => ({})) }))
vi.mock('@/domain/impls/AppAction', () => ({ AppActionImpl: {} }))
vi.mock('@/domain/Notification', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/Toast', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/ToastPresentation', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/domain/AppFeedback', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/utils', () => ({ createElement: vi.fn() }))
vi.mock('@/service/StoragePreparation', () => ({
  requestBrowserSyncStoragePreparation: fixture.requestBrowserSyncStoragePreparation
}))

import content from '@/app/content'

const startContent = () => {
  if (typeof content.main !== 'function') throw new Error('Content main is unavailable')
  return content.main({} as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { addEventListener: vi.fn() })
  vi.stubGlobal('__NAME__', 'WEB-CHAT')
  fixture.createShadowRootUi.mockResolvedValue({ mount: fixture.mount })
  fixture.requestBrowserSyncStoragePreparation.mockResolvedValue()
  fixture.prepareLocalConfigurationStorage.mockResolvedValue()
  fixture.prepareIndexedDBMessageDatabase.mockResolvedValue()
  fixture.initClient.mockResolvedValue({})
})

afterEach(() => vi.unstubAllGlobals())

describe('content bootstrap shell continuity', () => {
  it('mounts one shell before storage preparation can settle', async () => {
    const preparation = deferred<void>()
    fixture.requestBrowserSyncStoragePreparation.mockReturnValueOnce(preparation.promise)
    const started = startContent()

    try {
      await vi.waitFor(() => expect(fixture.mount).toHaveBeenCalledOnce())
      expect(fixture.createShadowRootUi).toHaveBeenCalledOnce()

      preparation.resolve()
      await started

      expect(fixture.createShadowRootUi).toHaveBeenCalledOnce()
      expect(fixture.mount).toHaveBeenCalledOnce()
      expect(fixture.createStore).not.toHaveBeenCalled()
      expect(fixture.initClient).not.toHaveBeenCalled()
    } finally {
      preparation.resolve()
      await Promise.allSettled([started])
    }
  })

  it('keeps the mounted shell when initial Runtime registration fails', async () => {
    fixture.initClient.mockRejectedValueOnce(new Error('Runtime control-plane request timed out'))

    await startContent()

    expect(fixture.createShadowRootUi).toHaveBeenCalledOnce()
    expect(fixture.mount).toHaveBeenCalledOnce()
    expect(fixture.createStore).not.toHaveBeenCalled()
  })

  it('mounts one fresh shell for each content document generation', async () => {
    await startContent()
    await startContent()

    expect(fixture.createShadowRootUi).toHaveBeenCalledTimes(2)
    expect(fixture.mount).toHaveBeenCalledTimes(2)
    expect(fixture.createStore).not.toHaveBeenCalled()
  })
})
