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

/** Observes settlement of a public terminal promise without ever awaiting it as a gate. */
const watchSettlement = (promise: Promise<unknown>) => {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  return () => settled
}

/** A retired supply id accepts no further correlation: a later cancel settles immediately. */
const expectRetired = async (port: PagePort, supplyId: string) => {
  let cancelSettled = false
  void port.cancelHistorySupply(supplyId).then(() => {
    cancelSettled = true
  })
  await Promise.resolve()
  expect(cancelSettled).toBe(true)
}

/**
 * Public retirement proof for the exact id: re-register the same tab's provider and publicly
 * remove it — a leaked pending entry would be cancelled again here, so zero events must fire.
 */
const expectRetiredSilentOnRemoval = (port: PagePort, domain: string) => {
  const removalEvents: HistorySupplyEvent[] = []
  port.provideHistory(1, domain, (event) => removalEvents.push(event))
  port.removePage(1)
  expect(removalEvents).toEqual([])
}

/** The provider survived every late terminal: a fresh supply is served through the public path. */
const expectProviderAlive = async (port: PagePort, events: HistorySupplyEvent[], next: typeof request) => {
  const followUp = port.supplyHistory('tab:1', next)
  expect(events.at(-1)).toEqual({ type: 'request', request: next })
  port.resolveHistorySupply(1, next.supplyId, { records: [], done: true })
  await expect(followUp).resolves.toEqual({ records: [], done: true })
}

describe('PagePort history request/response', () => {
  it('forwards one completion only to current same-domain History providers', () => {
    const port = new PagePort()
    const current: HistorySupplyEvent[] = []
    const other: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => current.push(event))
    port.provideHistory(2, 'https://other.example', (event) => other.push(event))

    port.historySyncCompleted({ domain: request.domain, sourcePeerId: 'peer', syncId: 'sync-1', inserted: true })

    expect(current).toEqual([
      {
        type: 'sync-completed',
        completion: { domain: request.domain, sourcePeerId: 'peer', syncId: 'sync-1', inserted: true }
      }
    ])
    expect(other).toEqual([])
  })

  it('settles one supply id exactly once through the explicit response RPC', async () => {
    const port = new PagePort()
    const events: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => {
      events.push(event)
    })
    const pending = port.supplyHistory('tab:1', request)

    port.resolveHistorySupply(1, request.supplyId, { records: [], done: true })
    port.resolveHistorySupply(1, request.supplyId, { records: [], done: false })
    port.rejectHistorySupply(1, request.supplyId, 'late rejection')

    await expect(pending).resolves.toEqual({ records: [], done: true })
    // Late terminals touched nothing: the only page event is the original request, the retired id
    // accepts no correlation, and the live provider still serves a fresh supply.
    expect(events).toEqual([{ type: 'request', request }])
    await expectRetired(port, request.supplyId)
    await expectProviderAlive(port, events, { ...request, supplyId: 'supply-2' })
  })

  it('waits for explicit physical settlement after cancelling a correlated request', async () => {
    const port = new PagePort()
    const events: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => {
      events.push(event)
    })
    const pending = port.supplyHistory('tab:1', request)
    const isPendingSettled = watchSettlement(pending)
    const rejected = expect(pending).rejects.toThrow('History supplier timed out')

    const cancelled = port.cancelHistorySupply(request.supplyId)
    await Promise.resolve()
    // The cancellation is delivered but the correlation still awaits the page's physical exit.
    expect(isPendingSettled()).toBe(false)

    port.rejectHistorySupply(1, request.supplyId, 'IndexedDB transaction aborted')
    await expect(cancelled).resolves.toBeUndefined()
    await rejected
    // Retirement proof comes BEFORE the late terminals so they cannot clean up a leaked entry:
    // re-registering the same tab's provider and publicly removing it must cancel nothing.
    expectRetiredSilentOnRemoval(port, request.domain)
    port.resolveHistorySupply(1, request.supplyId, { records: [], done: true })
    port.rejectHistorySupply(1, request.supplyId, 'late rejection')

    expect(events).toEqual([
      { type: 'request', request },
      { type: 'cancel', supplyId: request.supplyId }
    ])
    await expectRetired(port, request.supplyId)
    // The provider was publicly removed above: re-register to prove it still serves a fresh supply.
    const aliveEvents: HistorySupplyEvent[] = []
    port.provideHistory(1, request.domain, (event) => aliveEvents.push(event))
    const followUp = port.supplyHistory('tab:1', { ...request, supplyId: 'supply-2' })
    expect(aliveEvents).toEqual([{ type: 'request', request: { ...request, supplyId: 'supply-2' } }])
    port.resolveHistorySupply(1, 'supply-2', { records: [], done: true })
    await expect(followUp).resolves.toEqual({ records: [], done: true })
  })

  it.each(['reject', 'resolve'] as const)(
    'cancels pending work before replacing the same page provider (old %s terminal)',
    async (terminal) => {
      const port = new PagePort()
      const oldEvents: HistorySupplyEvent[] = []
      port.provideHistory(1, request.domain, (event) => {
        oldEvents.push(event)
      })
      const pending = port.supplyHistory('tab:1', request)
      const isPendingSettled = watchSettlement(pending)

      const newEvents: HistorySupplyEvent[] = []
      port.provideHistory(1, request.domain, (event) => {
        newEvents.push(event)
      })
      await Promise.resolve()
      // The old supply is cancelled but still physically running: it has not settled.
      expect(isPendingSettled()).toBe(false)

      if (terminal === 'reject') port.rejectHistorySupply(1, request.supplyId, 'old provider cancelled')
      else port.resolveHistorySupply(1, request.supplyId, { records: [], done: true })
      await expect(pending).resolves.toBeNull()
      expect(oldEvents).toEqual([
        { type: 'request', request },
        { type: 'cancel', supplyId: request.supplyId }
      ])
      // Retirement proof BEFORE anything else: re-registering the same tab's callback and
      // publicly removing it must not cancel the retired old exact id a second time.
      expectRetiredSilentOnRemoval(port, request.domain)
      await expectRetired(port, request.supplyId)
      // The replacement-time provider observed nothing while registered.
      expect(newEvents).toEqual([])
      // The replacement provider is re-registered and serves the next supply through the public path.
      const aliveEvents: HistorySupplyEvent[] = []
      port.provideHistory(1, request.domain, (event) => {
        aliveEvents.push(event)
      })
      const next = { ...request, supplyId: 'supply-2' }
      const followUp = port.supplyHistory('tab:1', next)
      expect(aliveEvents).toEqual([{ type: 'request', request: next }])
      port.resolveHistorySupply(1, next.supplyId, { records: [], done: true })
      await expect(followUp).resolves.toEqual({ records: [], done: true })
    }
  )

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
    await expectRetired(port, request.supplyId)
    // The detached removal really retired the exact id: re-registering the same tab and publicly
    // removing it cancels nothing.
    expectRetiredSilentOnRemoval(port, request.domain)
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
    await expectRetired(port, request.supplyId)
    // The active-cancellation removal path really retired the exact id.
    expectRetiredSilentOnRemoval(port, request.domain)
    diagnostic.mockRestore()
  })

  it('releases a failed or host-disposed pending correlation', async () => {
    const rejectedPort = new PagePort()
    const rejectedEvents: HistorySupplyEvent[] = []
    rejectedPort.provideHistory(1, request.domain, (event) => {
      rejectedEvents.push(event)
    })
    const rejected = rejectedPort.supplyHistory('tab:1', request)
    rejectedPort.rejectHistorySupply(1, request.supplyId, 'store failed')
    await expect(rejected).rejects.toThrow('store failed')
    // A failed terminal also removes the dead provider; re-register and the port serves again.
    await expectRetired(rejectedPort, request.supplyId)
    rejectedPort.provideHistory(1, request.domain, (event) => {
      rejectedEvents.push(event)
    })
    const next = { ...request, supplyId: 'supply-2' }
    const followUp = rejectedPort.supplyHistory('tab:1', next)
    expect(rejectedEvents.at(-1)).toEqual({ type: 'request', request: next })
    rejectedPort.resolveHistorySupply(1, next.supplyId, { records: [], done: true })
    await expect(followUp).resolves.toEqual({ records: [], done: true })
    // The failed terminal really retired the exact id: public re-registration + removal cancels nothing.
    expectRetiredSilentOnRemoval(rejectedPort, request.domain)

    const disposedPort = new PagePort()
    const events: HistorySupplyEvent[] = []
    disposedPort.provideHistory(1, request.domain, (event) => {
      events.push(event)
    })
    const disposed = disposedPort.supplyHistory('tab:1', request)
    disposedPort.dispose()
    await expect(disposed).rejects.toThrow('History supplier page detached')
    expect(events.at(-1)).toEqual({ type: 'cancel', supplyId: request.supplyId })
    await expectRetired(disposedPort, request.supplyId)
    // Disposal really retired the exact id.
    expectRetiredSilentOnRemoval(disposedPort, request.domain)
  })
})
