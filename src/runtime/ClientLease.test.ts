import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientLease } from './ClientLease'
import type { HostPhase, RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from './Contract'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const snapshot: RuntimeSnapshot = {
  hostId: 'host-a',
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [],
  world: { joined: false, peerId: 'peer-a', presences: [] }
}

const registration = (value: RuntimeSnapshot = snapshot, generation = 1): RuntimePageRegistration => ({
  phase: 'ready',
  generation,
  snapshot: value
})

const coordinatorWith = (registerPage: RuntimeCoordinator['registerPage']): RuntimeCoordinator => ({
  ensureHost: vi.fn(async () => ({ phase: 'ready' as const, generation: 1 })),
  registerPage
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClientLease generation ownership', () => {
  it('publishes connecting immediately and terminates a forever-pending registration inside the original budget', async () => {
    const coordinator = coordinatorWith(vi.fn(() => new Promise<RuntimePageRegistration>(() => {})))
    const phases: HostPhase[] = []
    const client = new ClientLease({ coordinator, pageId: 'page-a', domain: 'https://example.test' })
    client.whenHostPhase((phase) => phases.push(phase))
    let settled = false
    const initializing = client
      .init()
      .catch(() => null)
      .finally(() => {
        settled = true
      })

    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledOnce())
    try {
      expect(phases).toEqual(['none', 'connecting'])
      await vi.advanceTimersByTimeAsync(15000)
      expect(settled).toBe(true)
      expect(phases.at(-1)).toBe('unavailable')
    } finally {
      client.detach()
      await initializing
    }
  })

  it('does not publish ready or start a watchdog after init is detached', async () => {
    const pending = deferred<RuntimePageRegistration>()
    const coordinator = coordinatorWith(vi.fn(() => pending.promise))
    const interval = vi.spyOn(globalThis, 'setInterval')
    const ready = vi.fn()
    const client = new ClientLease({ coordinator, pageId: 'page-a', domain: 'https://example.test' })
    client.whenReady(ready)

    const initializing = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledOnce())
    client.detach()
    pending.resolve(registration())
    await initializing

    expect(ready).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it('fences a registration result that resolves after its RPC deadline', async () => {
    const late = deferred<RuntimePageRegistration>()
    const replacementSnapshot = { ...snapshot, hostId: 'host-b' }
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(registration(replacementSnapshot, 2))
    const coordinator = coordinatorWith(registerPage)
    const ready = vi.fn()
    const client = new ClientLease({
      coordinator,
      pageId: 'page-a',
      domain: 'https://example.test',
      startupTimeoutMs: 6000
    })
    client.whenReady(ready)

    const initializing = client.init()
    await vi.waitFor(() => expect(registerPage).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(5500)
    await initializing
    expect(client.snapshot().hostId).toBe('host-b')

    late.resolve(registration(snapshot, 1))
    await Promise.resolve()

    expect(client.snapshot().hostId).toBe('host-b')
    expect(ready).toHaveBeenCalledOnce()
    client.detach()
  })

  it('keeps checking a healthy lease without turning equal host snapshots into recovery', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const healthySnapshot: RuntimeSnapshot = {
      ...snapshot,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    }
    const coordinator = coordinatorWith(vi.fn(async () => registration(healthySnapshot)))
    const phases: HostPhase[] = []
    const client = new ClientLease({ coordinator, pageId, domain })
    client.whenHostPhase((phase) => phases.push(phase))

    await client.init()
    await vi.advanceTimersByTimeAsync(10000)

    expect(coordinator.registerPage).toHaveBeenCalledTimes(3)
    expect(phases).toEqual(['none', 'connecting', 'ready'])
    client.detach()
  })

  it('keeps bounded polling after a permanent control-plane failure and surfaces every failure with its original message', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const healthySnapshot: RuntimeSnapshot = {
      ...snapshot,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    }
    const nativeError = new Error('Extension context invalidated.')
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration(healthySnapshot))
      .mockRejectedValue(nativeError)
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const failures: string[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      startupTimeoutMs: 1000,
      startupRetryIntervalMs: 10,
      watchdogIntervalMs: 3000,
      logError
    })
    client.whenHostPhase((phase) => phases.push(phase))
    client.whenFailure((error) => failures.push(error.message))
    await client.init()
    phases.length = 0

    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => expect(failures).toEqual([nativeError.message]))
    expect(phases).toContain('unavailable')

    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(failures).toEqual([nativeError.message, nativeError.message]))

    // Error text never controls lifecycle: the same message must not stop polling.
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(failures.length).toBeGreaterThanOrEqual(3))

    const replayed: HostPhase[] = []
    client.whenHostPhase((phase) => replayed.push(phase))
    expect(replayed).toEqual(['unavailable'])
    client.detach()
  })

  it('recovers ready from continued polling once the control plane answers again', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const healthySnapshot: RuntimeSnapshot = {
      ...snapshot,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    }
    const nativeError = new Error('Extension context invalidated.')
    let failUntil = 0
    const registerPage = vi.fn<RuntimeCoordinator['registerPage']>(async () => {
      if (Date.now() < failUntil) throw nativeError
      return registration(healthySnapshot)
    })
    const phases: HostPhase[] = []
    const failures: string[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      startupTimeoutMs: 1000,
      startupRetryIntervalMs: 10,
      watchdogIntervalMs: 3000
    })
    client.whenHostPhase((phase) => phases.push(phase))
    client.whenFailure((error) => failures.push(error.message))
    await client.init()
    phases.length = 0
    failUntil = Date.now() + 6500

    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => expect(failures.length).toBeGreaterThanOrEqual(1))
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(phases.at(-1)).toBe('ready'))

    expect(client.snapshot().hostPhase).toBe('ready')
    client.detach()
  })

  it('treats every transport rejection as diagnostic without changing the healthy lease', async () => {
    const coordinator = coordinatorWith(vi.fn(async () => registration()))
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator,
      pageId: 'page-a',
      domain: 'https://example.test',
      watchdogIntervalMs: 60000,
      logError
    })
    client.whenHostPhase((phase) => phases.push(phase))
    await client.init()
    phases.length = 0

    expect(client.observeTransportRejection(new Error('Unknown transport failure'))).toBe(false)
    expect(client.observeTransportRejection(new Error('Extension context invalidated.'))).toBe(false)

    expect(phases).toEqual([])
    expect(client.snapshot()).toEqual(snapshot)
    client.detach()
  })

  it('single-flights overlapping checks and does not resurrect a detached lease', async () => {
    const pending = deferred<RuntimePageRegistration>()
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration())
      .mockReturnValueOnce(pending.promise)
    const coordinator = coordinatorWith(registerPage)
    const interval = vi.spyOn(globalThis, 'setInterval')
    const ready = vi.fn()
    const client = new ClientLease({ coordinator, pageId: 'page-a', domain: 'https://example.test' })
    client.whenReady(ready)
    await client.init()

    const firstCheck = client.checkNow()
    const secondCheck = client.checkNow()
    expect(secondCheck).toBe(firstCheck)
    await vi.waitFor(() => expect(registerPage).toHaveBeenCalledTimes(2))
    client.detach()
    pending.resolve(registration({ ...snapshot, hostId: 'host-b' }, 2))
    await firstCheck

    expect(ready).toHaveBeenCalledOnce()
    expect(interval).toHaveBeenCalledOnce()
  })

  it('replaces the prior lifecycle watchdog after a second successful init', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const ownedSnapshot = (hostId: string): RuntimeSnapshot => ({
      ...snapshot,
      hostId,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    })
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration(ownedSnapshot('host-a'), 1))
      .mockResolvedValueOnce(registration(ownedSnapshot('host-b'), 2))
      .mockResolvedValueOnce(registration({ ...ownedSnapshot('host-c'), domains: [] }, 3))
      .mockResolvedValueOnce(registration(ownedSnapshot('host-c'), 3))
    const interval = vi.spyOn(globalThis, 'setInterval')
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      watchdogIntervalMs: 1000
    })
    client.whenHostPhase((phase) => phases.push(phase))

    await client.init()
    await client.init()
    phases.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(registerPage).toHaveBeenCalledTimes(4))

    expect(interval).toHaveBeenCalledTimes(2)
    expect(phases).toEqual(['connecting', 'ready'])
    expect(client.snapshot().hostId).toBe('host-c')
    client.detach()
  })

  it('keeps a watchdog probe passive and charges its time to promoted recovery', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const healthySnapshot: RuntimeSnapshot = {
      ...snapshot,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    }
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration(healthySnapshot))
      .mockImplementation(() => new Promise<RuntimePageRegistration>(() => {}))
    const coordinator = coordinatorWith(registerPage)
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator,
      pageId,
      domain,
      watchdogIntervalMs: 60000,
      logError: vi.fn()
    })
    client.whenHostPhase((phase) => phases.push(phase))
    await client.init()
    phases.length = 0

    const checking = client.checkNow()
    await vi.advanceTimersByTimeAsync(4999)
    expect(phases).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(phases).toEqual(['connecting'])

    await vi.advanceTimersByTimeAsync(9999)
    expect(phases).toEqual(['connecting'])

    await vi.advanceTimersByTimeAsync(1)
    expect(phases).toEqual(['connecting', 'unavailable'])
    await checking
    client.detach()
  })

  it('fences a suspended watchdog deadline before a fresh attachment succeeds', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const ownedSnapshot = (hostId: string): RuntimeSnapshot => ({
      ...snapshot,
      hostId,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    })
    const staleCheck = deferred<RuntimePageRegistration>()
    const replacement = registration(ownedSnapshot('host-b'), 2)
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration(ownedSnapshot('host-a'), 1))
      .mockReturnValueOnce(staleCheck.promise)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(replacement)
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      watchdogIntervalMs: 60000,
      logError
    })
    client.whenHostPhase((phase) => phases.push(phase))
    await client.init()
    phases.length = 0

    const suspended = client.checkNow()
    await vi.waitFor(() => expect(registerPage).toHaveBeenCalledTimes(2))
    vi.setSystemTime(Date.now() + 15001)
    staleCheck.reject(new Error('suspended probe failed'))
    await suspended
    await client.checkNow()

    expect(registerPage).toHaveBeenCalledTimes(4)
    expect(phases).toEqual(['unavailable', 'connecting', 'ready'])
    expect(logError).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: 'suspended probe failed' }))
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b', hostPhase: 'ready' })
    client.detach()
  })

  it('hands an expired suspended check to current attachment before its stale result settles', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const ownedSnapshot = (hostId: string): RuntimeSnapshot => ({
      ...snapshot,
      hostId,
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ]
    })
    const staleCheck = deferred<RuntimePageRegistration>()
    const replacement = registration(ownedSnapshot('host-b'), 2)
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration(ownedSnapshot('host-a'), 1))
      .mockReturnValueOnce(staleCheck.promise)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(replacement)
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      watchdogIntervalMs: 60000,
      logError
    })
    client.whenHostPhase((phase) => phases.push(phase))
    await client.init()
    phases.length = 0

    const suspended = client.checkNow()
    await vi.waitFor(() => expect(registerPage).toHaveBeenCalledTimes(2))
    vi.setSystemTime(Date.now() + 15001)
    const current = client.checkNow()
    try {
      await vi.waitFor(() => expect(registerPage).toHaveBeenCalledTimes(4))
      await current
      staleCheck.reject(new Error('late suspended probe failed'))
      await suspended

      expect(phases).toEqual(['connecting', 'ready'])
      expect(logError).not.toHaveBeenCalled()
      expect(client.snapshot()).toMatchObject({ hostId: 'host-b', hostPhase: 'ready' })
    } finally {
      staleCheck.reject(new Error('test cleanup'))
      client.detach()
      await Promise.allSettled([suspended, current])
    }
  })

  it('treats page detach as connectivity cleanup without releasing the background tab owner', async () => {
    const coordinator = coordinatorWith(vi.fn(async () => registration()))
    const phases: HostPhase[] = []
    const client = new ClientLease({ coordinator, pageId: 'page-a', domain: 'https://example.test' })
    client.whenHostPhase((phase) => phases.push(phase))

    await client.init()
    client.detach()
    await Promise.resolve()

    expect(coordinator.registerPage).toHaveBeenCalledOnce()
    expect(phases.at(-1)).toBe('none')
  })
})
