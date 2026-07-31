import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope, useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import AppStatusDomain, { type AppStatus } from '@/domain/AppStatus'
import InitializationDomain, {
  startInitializationLifecycle,
  type InitializationDependencies
} from '@/app/content/Initialization'
import { APP_STATUS_STORAGE_KEY } from '@/constants/storage'
import { LocalStorageExtern, BrowserSyncStorageExtern, type Storage } from '@/domain/externs/Storage'
import { ToastExtern } from '@/domain/externs/Toast'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createStorage = (read: Promise<AppStatus | null>) => {
  const get = vi.fn(() => read)
  const set = vi.fn(async () => {})
  const watch = vi.fn(async () => async () => {})
  const storage: Storage = { get: get as Storage['get'], set: set as Storage['set'], watch }
  return { storage, get, set, watch }
}

const createDependencies = (): InitializationDependencies => ({
  prepareBrowserSyncStorage: vi.fn(async () => {}),
  prepareLocalStorage: vi.fn(async () => {}),
  prepareMessageDatabase: vi.fn(async () => {}),
  initializeRuntime: vi.fn(async () => ({})),
  detachRuntime: vi.fn()
})

const StatusHarness = () => {
  const send = useRemeshSend()
  const status = useRemeshDomain(AppStatusDomain())
  const initialization = useRemeshDomain(InitializationDomain())
  const open = useRemeshQuery(status.query.OpenQuery())
  const loaded = useRemeshQuery(status.query.StatusLoadIsFinishedQuery())
  const phase = useRemeshQuery(initialization.query.PhaseQuery())

  return (
    <section data-testid="shell" data-phase={phase} data-open={String(open)} data-loaded={String(loaded)}>
      <button type="button" data-testid="launcher" onClick={() => send(status.command.UpdateOpenCommand(!open))}>
        {open ? 'Close WebChat' : 'Open WebChat'}
      </button>
      <button
        type="button"
        data-testid="initialization-refresh"
        disabled={phase !== 'unavailable'}
        onClick={() => send(initialization.command.RetryCommand())}
      >
        Refresh
      </button>
      {phase === 'ready' && <div data-testid="application" />}
    </section>
  )
}

let databaseId = 0
const active: Array<{ stop: () => void; store: ReturnType<typeof Remesh.store> }> = []

const renderStatus = (storage: Storage, dependencies: InitializationDependencies) => {
  const browserStorage: Storage = {
    get: async () => null,
    set: async () => {},
    watch: async () => async () => {}
  }
  const store = Remesh.store({
    externs: [
      LocalStorageExtern.impl(storage),
      BrowserSyncStorageExtern.impl(browserStorage),
      ToastExtern.impl({
        success: () => 'success',
        error: () => 'error',
        info: () => 'info',
        warning: () => 'warning',
        loading: () => 'loading',
        cancel: (id) => id
      }),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`initialization-status-${databaseId++}`)),
      ChatRoomExtern.impl({
        joinRoom: async () => {},
        leaveRoom: async () => {},
        sendMessage: async () => {
          throw new Error('unused')
        },
        onMessage: () => () => {},
        onJoinRoom: () => () => {},
        onLeaveRoom: () => () => {},
        onSessions: () => () => {},
        onError: () => () => {}
      }),
      WorldRoomExtern.impl({ getState: async () => [], onState: () => () => {}, onError: () => () => {} }),
      ReadinessExtern.impl({ onState: () => () => {} })
    ]
  })
  const activateApplicationDependencies = vi.fn()
  const view = render(
    <RemeshRoot store={store}>
      <RemeshScope domains={[AppStatusDomain(), InitializationDomain()]}>
        <StatusHarness />
      </RemeshScope>
    </RemeshRoot>
  )
  const stop = startInitializationLifecycle({ store, dependencies, activateApplicationDependencies })
  active.push({ stop, store })
  return { ...view, activateApplicationDependencies }
}

const shell = () => screen.getByTestId('shell')

afterEach(() => {
  active.splice(0).forEach(({ stop, store }) => {
    stop()
    store.discard()
  })
  cleanup()
  vi.restoreAllMocks()
})

describe('shell status and initialization independence', () => {
  const stages = [
    'prepareBrowserSyncStorage',
    'prepareLocalStorage',
    'prepareMessageDatabase',
    'initializeRuntime'
  ] as const

  it.each(stages)('restores persisted expanded state while %s is pending and after it fails', async (stage) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statusRead = deferred<AppStatus | null>()
    const stageWork = deferred<never>()
    const storage = createStorage(statusRead.promise)
    const dependencies = createDependencies()
    vi.mocked(dependencies[stage]).mockReturnValueOnce(stageWork.promise)
    const rendered = renderStatus(storage.storage, dependencies)

    await vi.waitFor(() => expect(dependencies[stage]).toHaveBeenCalledOnce())
    expect(shell().dataset.phase).toBe('connecting')

    statusRead.resolve({ open: true, unread: 2, position: { x: 72, y: 31 } })
    await vi.waitFor(() => expect(shell().dataset.loaded).toBe('true'))
    expect(shell().dataset.open).toBe('true')
    expect(rendered.activateApplicationDependencies).not.toHaveBeenCalled()

    stageWork.reject(new Error(`${stage} unavailable`))
    await vi.waitFor(() => expect(shell().dataset.phase).toBe('unavailable'))
    expect(shell().dataset.open).toBe('true')
    await vi.waitFor(() =>
      expect(storage.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )
  })

  it('keeps a newer pre-hydration interaction through an opposite stored snapshot and failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statusRead = deferred<AppStatus | null>()
    const stageWork = deferred<never>()
    const storage = createStorage(statusRead.promise)
    const dependencies = createDependencies()
    vi.mocked(dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stageWork.promise)
    renderStatus(storage.storage, dependencies)

    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByTestId('launcher'))
    expect(shell().dataset.open).toBe('true')

    statusRead.resolve({ open: false, unread: 7, position: { x: 61, y: 28 } })
    await vi.waitFor(() => expect(shell().dataset.loaded).toBe('true'))
    expect(shell().dataset.open).toBe('true')

    stageWork.reject(new Error('initialization unavailable'))
    await vi.waitFor(() => expect(shell().dataset.phase).toBe('unavailable'))
    expect(shell().dataset.open).toBe('true')
  })

  it('reuses one status read and watcher across failure, Retry, and ready activation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = createStorage(Promise.resolve({ open: true, unread: 0, position: { x: 70, y: 30 } }))
    const dependencies = createDependencies()
    vi.mocked(dependencies.prepareBrowserSyncStorage)
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockResolvedValueOnce()
    const rendered = renderStatus(storage.storage, dependencies)

    await vi.waitFor(() => expect(shell().dataset.phase).toBe('unavailable'))
    await vi.waitFor(() => expect(shell().dataset.open).toBe('true'))
    const originalShell = shell()

    fireEvent.click(screen.getByTestId('initialization-refresh'))
    await screen.findByTestId('application')

    expect(shell()).toBe(originalShell)
    expect(storage.get).toHaveBeenCalledOnce()
    expect(storage.watch).toHaveBeenCalledOnce()
    expect(rendered.activateApplicationDependencies).toHaveBeenCalledOnce()
  })
})
