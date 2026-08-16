import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import { startInitializationLifecycle, type InitializationDependencies } from '@/app/content/Initialization'
import AppStatusDomain from '@/domain/AppStatus'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern } from '@/domain/externs/Storage'
import { ToastExtern, type Toast } from '@/domain/externs/Toast'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const INITIALIZATION_TOAST_ID = 'webchat-initialization'

let fixtureId = 0

const createFixture = () => {
  const toast = {
    success: vi.fn(() => 'success'),
    error: vi.fn(() => 'error'),
    info: vi.fn(() => 'info'),
    warning: vi.fn(() => 'warning'),
    loading: vi.fn(() => INITIALIZATION_TOAST_ID),
    cancel: vi.fn((id) => id)
  } satisfies Toast
  const storage = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    watch: vi.fn(async () => async () => {})
  }
  const chat = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onJoinRoom: vi.fn(() => () => {}),
    onLeaveRoom: vi.fn(() => () => {}),
    onSessions: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {})
  }
  const world = {
    getState: vi.fn(async () => []),
    onState: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {})
  }
  const store = Remesh.store({
    externs: [
      ToastExtern.impl(toast),
      LocalStorageExtern.impl(storage),
      BrowserSyncStorageExtern.impl(storage),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`initialization-${fixtureId++}`)),
      ChatRoomExtern.impl(chat),
      WorldRoomExtern.impl(world),
      ReadinessExtern.impl({ onState: () => () => {} })
    ]
  })
  const dependencies: InitializationDependencies = {
    prepareBrowserSyncStorage: vi.fn(async () => {}),
    prepareLocalStorage: vi.fn(async () => {}),
    prepareMessageDatabase: vi.fn(async () => {}),
    initializeRuntime: vi.fn(async () => ({})),
    detachRuntime: vi.fn()
  }
  const activateApplicationDependencies = vi.fn()
  const action = AppStatusDomain()
  const domain = store.getDomain(action)
  return { store, domain, dependencies, activateApplicationDependencies, toast }
}

const phase = (fixture: ReturnType<typeof createFixture>) => fixture.store.query(fixture.domain.query.PhaseQuery())

const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

const started = new Set<() => void>()

const start = (fixture: ReturnType<typeof createFixture>, timeoutMs = 1000) => {
  const stop = startInitializationLifecycle({ ...fixture, timeoutMs })
  started.add(stop)
  return () => {
    if (!started.delete(stop)) return
    stop()
    fixture.store.discard()
  }
}

afterEach(() => {
  started.forEach((stop) => stop())
  started.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('initialization lifecycle ownership', () => {
  const stages = [
    'prepareBrowserSyncStorage',
    'prepareLocalStorage',
    'prepareMessageDatabase',
    'initializeRuntime'
  ] as const

  it.each(stages)('gates downstream work and publishes normalized feedback when %s fails', async (stage) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const work = deferred<never>()
    vi.mocked(fixture.dependencies[stage]).mockReturnValueOnce(work.promise)
    const stop = start(fixture)
    const stageIndex = stages.indexOf(stage)

    await vi.waitFor(() => expect(fixture.dependencies[stage]).toHaveBeenCalledOnce())
    expect(phase(fixture)).toBe('connecting')
    stages.forEach((name, index) => {
      if (index <= stageIndex) expect(fixture.dependencies[name]).toHaveBeenCalledOnce()
      else expect(fixture.dependencies[name]).not.toHaveBeenCalled()
    })
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()

    work.reject(new Error(`${stage} unavailable`))
    await vi.waitFor(() => expect(phase(fixture)).toBe('unavailable'))

    expect(fixture.toast.loading).toHaveBeenCalledWith('Preparing WebChat', {
      id: INITIALIZATION_TOAST_ID,
      dismissible: false
    })
    if (stage === 'initializeRuntime') {
      // A runtime failure is surfaced once by the Runtime lease owner; initialization does not
      // duplicate it into a second toast.
      expect(fixture.toast.cancel).toHaveBeenCalledWith(INITIALIZATION_TOAST_ID)
      expect(fixture.toast.error).not.toHaveBeenCalled()
    } else {
      expect(fixture.toast.cancel).not.toHaveBeenCalled()
      expect(fixture.toast.error).toHaveBeenCalledWith(`${stage} unavailable`, {
        id: INITIALIZATION_TOAST_ID
      })
    }
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
    stop()
  })

  it('replaces the same initialization Toast with each original Retry failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const initialFailure = new Error('initial provider detail')
    const retryFailure = new Error('retry provider detail')
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage)
      .mockRejectedValueOnce(initialFailure)
      .mockRejectedValueOnce(retryFailure)
    const stop = start(fixture)

    await vi.waitFor(() => expect(phase(fixture)).toBe('unavailable'))
    expect(fixture.toast.error).toHaveBeenNthCalledWith(1, initialFailure.message, {
      id: INITIALIZATION_TOAST_ID
    })

    fixture.store.send(fixture.domain.command.RetryCommand())
    await vi.waitFor(() => expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(fixture.toast.error).toHaveBeenCalledTimes(2))

    expect(fixture.toast.error).toHaveBeenNthCalledWith(2, retryFailure.message, {
      id: INITIALIZATION_TOAST_ID
    })
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
    stop()
  })

  it('activates dependencies once after all ordered stages and dismisses only matching loading', async () => {
    const fixture = createFixture()
    const stop = start(fixture)

    await vi.waitFor(() => expect(phase(fixture)).toBe('ready'))

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
    expect(fixture.toast.cancel).toHaveBeenCalledWith(INITIALIZATION_TOAST_ID)
    expect(fixture.toast.success).not.toHaveBeenCalled()
    stop()
  })

  it('recovers in the same owner and fences late timed-out preparation', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const stale = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stale.promise).mockResolvedValueOnce()
    const stop = start(fixture, 25)

    await vi.advanceTimersByTimeAsync(25)
    expect(phase(fixture)).toBe('unavailable')

    fixture.store.send(fixture.domain.command.RetryCommand())
    await flushMicrotasks()
    expect(phase(fixture)).toBe('ready')
    expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)
    expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()

    stale.resolve()
    await Promise.resolve()
    expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()
    expect(phase(fixture)).toBe('ready')
    stop()
  })

  it('shares one absolute deadline across sequential initialization stages', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const pending = deferred<void>()
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage).mockImplementationOnce(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 40))
    )
    vi.mocked(fixture.dependencies.prepareLocalStorage).mockReturnValueOnce(pending.promise)
    const stop = start(fixture, 100)

    await vi.advanceTimersByTimeAsync(40)
    expect(fixture.dependencies.prepareLocalStorage).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(59)
    expect(phase(fixture)).toBe('connecting')

    await vi.advanceTimersByTimeAsync(1)
    expect(phase(fixture)).toBe('unavailable')
    expect(fixture.dependencies.prepareMessageDatabase).not.toHaveBeenCalled()
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
    stop()
  })

  it('does not detach Runtime when the deadline expires before the Runtime task starts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const database = deferred<void>()
    vi.mocked(fixture.dependencies.prepareMessageDatabase).mockReturnValueOnce(database.promise)
    const stop = start(fixture, 100)

    await flushMicrotasks()
    expect(fixture.dependencies.prepareMessageDatabase).toHaveBeenCalledOnce()

    vi.setSystemTime(new Date(100))
    database.resolve()
    await flushMicrotasks()

    expect(phase(fixture)).toBe('unavailable')
    expect(fixture.dependencies.initializeRuntime).not.toHaveBeenCalled()
    expect(fixture.dependencies.detachRuntime).not.toHaveBeenCalled()
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
    stop()
  })

  it('detaches a failed Runtime generation before one single-flight Retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createFixture()
    const retryWork = deferred<void>()
    vi.mocked(fixture.dependencies.initializeRuntime).mockRejectedValueOnce(new Error('Runtime unavailable'))
    vi.mocked(fixture.dependencies.prepareBrowserSyncStorage)
      .mockResolvedValueOnce()
      .mockReturnValueOnce(retryWork.promise)
    const stop = start(fixture)

    await vi.waitFor(() => expect(phase(fixture)).toBe('unavailable'))
    expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()

    fixture.store.send(fixture.domain.command.RetryCommand())
    fixture.store.send(fixture.domain.command.RetryCommand())
    expect(phase(fixture)).toBe('connecting')
    expect(fixture.dependencies.prepareBrowserSyncStorage).toHaveBeenCalledTimes(2)

    retryWork.resolve()
    await vi.waitFor(() => expect(phase(fixture)).toBe('ready'))
    expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledTimes(2)
    expect(fixture.activateApplicationDependencies).toHaveBeenCalledOnce()
    stop()
  })

  it('silently fences unmounted Runtime settlement and detaches the started generation', async () => {
    const fixture = createFixture()
    const runtime = deferred<unknown | null>()
    vi.mocked(fixture.dependencies.initializeRuntime).mockReturnValueOnce(runtime.promise)
    const stop = start(fixture)

    await vi.waitFor(() => expect(fixture.dependencies.initializeRuntime).toHaveBeenCalledOnce())
    stop()
    runtime.resolve({})
    await Promise.resolve()

    expect(fixture.dependencies.detachRuntime).toHaveBeenCalledOnce()
    expect(fixture.activateApplicationDependencies).not.toHaveBeenCalled()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
  })
})
