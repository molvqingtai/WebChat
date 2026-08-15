import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope, useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import AppStatusDomain, { type AppButtonAuthorStatus, type AppStatus } from '@/domain/AppStatus'
import { startInitializationLifecycle, type InitializationDependencies } from '@/app/content/Initialization'
import {
  APP_MESSAGE_AUTHOR_STORAGE_KEY,
  APP_OPEN_STORAGE_KEY,
  APP_POSITION_STORAGE_KEY,
  APP_UNREAD_STORAGE_KEY
} from '@/constants/storage'
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

const EMPTY_MESSAGE_AUTHOR: AppButtonAuthorStatus = {
  revision: 0,
  messageId: null,
  author: null,
  deadline: null
}

const createStorage = (read: Promise<AppStatus | null>) => {
  const get = vi.fn(async (key: string) => {
    const status = await read
    if (!status) return null
    if (key === APP_OPEN_STORAGE_KEY) return status.open
    if (key === APP_POSITION_STORAGE_KEY) return status.position
    if (key === APP_UNREAD_STORAGE_KEY) return status.unread
    if (key === APP_MESSAGE_AUTHOR_STORAGE_KEY) return status.messageAuthor
    return null
  })
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
  const open = useRemeshQuery(status.query.OpenQuery())
  const loaded = useRemeshQuery(status.query.StatusLoadIsFinishedQuery())
  const phase = useRemeshQuery(status.query.PhaseQuery())

  return (
    <section data-testid="shell" data-phase={phase} data-open={String(open)} data-loaded={String(loaded)}>
      <button type="button" data-testid="launcher" onClick={() => send(status.command.UpdateOpenCommand(!open))}>
        {open ? 'Close WebChat' : 'Open WebChat'}
      </button>
      <button
        type="button"
        data-testid="initialization-refresh"
        disabled={phase !== 'unavailable'}
        onClick={() => send(status.command.RetryCommand())}
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
      <RemeshScope domains={[AppStatusDomain()]}>
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
  const activeToDispose = active.splice(0)
  activeToDispose.forEach(({ stop, store }) => {
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

    statusRead.resolve({
      open: true,
      unread: false,
      position: { x: 72, y: 31 },
      messageAuthor: EMPTY_MESSAGE_AUTHOR
    })
    await vi.waitFor(() => expect(shell().dataset.loaded).toBe('true'))
    expect(shell().dataset.open).toBe('true')
    expect(rendered.activateApplicationDependencies).not.toHaveBeenCalled()

    stageWork.reject(new Error(`${stage} unavailable`))
    await vi.waitFor(() => expect(shell().dataset.phase).toBe('unavailable'))
    expect(shell().dataset.open).toBe('true')
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('keeps a newer pre-hydration interaction through an opposite stored snapshot and failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statusRead = deferred<AppStatus | null>()
    const stageWork = deferred<never>()
    const storage = createStorage(statusRead.promise)
    const dependencies = createDependencies()
    vi.mocked(dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stageWork.promise)
    renderStatus(storage.storage, dependencies)

    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledTimes(4))
    fireEvent.click(screen.getByTestId('launcher'))
    expect(shell().dataset.open).toBe('true')

    statusRead.resolve({
      open: false,
      unread: true,
      position: { x: 61, y: 28 },
      messageAuthor: EMPTY_MESSAGE_AUTHOR
    })
    await vi.waitFor(() => expect(shell().dataset.loaded).toBe('true'))
    expect(shell().dataset.open).toBe('true')

    stageWork.reject(new Error('initialization unavailable'))
    await vi.waitFor(() => expect(shell().dataset.phase).toBe('unavailable'))
    expect(shell().dataset.open).toBe('true')
  })

  it('reuses one status read and watcher across failure, Retry, and ready activation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = createStorage(
      Promise.resolve({
        open: true,
        unread: false,
        position: { x: 70, y: 30 },
        messageAuthor: EMPTY_MESSAGE_AUTHOR
      })
    )
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
    expect(storage.get).toHaveBeenCalledTimes(4)
    expect(storage.watch).toHaveBeenCalledTimes(4)
    expect(rendered.activateApplicationDependencies).toHaveBeenCalledOnce()
  })
})
