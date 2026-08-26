import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import DeliveryDomain from './Delivery'
import LifecycleDomain from './Lifecycle'
import { MAX_INBOUND_BUFFER_EVENTS } from '@/constants/config'
import { MESSAGE_TYPE } from '@/protocol'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
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
  store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, tabId: 1 }))
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

  it('drops domain batch acknowledgement keys on release so a later same-batchId generation starts fresh', () => {
    const { store, delivery } = setup()
    const completed = vi.fn()
    store.subscribeEvent(delivery.event.HistoryBatchAckedEvent, completed)
    // A partial batch records `inserted: true` for its batchId.
    store.send(
      delivery.command.AcceptInboundBatchCommand({
        domain: DOMAIN,
        records: [record(1), record(2)],
        source: 'history',
        batchId: 'shared-batch'
      })
    )
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 1, inserted: true }))
    expect(completed).not.toHaveBeenCalled()

    // Release clears the domain's batch acknowledgement keys as well as its buffer.
    store.send(delivery.command.ReleaseDomainCommand(DOMAIN))

    // A new generation reuses the same batchId: its completion must not inherit `inserted: true`.
    store.send(
      delivery.command.AcceptInboundBatchCommand({
        domain: DOMAIN,
        records: [record(1), record(2)],
        source: 'history',
        batchId: 'shared-batch'
      })
    )
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 1 }))
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 2 }))
    expect(completed).toHaveBeenCalledWith({ domain: DOMAIN, batchId: 'shared-batch', inserted: false })
  })

  it('retains buffered events as current state until ACKed, without any Page push', async () => {
    const store = Remesh.store({ externs: [createPagePortImpl(new PagePort())] })
    const lifecycleAction = LifecycleDomain()
    const deliveryAction = DeliveryDomain()
    const lifecycle = store.getDomain(lifecycleAction)
    const delivery = store.getDomain(deliveryAction)
    store.subscribeDomain(lifecycleAction)
    store.subscribeDomain(deliveryAction)
    store.igniteDomain(lifecycleAction)
    store.igniteDomain(deliveryAction)
    store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, tabId: 1 }))

    store.send(delivery.command.AcceptInboundCommand({ domain: DOMAIN, record: record(1), source: 'live' }))
    store.send(delivery.command.AcceptInboundCommand({ domain: DOMAIN, record: record(2), source: 'live' }))

    // The buffer is the current-state authority a Page pull reads; nothing is pushed to a Page.
    expect(store.query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))).toHaveLength(2)
    // Static negative control: the replaced delivery replay compatibility path is gone — the
    // current-state query plus the ordinary ACK are the only surviving buffer surfaces.
    expect('ReplayCommand' in delivery.command).toBe(false)
    expect('InboundReplayedEvent' in delivery.event).toBe(false)
    store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: 1 }))
    expect(
      store
        .query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))
        .map(({ record: buffered }) => buffered.id)
    ).toEqual([record(2).id])
  })
})
