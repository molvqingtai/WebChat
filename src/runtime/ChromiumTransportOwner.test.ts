import { describe, expect, it, vi } from 'vitest'
import { ChromiumTransportOwner } from '@/runtime/ChromiumTransportOwner'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- promise rejection reasons are untyped
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('ChromiumTransportOwner', () => {
  it('shares concurrent admission until the Offscreen callback alignment settles', async () => {
    const document = deferred<{ phase: 'ready'; created: boolean }>()
    const alignment = deferred<void>()
    const rebind = vi.fn(() => alignment.promise)
    const createTransport = vi.fn(() => ({ rebind }))
    const owner = new ChromiumTransportOwner(() => document.promise, createTransport)

    const first = owner.ensure()
    const second = owner.ensure()
    let secondSettled = false
    void second.then(() => {
      secondSettled = true
    })
    expect(createTransport).not.toHaveBeenCalled()

    document.resolve({ phase: 'ready', created: false })
    await Promise.resolve()
    expect(secondSettled).toBe(false)
    alignment.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([expect.any(Object), expect.any(Object)])
    expect(createTransport).toHaveBeenCalledOnce()
    expect(rebind).toHaveBeenCalledOnce()
  })

  it('retries alignment on the facade already held by the logical Runtime', async () => {
    const failure = new Error('replacement Offscreen callback alignment failed')
    const documents = [
      { phase: 'ready' as const, created: false },
      { phase: 'ready' as const, created: true },
      { phase: 'ready' as const, created: false }
    ]
    const rebind = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const join = vi.fn()
    const createTransport = vi.fn(() => ({ rebind, join }))
    const owner = new ChromiumTransportOwner(async () => documents.shift()!, createTransport)

    const serverTransport = await owner.ensure()
    await expect(owner.ensure()).rejects.toBe(failure)
    const admittedTransport = await owner.ensure()
    admittedTransport.join('room-a')

    expect(admittedTransport).toBe(serverTransport)
    expect(createTransport).toHaveBeenCalledOnce()
    expect(rebind).toHaveBeenCalledTimes(3)
    expect(join).toHaveBeenCalledWith('room-a')
  })
  it('replaces a hung alignment without replacing the facade or accepting its late failure', async () => {
    const stale = deferred<void>()
    const rebind = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(undefined)
    const ensureDocument = vi.fn(async () => ({ phase: 'ready' as const, created: false }))
    const transport = { rebind }
    const owner = new ChromiumTransportOwner(ensureDocument, () => transport)
    const first = owner.ensure()
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(rebind).toHaveBeenCalledOnce()
    await expect(owner.ensure(true)).resolves.toBe(transport)
    await rejected
    stale.reject(new Error('old callback failed'))
    await Promise.resolve()
    await expect(owner.ensure()).resolves.toBe(transport)
    expect(rebind).toHaveBeenCalledTimes(2)
    expect(ensureDocument).toHaveBeenCalledTimes(3)
  })

  it('rebinds when refresh overtakes alignment settlement before admission releases', async () => {
    const alignment = deferred<void>()
    const signals: Array<AbortSignal | undefined> = []
    const rebind = vi.fn((signal?: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? alignment.promise : Promise.resolve()
    })
    const owner = new ChromiumTransportOwner(
      async () => ({ phase: 'ready', created: false }),
      () => ({ rebind })
    )
    const first = owner.ensure()
    const retired = first.catch(() => undefined)
    await Promise.resolve()
    const next = alignment.promise.then(() => owner.ensure(true))
    alignment.resolve()
    await next
    await retired
    expect(rebind).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('fences a replaced document check before it can rebind the current facade', async () => {
    const stale = deferred<{ phase: 'ready'; created: boolean }>()
    const ensureDocument = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue({ phase: 'ready', created: false })
    const transport = { rebind: vi.fn(async () => {}) }
    const owner = new ChromiumTransportOwner(ensureDocument, () => transport)
    const first = owner.ensure()
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(owner.ensure(true)).resolves.toBe(transport)
    await rejected
    stale.resolve({ phase: 'ready', created: true })
    await Promise.resolve()
    expect(transport.rebind).toHaveBeenCalledOnce()
  })
})
