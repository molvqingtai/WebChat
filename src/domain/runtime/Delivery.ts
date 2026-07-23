import { Remesh } from 'remesh'
import { catchError, concatMap, defer, EMPTY, map } from 'rxjs'
import { MAX_INBOUND_BUFFER_BYTES, MAX_INBOUND_BUFFER_EVENTS } from '@/constants/config'
import type { ChatMessageRecord } from '@/domain/Message'
import type { InboundEvent } from '@/runtime/Contract'
import LifecycleDomain from '@/domain/runtime/Lifecycle'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import { getTextByteSize } from '@/utils/getTextByteSize'

interface Delivery {
  domain: string
  nextSequence: number
  buffer: InboundEvent[]
  bufferBytes: number
}

const DeliveryDomain = Remesh.domain({
  name: 'DeliveryDomain',
  impl: (domain) => {
    const lifecycleDomain = domain.getDomain(LifecycleDomain())
    const pagePort = domain.getExtern(PagePortExtern)
    const DeliveriesState = domain.state<Delivery[]>({
      name: 'Delivery.DeliveriesState',
      default: []
    })

    const BufferedEventsQuery = domain.query({
      name: 'Delivery.BufferedEventsQuery',
      impl: ({ get }, payload: { domain: string; after: number }) => {
        const delivery = get(DeliveriesState()).find((item) => item.domain === payload.domain)
        return delivery ? delivery.buffer.filter((event) => event.sequence > payload.after) : []
      }
    })

    const AcceptInboundCommand = domain.command({
      name: 'Delivery.AcceptInboundCommand',
      impl: (
        { get },
        payload: {
          domain: string
          record: ChatMessageRecord
          source: InboundEvent['source']
          batchId?: string
        }
      ) => {
        if (!get(lifecycleDomain.query.DomainLeaseQuery(payload.domain))) {
          return InboundDiscardedEvent(payload)
        }
        const deliveries = get(DeliveriesState())
        const current = deliveries.find((item) => item.domain === payload.domain)
        const recordBytes = getTextByteSize(JSON.stringify(payload.record))
        if (
          (current?.buffer.length ?? 0) >= MAX_INBOUND_BUFFER_EVENTS ||
          (current?.bufferBytes ?? 0) + recordBytes > MAX_INBOUND_BUFFER_BYTES
        ) {
          return InboundDiscardedEvent(payload)
        }
        const sequence = current?.nextSequence ?? 1
        const event: InboundEvent = { sequence, ...payload }
        const next: Delivery = {
          domain: payload.domain,
          nextSequence: sequence + 1,
          buffer: [...(current?.buffer ?? []), event],
          bufferBytes: (current?.bufferBytes ?? 0) + recordBytes
        }
        return [
          DeliveriesState().new(
            current ? deliveries.map((item) => (item.domain === payload.domain ? next : item)) : [...deliveries, next]
          ),
          InboundAcceptedEvent(event)
        ]
      }
    })

    // A history response is admitted all-or-nothing so its cursor never advances past records dropped locally.
    const AcceptInboundBatchCommand = domain.command({
      name: 'Delivery.AcceptInboundBatchCommand',
      impl: (
        { get },
        payload: {
          domain: string
          records: ChatMessageRecord[]
          source: InboundEvent['source']
          batchId: string
        }
      ) => {
        const lease = get(lifecycleDomain.query.DomainLeaseQuery(payload.domain))
        const deliveries = get(DeliveriesState())
        const current = deliveries.find((item) => item.domain === payload.domain)
        const recordsBytes = payload.records.reduce(
          (total, record) => total + getTextByteSize(JSON.stringify(record)),
          0
        )
        if (
          !lease ||
          (current?.buffer.length ?? 0) + payload.records.length > MAX_INBOUND_BUFFER_EVENTS ||
          (current?.bufferBytes ?? 0) + recordsBytes > MAX_INBOUND_BUFFER_BYTES
        ) {
          return InboundBatchDiscardedEvent({ domain: payload.domain, batchId: payload.batchId })
        }
        const firstSequence = current?.nextSequence ?? 1
        const events = payload.records.map<InboundEvent>((record, index) => ({
          domain: payload.domain,
          record,
          source: payload.source,
          batchId: payload.batchId,
          sequence: firstSequence + index
        }))
        const next: Delivery = {
          domain: payload.domain,
          nextSequence: firstSequence + events.length,
          buffer: [...(current?.buffer ?? []), ...events],
          bufferBytes: (current?.bufferBytes ?? 0) + recordsBytes
        }
        return [
          DeliveriesState().new(
            current ? deliveries.map((item) => (item.domain === payload.domain ? next : item)) : [...deliveries, next]
          ),
          ...events.map(InboundAcceptedEvent)
        ]
      }
    })

    // ACK clears volatile delivery only after durable insert-or-existing settlement; a batch advances only after every member ACKs.
    const AckInboundCommand = domain.command({
      name: 'Delivery.AckInboundCommand',
      impl: ({ get }, payload: { domain: string; sequence: number }) => {
        const deliveries = get(DeliveriesState())
        const current = deliveries.find((item) => item.domain === payload.domain)
        if (!current) return null
        const acknowledged = current.buffer.find((event) => event.sequence === payload.sequence)
        if (!acknowledged) return null
        const buffer = current.buffer.filter((event) => event.sequence !== payload.sequence)
        const batchId = acknowledged.batchId
        const batchComplete = Boolean(batchId && !buffer.some((event) => event.batchId === batchId))
        const bufferBytes = Math.max(0, current.bufferBytes - getTextByteSize(JSON.stringify(acknowledged.record)))
        return [
          DeliveriesState().new(
            deliveries.map((item) => (item.domain === payload.domain ? { ...item, buffer, bufferBytes } : item))
          ),
          InboundAckedEvent(payload),
          ...(batchComplete && batchId ? [HistoryBatchAckedEvent({ domain: payload.domain, batchId })] : [])
        ]
      }
    })

    const ReplayCommand = domain.command({
      name: 'Delivery.ReplayCommand',
      impl: ({ get }, payload: { domain: string; after: number }) =>
        get(BufferedEventsQuery(payload)).map(InboundReplayedEvent)
    })

    const ReleaseDomainCommand = domain.command({
      name: 'Delivery.ReleaseDomainCommand',
      impl: ({ get }, releasedDomain: string) => {
        const deliveries = get(DeliveriesState())
        return deliveries.some((item) => item.domain === releasedDomain)
          ? DeliveriesState().new(deliveries.filter((item) => item.domain !== releasedDomain))
          : null
      }
    })

    const InboundAcceptedEvent = domain.event<InboundEvent>({ name: 'Delivery.InboundAcceptedEvent' })
    const InboundReplayedEvent = domain.event<InboundEvent>({ name: 'Delivery.InboundReplayedEvent' })
    const InboundAckedEvent = domain.event<{ domain: string; sequence: number }>({
      name: 'Delivery.InboundAckedEvent'
    })
    const InboundDiscardedEvent = domain.event<{
      domain: string
      record: ChatMessageRecord
      source: InboundEvent['source']
      batchId?: string
    }>({ name: 'Delivery.InboundDiscardedEvent' })
    const HistoryBatchAckedEvent = domain.event<{ domain: string; batchId: string }>({
      name: 'Delivery.HistoryBatchAckedEvent'
    })
    const InboundBatchDiscardedEvent = domain.event<{ domain: string; batchId: string }>({
      name: 'Delivery.InboundBatchDiscardedEvent'
    })

    const DetachDeadPagesCommand = domain.command({
      name: 'Delivery.DetachDeadPagesCommand',
      impl: ({ get }, pageIds: string[]) =>
        pageIds.flatMap((pageId) => {
          const lease = get(lifecycleDomain.query.DomainLeasesQuery()).find((item) => item.pageIds.includes(pageId))
          return lease ? [lifecycleDomain.command.DetachPageCommand({ domain: lease.domain, pageId })] : []
        })
    })

    domain.effect({
      name: 'Delivery.PageEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(InboundAcceptedEvent).pipe(
          concatMap((event) =>
            defer(() =>
              pagePort.emitInbound(get(lifecycleDomain.query.DomainLeaseQuery(event.domain))?.pageIds ?? [], event)
            ).pipe(
              map(DetachDeadPagesCommand),
              catchError(() => EMPTY)
            )
          )
        )
    })

    domain.effect({
      name: 'Delivery.ReleaseWithDomainEffect',
      impl: ({ fromEvent }) =>
        fromEvent(lifecycleDomain.event.DomainReleasedEvent).pipe(
          map((releasedDomain) => ReleaseDomainCommand(releasedDomain))
        )
    })

    return {
      query: { BufferedEventsQuery },
      command: {
        AcceptInboundCommand,
        AcceptInboundBatchCommand,
        AckInboundCommand,
        ReplayCommand,
        ReleaseDomainCommand
      },
      event: {
        InboundAcceptedEvent,
        InboundReplayedEvent,
        InboundAckedEvent,
        InboundDiscardedEvent,
        InboundBatchDiscardedEvent,
        HistoryBatchAckedEvent
      }
    }
  }
})

export default DeliveryDomain
