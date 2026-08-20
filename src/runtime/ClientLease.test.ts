import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientLease } from './ClientLease'
import type { RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from './Contract'

const pageId = 'page-a'
const domain = 'https://example.test'

const snapshot = (hostId = 'host-a'): RuntimeSnapshot => ({
  hostId,
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [{ domain, phase: 'active', pageIds: [pageId], chatRoomJoined: true, sessions: [] }],
  world: { joined: true, peerId: 'peer-a', presences: [] }
})

const registration = (hostId = 'host-a'): RuntimePageRegistration => ({ snapshot: snapshot(hostId) })

const coordinatorWith = (registerPage: RuntimeCoordinator['registerPage']): RuntimeCoordinator => ({
  registerPage
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClientLease event-driven Runtime admission', () => {
  it('initializes once and never starts a Page watchdog', async () => {
    const registerPage = vi.fn<RuntimeCoordinator['registerPage']>().mockResolvedValue(registration())
    const interval = vi.spyOn(globalThis, 'setInterval')
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })

    await client.init()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(registerPage).toHaveBeenCalledOnce()
    expect(interval).not.toHaveBeenCalled()
    client.detach()
  })

  it('refreshes only from one explicit current Page event', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const ready = vi.fn()
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(ready)

    await client.init()
    await client.checkNow()

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })
    expect(ready).toHaveBeenCalledTimes(2)
    client.detach()
  })

  it('rebinds through a fresh ordinary registration without using the test-only refresh entry', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const ready = vi.fn()
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(ready)

    await client.init()
    await client.rebind()

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })
    expect(ready).toHaveBeenCalledTimes(2)
    client.detach()
  })

  it('does not resolve a rebind until every asynchronous Page registration callback has settled', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const callbacksStarted = deferred<void>()
    const releaseCallbacks = deferred<void>()
    let generation = 0
    let started = 0
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    for (let index = 0; index < 5; index += 1) {
      client.whenReady(() => {
        if (generation === 0) return
        started += 1
        if (started === 5) callbacksStarted.resolve()
        return releaseCallbacks.promise
      })
    }

    await client.init()
    generation = 1
    let settled = false
    const rebind = client.rebind().then(() => {
      settled = true
    })
    await callbacksStarted.promise
    expect(settled).toBe(false)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })

    releaseCallbacks.resolve()
    await rebind
    expect(settled).toBe(true)
    client.detach()
  })

  it('fails a rebind when an exact Page registration callback rejects', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const failure = new Error('Session snapshot registration failed')
    let generation = 0
    const failures: Error[] = []
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(() => {
      if (generation > 0) throw failure
    })
    client.whenFailure((error) => failures.push(error))

    await client.init()
    generation = 1
    await expect(client.rebind()).rejects.toBe(failure)
    expect(failures).toContain(failure)
    client.detach()
  })

  it('keeps an unrelated timeout from replaying an admitted action', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration())
      .mockImplementationOnce(() => new Promise<RuntimePageRegistration>(() => {}))
    const failures: string[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      startupTimeoutMs: 10,
      startupRetryIntervalMs: 1
    })
    client.whenFailure((error) => failures.push(error.message))

    await client.init()
    const refresh = client.checkNow()
    await vi.advanceTimersByTimeAsync(10)
    await refresh

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(failures).toEqual(['Runtime control-plane request timed out'])
    client.detach()
  })

  it('fences a stale explicit refresh after the Page detaches', async () => {
    let resolve!: (value: RuntimePageRegistration) => void
    const pending = new Promise<RuntimePageRegistration>((done) => {
      resolve = done
    })
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration())
      .mockReturnValueOnce(pending)
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })

    await client.init()
    const refresh = client.checkNow()
    client.detach()
    resolve(registration('host-b'))
    await refresh

    expect(() => client.snapshot()).not.toThrow()
  })
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}
