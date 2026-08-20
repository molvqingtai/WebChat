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

  it('drops a failed facade so the next ingress retries a fresh binding', async () => {
    const firstFailure = new Error('initial callback alignment failed')
    const rebind = vi.fn().mockRejectedValueOnce(firstFailure).mockResolvedValue(undefined)
    const createTransport = vi.fn(() => ({ rebind }))
    const owner = new ChromiumTransportOwner(async () => ({ phase: 'ready', created: false }), createTransport)

    await expect(owner.ensure()).rejects.toBe(firstFailure)
    await expect(owner.ensure()).resolves.toEqual(expect.any(Object))
    expect(createTransport).toHaveBeenCalledTimes(2)
    expect(rebind).toHaveBeenCalledTimes(2)
  })
})
