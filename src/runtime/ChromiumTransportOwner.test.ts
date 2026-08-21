import { describe, expect, it, vi } from 'vitest'
import { ChromiumTransportOwner } from '@/runtime/ChromiumTransportOwner'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
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
})
