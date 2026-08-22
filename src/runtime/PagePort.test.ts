import { describe, expect, it, vi } from 'vitest'
import type { HistorySupplyEvent } from '@/runtime/Contract'
import { PagePort } from '@/runtime/PagePort'

const request = {
  supplyId: 'supply-1',
  domain: 'https://example.com',
  syncId: 'history-1',
  cutoff: 0,
  mode: 'provider' as const
}

describe('PagePort history request/response', () => {
  it('settles one supply id exactly once through the explicit response RPC', async () => {
    const port = new PagePort()
    port.provideHistory(1, request.domain, () => {})
    const pending = port.supplyHistory('tab:1', request)

    port.resolveHistorySupply(1, request.supplyId, { records: [], done: true })
    port.resolveHistorySupply(1, request.supplyId, { records: [], done: false })
    port.rejectHistorySupply(1, request.supplyId, 'late rejection')

    await expect(pending).resolves.toEqual({ records: [], done: true })
    expect(port.pendingHistoryCountForTest()).toBe(0)
  })

  it('waits for explicit physical settlement after cancelling a correlated request', async () => {
    const port = new PagePort()
    const events: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => {
      events.push(event)
    })
    const pending = port.supplyHistory('tab:1', request)
    const rejected = expect(pending).rejects.toThrow('History supplier timed out')

    const cancelled = port.cancelHistorySupply(request.supplyId)
    await Promise.resolve()
    expect(port.pendingHistoryCountForTest()).toBe(1)

    port.rejectHistorySupply(1, request.supplyId, 'IndexedDB transaction aborted')
    await expect(cancelled).resolves.toBeUndefined()
    await rejected
    port.resolveHistorySupply(1, request.supplyId, { records: [], done: true })
    port.rejectHistorySupply(1, request.supplyId, 'late rejection')

    expect(port.pendingHistoryCountForTest()).toBe(0)
    expect(events).toEqual([
      { type: 'request', request },
      { type: 'cancel', supplyId: request.supplyId }
    ])
  })

  it('cancels pending work before replacing the same page provider', async () => {
    const port = new PagePort()
    const oldEvents: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => {
      oldEvents.push(event)
    })
    const pending = port.supplyHistory('tab:1', request)

    port.provideHistory(1, request.domain, () => {})
    await Promise.resolve()
    expect(port.pendingHistoryCountForTest()).toBe(1)

    port.rejectHistorySupply(1, request.supplyId, 'old provider cancelled')
    await expect(pending).resolves.toBeNull()
    expect(port.pendingHistoryCountForTest()).toBe(0)
    expect(oldEvents.at(-1)).toEqual({ type: 'cancel', supplyId: request.supplyId })
  })

  it('logs a detached page cancellation callback failure and still settles the pending supply', async () => {
    const port = new PagePort()
    const failure = new Error('detached page cancel exploded')
    port.provideHistory(1, request.domain, (event) => {
      if (event.type === 'cancel') throw failure
    })
    const pending = port.supplyHistory('tab:1', request)
    const outcome = pending.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    )
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    port.removePage(1)

    // The detached page's callback failure is a direct diagnostic at its exact owner, never
    // swallowed and never rerouted, while the pending supply still settles by its own contract.
    expect(diagnostic).toHaveBeenCalledWith(failure)
    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      error: new Error('History supplier page detached')
    })
    expect(port.pendingHistoryCountForTest()).toBe(0)
    diagnostic.mockRestore()
  })

  it('logs an active cancellation callback failure and settles the pending supply', async () => {
    const port = new PagePort()
    const failure = new Error('active page cancel exploded')
    port.provideHistory(1, request.domain, (event) => {
      if (event.type === 'cancel') throw failure
    })
    const pending = port.supplyHistory('tab:1', request)
    const outcome = pending.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    )
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(port.cancelHistorySupply(request.supplyId)).resolves.toBeUndefined()

    expect(diagnostic).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(failure)
    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      error: new Error('History supplier page detached')
    })
    expect(port.pendingHistoryCountForTest()).toBe(0)
    diagnostic.mockRestore()
  })

  it('releases a failed or host-disposed pending correlation', async () => {
    const rejectedPort = new PagePort()
    rejectedPort.provideHistory(1, request.domain, () => {})
    const rejected = rejectedPort.supplyHistory('tab:1', request)
    rejectedPort.rejectHistorySupply(1, request.supplyId, 'store failed')
    await expect(rejected).rejects.toThrow('store failed')
    expect(rejectedPort.pendingHistoryCountForTest()).toBe(0)

    const disposedPort = new PagePort()
    const events: HistorySupplyEvent[] = []
    disposedPort.provideHistory(1, request.domain, (event) => {
      events.push(event)
    })
    const disposed = disposedPort.supplyHistory('tab:1', request)
    disposedPort.dispose()
    await expect(disposed).rejects.toThrow('History supplier page detached')
    expect(disposedPort.pendingHistoryCountForTest()).toBe(0)
    expect(events.at(-1)).toEqual({ type: 'cancel', supplyId: request.supplyId })
  })
})
