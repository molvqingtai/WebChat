import { describe, expect, it } from 'vitest'
import type { HistorySupplyEvent } from '@/runtime/Contract'
import { PagePort } from '@/runtime/PagePort'

const request = {
  supplyId: 'supply-1',
  domain: 'https://example.com',
  syncId: 'history-1',
  cutoff: 0
}

describe('PagePort session-event lifecycle', () => {
  const event = {
    type: 'snapshot' as const,
    domain: request.domain,
    snapshot: {
      localSession: {
        sessionId: 'local-session',
        user: { id: 'local-user', name: 'Local', avatar: '' },
        joinedAt: 10
      },
      sessions: []
    },
    provenance: 'join' as const
  }

  it('removes session-event callbacks with their page and on host disposal', async () => {
    const port = new PagePort()
    const received: string[] = []
    port.onSessionEvent('page-a', () => {
      received.push('page-a')
    })
    port.onSessionEvent('page-b', () => {
      received.push('page-b')
    })

    expect(await port.emitSessionEvent(['page-a', 'page-b'], event)).toEqual([])
    port.removePage('page-a')
    expect(await port.emitSessionEvent(['page-a', 'page-b'], event)).toEqual([])
    port.dispose()
    expect(await port.emitSessionEvent(['page-a', 'page-b'], event)).toEqual([])
    expect(received).toEqual(['page-a', 'page-b', 'page-b'])
  })

  it('reports and removes a session-event callback that rejects', async () => {
    const port = new PagePort()
    port.onSessionEvent('page-a', async () => {
      throw new Error('page closed')
    })

    expect(await port.emitSessionEvent(['page-a'], event)).toEqual(['page-a'])
    expect(await port.emitSessionEvent(['page-a'], event)).toEqual([])
  })
})

describe('PagePort Runtime error delivery', () => {
  it('keeps the error message intact across the Chrome JSON transport boundary', async () => {
    const port = new PagePort()
    const received: unknown[] = []
    port.onError('page-a', (error) => {
      received.push(JSON.parse(JSON.stringify(error)))
    })

    expect(
      await port.emitError(['page-a'], {
        eventId: 'event-1',
        message: 'Runtime transport disconnected',
        subsystem: 'connection',
        operation: 'lifecycle'
      })
    ).toEqual([])
    expect(received).toEqual([
      { eventId: 'event-1', message: 'Runtime transport disconnected', subsystem: 'connection', operation: 'lifecycle' }
    ])
  })
})

describe('PagePort history request/response', () => {
  it('settles one supply id exactly once through the explicit response RPC', async () => {
    const port = new PagePort()
    port.provideHistory('page-a', request.domain, () => {})
    const pending = port.supplyHistory('page-a', request)

    port.resolveHistorySupply('page-a', request.supplyId, { records: [], done: true })
    port.resolveHistorySupply('page-a', request.supplyId, { records: [], done: false })
    port.rejectHistorySupply('page-a', request.supplyId, 'late rejection')

    await expect(pending).resolves.toEqual({ records: [], done: true })
    expect(port.pendingHistoryCountForTest()).toBe(0)
  })

  it('waits for explicit physical settlement after cancelling a correlated request', async () => {
    const port = new PagePort()
    const events: HistorySupplyEvent[] = []
    port.provideHistory('page-a', request.domain, (event) => {
      events.push(event)
    })
    const pending = port.supplyHistory('page-a', request)
    const rejected = expect(pending).rejects.toThrow('History supplier timed out')

    const cancelled = port.cancelHistorySupply(request.supplyId)
    await Promise.resolve()
    expect(port.pendingHistoryCountForTest()).toBe(1)

    port.rejectHistorySupply('page-a', request.supplyId, 'IndexedDB transaction aborted')
    await expect(cancelled).resolves.toBeUndefined()
    await rejected
    port.resolveHistorySupply('page-a', request.supplyId, { records: [], done: true })
    port.rejectHistorySupply('page-a', request.supplyId, 'late rejection')

    expect(port.pendingHistoryCountForTest()).toBe(0)
    expect(events).toEqual([
      { type: 'request', request },
      { type: 'cancel', supplyId: request.supplyId }
    ])
  })

  it('cancels pending work before replacing the same page provider', async () => {
    const port = new PagePort()
    const oldEvents: HistorySupplyEvent[] = []
    port.provideHistory('page-a', request.domain, (event) => {
      oldEvents.push(event)
    })
    const pending = port.supplyHistory('page-a', request)

    port.provideHistory('page-a', request.domain, () => {})
    await Promise.resolve()
    expect(port.pendingHistoryCountForTest()).toBe(1)

    port.rejectHistorySupply('page-a', request.supplyId, 'old provider cancelled')
    await expect(pending).resolves.toBeNull()
    expect(port.pendingHistoryCountForTest()).toBe(0)
    expect(oldEvents.at(-1)).toEqual({ type: 'cancel', supplyId: request.supplyId })
  })

  it('releases a failed or host-disposed pending correlation', async () => {
    const rejectedPort = new PagePort()
    rejectedPort.provideHistory('page-a', request.domain, () => {})
    const rejected = rejectedPort.supplyHistory('page-a', request)
    rejectedPort.rejectHistorySupply('page-a', request.supplyId, 'store failed')
    await expect(rejected).rejects.toThrow('store failed')
    expect(rejectedPort.pendingHistoryCountForTest()).toBe(0)

    const disposedPort = new PagePort()
    const events: HistorySupplyEvent[] = []
    disposedPort.provideHistory('page-a', request.domain, (event) => {
      events.push(event)
    })
    const disposed = disposedPort.supplyHistory('page-a', request)
    disposedPort.dispose()
    await expect(disposed).rejects.toThrow('History supplier page detached')
    expect(disposedPort.pendingHistoryCountForTest()).toBe(0)
    expect(events.at(-1)).toEqual({ type: 'cancel', supplyId: request.supplyId })
  })
})
