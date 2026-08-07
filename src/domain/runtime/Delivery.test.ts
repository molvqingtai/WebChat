import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import DeliveryDomain from './Delivery'
import LifecycleDomain from './Lifecycle'
import { MAX_INBOUND_BUFFER_EVENTS } from '@/constants/config'
import { MESSAGE_TYPE } from '@/protocol'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { PagePortExtern, type PagePort as PagePortContract } from '@/domain/runtime/externs/PagePort'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'

const DOMAIN = 'https://example.com'

const record = (index: number): TextMessageRecord => {
  const id = `message-${index}`
  return {
    type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
    id,
    message: {
      type: MESSAGE_TYPE.TEXT,
      id,
      hlc: { timestamp: index, counter: 0 },
      userId: 'user-1',
      body: 'body',
      mentions: []
    },
    user: { id: 'user-1', name: 'User', avatar: '' },
    receivedAt: index
  }
}

const setup = () => {
  const store = Remesh.store({ externs: [createPagePortImpl(new PagePort())] })
  const lifecycleAction = LifecycleDomain()
  const deliveryAction = DeliveryDomain()
  const lifecycle = store.getDomain(lifecycleAction)
  const delivery = store.getDomain(deliveryAction)
  store.subscribeDomain(lifecycleAction)
  store.subscribeDomain(deliveryAction)
  store.igniteDomain(lifecycleAction)
  store.igniteDomain(deliveryAction)
  store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, pageId: 'page-a' }))
  return { store, delivery }
}

describe('DeliveryDomain resource and batch ACK boundaries', () => {
  it('rejects an oversized history batch atomically without partial buffer admission', () => {
    const { store, delivery } = setup()
    const discarded = vi.fn()
    store.subscribeEvent(delivery.event.InboundBatchDiscardedEvent, discarded)

    store.send(
      delivery.command.AcceptInboundBatchCommand({
        domain: DOMAIN,
        records: Array.from({ length: MAX_INBOUND_BUFFER_EVENTS + 1 }, (_, index) => record(index)),
        source: 'history',
        batchId: 'oversized-batch'
      })
    )

    expect(store.query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))).toEqual([])
    expect(discarded).toHaveBeenCalledWith({ domain: DOMAIN, batchId: 'oversized-batch' })
  })

  it('emits history-response completion only after every accepted sequence is ACKed', () => {
    const { store, delivery } = setup()
    const completed = vi.fn()
    store.subscribeEvent(delivery.event.HistoryBatchAckedEvent, completed)
    store.send(
      delivery.command.AcceptInboundBatchCommand({
        domain: DOMAIN,
        records: [record(1), record(2)],
        source: 'history',
        batchId: 'batch-1'
      })
    )

    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 1 }))
    expect(completed).not.toHaveBeenCalled()
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 2 }))
    expect(completed).toHaveBeenCalledOnce()
  })

  it('keeps buffered delivery alive after one page emit rejection', async () => {
    const emitAttempts: string[] = []
    const pagePort: PagePortContract = {
      removePage: () => {},
      historyPageIds: () => [],
      emitInbound: async (_pageIds, event) => {
        emitAttempts.push(event.record.id)
        if (emitAttempts.length === 1) throw new Error('transient inbound emit failure')
        return []
      },
      emitSessionEvent: async () => [],
      emitWorldPresence: async () => [],
      emitError: async () => [],
      emitHistoryFeedback: async () => [],
      emitDeadPages: async () => [],
      supplyHistory: async () => null,
      cancelHistorySupply: async () => {}
    }
    const store = Remesh.store({ externs: [PagePortExtern.impl(pagePort)] })
    const lifecycleAction = LifecycleDomain()
    const deliveryAction = DeliveryDomain()
    const lifecycle = store.getDomain(lifecycleAction)
    const delivery = store.getDomain(deliveryAction)
    const discarded = vi.fn()
    const replayed = vi.fn()
    store.subscribeEvent(delivery.event.InboundDiscardedEvent, discarded)
    store.subscribeEvent(delivery.event.InboundReplayedEvent, replayed)
    store.subscribeDomain(lifecycleAction)
    store.subscribeDomain(deliveryAction)
    store.igniteDomain(lifecycleAction)
    store.igniteDomain(deliveryAction)
    store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, pageId: 'page-a' }))

    store.send(delivery.command.AcceptInboundCommand({ domain: DOMAIN, record: record(1), source: 'live' }))
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    store.send(delivery.command.AcceptInboundCommand({ domain: DOMAIN, record: record(2), source: 'live' }))

    await vi.waitFor(() => expect(emitAttempts).toEqual([record(1).id, record(2).id]))
    expect(store.query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))).toHaveLength(2)
    expect(discarded).not.toHaveBeenCalled()
    store.send(delivery.command.ReplayCommand({ domain: DOMAIN, after: 0 }))
    expect(replayed).toHaveBeenCalledTimes(2)
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 1 }))
    expect(
      store
        .query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))
        .map(({ record: buffered }) => buffered.id)
    ).toEqual([record(2).id])
  })
})
