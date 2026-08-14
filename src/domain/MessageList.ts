import { Remesh } from 'remesh'
import { catchError, defer, fromEventPattern, map, merge, mergeMap, of } from 'rxjs'
import { MessageDatabaseExtern, createMessageStore, type MessageStore } from '@/domain/MessageStore'
import StatusModule from './modules/Status'
import { MESSAGE_RECORD_TYPE, type MessageRecord, type SystemNoticeRecord } from '@/domain/Message'
import { projectRecords } from '@/domain/MessageProjection'
import { stringToHex } from '@/utils'

const noticeAtSlot = (record: SystemNoticeRecord, slot: number): SystemNoticeRecord => {
  if (slot === 0) return record
  const id = `notice:${stringToHex(`${record.id}:${slot}`)}`
  return { ...record, id, notice: { ...record.notice, id } }
}

const isEquivalentTypedNotice = (record: MessageRecord, expected: SystemNoticeRecord): boolean =>
  record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE &&
  record.notice.type === expected.notice.type &&
  record.notice.body === expected.notice.body &&
  record.user.id === expected.user.id &&
  record.user.name === expected.user.name &&
  record.user.avatar === expected.user.avatar

const persistNotice = async (messageStore: MessageStore, record: SystemNoticeRecord) => {
  // functional-loop: condition-driven — slot probing until the insert wins has no bounded range
  for (let slot = 0; ; slot += 1) {
    const candidate = noticeAtSlot(record, slot)
    const result = await messageStore.insert(candidate)
    if (result.inserted) return
    // The raw conflict occupant stays opaque (never cast or interpreted): the typed occupant
    // is obtained only through the authorized local-load boundary; continue to the next slot
    // if it is absent (a corrupt near-match row is dropped by that load parse).
    const stored = await messageStore.query({ type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE })
    const occupant = stored.find((item) => item.id === candidate.id)
    if (occupant && isEquivalentTypedNotice(occupant, candidate)) return
  }
}

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

interface CanonicalQueryRequest {
  sequence: number
  finishLoad: boolean
  reloadOnFailure: boolean
}

export type { DisplayMessage as Message, ProjectedTextMessage, SystemNoticeMessage } from '@/domain/Message'
export type { MentionedUser } from '@/protocol/ChatRoom'
export type { ChatUser } from '@/protocol/Session'

const MessageListDomain = Remesh.domain({
  name: 'MessageListDomain',
  impl: (domain) => {
    const messageStore = createMessageStore(domain.getExtern(MessageDatabaseExtern))
    const LoadStatus = StatusModule(domain, { name: 'Message.ListLoadStatusModule' })

    const RecordsState = domain.state<readonly MessageRecord[]>({
      name: 'MessageList.RecordsState',
      default: []
    })

    const PreviewRecordsState = domain.state<readonly MessageRecord[]>({
      name: 'MessageList.PreviewRecordsState',
      default: []
    })

    const CanonicalSequenceState = domain.state<number>({
      name: 'MessageList.CanonicalSequenceState',
      default: 0
    })

    const RecordListQuery = domain.query({
      name: 'MessageList.RecordListQuery',
      impl: ({ get }) => get(RecordsState())
    })

    const ListQuery = domain.query({
      name: 'MessageList.ListQuery',
      impl: ({ get }) => projectRecords([...get(RecordsState()), ...get(PreviewRecordsState())])
    })

    const ItemQuery = domain.query({
      name: 'MessageList.ItemQuery',
      impl: ({ get }, id: string) => get(ListQuery()).find((message) => message.id === id) ?? null
    })

    const HasItemQuery = domain.query({
      name: 'MessageList.HasItemQuery',
      impl: ({ get }, id: string) => get(RecordsState()).some((record) => record.id === id)
    })

    const LoadIsFinishedQuery = LoadStatus.query.IsFinishedQuery

    const ChangeListEvent = domain.event({
      name: 'MessageList.ChangeListEvent',
      impl: ({ get }) => get(ListQuery())
    })

    const ApplyRecordCommand = domain.command({
      name: 'MessageList.ApplyRecordCommand',
      impl: ({ get }, record: MessageRecord) => {
        const records = get(PreviewRecordsState())
        const next = records.some((existing) => existing.id === record.id)
          ? records.map((existing) => (existing.id === record.id ? record : existing))
          : [...records, record]
        return [PreviewRecordsState().new(next), ChangeListEvent()]
      }
    })

    const PersistRecordRequestedEvent = domain.event<MessageRecord>({
      name: 'MessageList.PersistRecordRequestedEvent'
    })

    const PersistRecordCommand = domain.command({
      name: 'MessageList.PersistRecordCommand',
      impl: (_, record: MessageRecord) => PersistRecordRequestedEvent(record)
    })

    const SyncToStateEvent = domain.event<readonly MessageRecord[]>({
      name: 'MessageList.SyncToStateEvent'
    })

    const LoadFailedEvent = domain.event<Error>({
      name: 'MessageList.LoadFailedEvent'
    })

    const SyncToStateCommand = domain.command({
      name: 'MessageList.SyncToStateCommand',
      impl: (_, records: readonly MessageRecord[]) => [
        RecordsState().new(records),
        SyncToStateEvent(records),
        ChangeListEvent()
      ]
    })

    const ReloadRequestedEvent = domain.event({ name: 'MessageList.ReloadRequestedEvent' })
    const ReloadCommand = domain.command({
      name: 'MessageList.ReloadCommand',
      impl: () => [PreviewRecordsState().new([]), ChangeListEvent(), ReloadRequestedEvent()]
    })

    const CanonicalQueryRequestedEvent = domain.event<CanonicalQueryRequest>({
      name: 'MessageList.CanonicalQueryRequestedEvent'
    })

    const RequestCanonicalQueryCommand = domain.command({
      name: 'MessageList.RequestCanonicalQueryCommand',
      impl: ({ get }, request: Omit<CanonicalQueryRequest, 'sequence'>) => {
        const sequence = get(CanonicalSequenceState()) + 1
        return [CanonicalSequenceState().new(sequence), CanonicalQueryRequestedEvent({ ...request, sequence })]
      }
    })

    const CompleteCanonicalQueryCommand = domain.command({
      name: 'MessageList.CompleteCanonicalQueryCommand',
      impl: ({ get }, payload: { request: CanonicalQueryRequest; records: readonly MessageRecord[] }) => {
        const finishLoad = payload.request.finishLoad ? [LoadStatus.command.SetFinishedCommand()] : []
        return payload.request.sequence === get(CanonicalSequenceState())
          ? [SyncToStateCommand(payload.records), ...finishLoad]
          : finishLoad
      }
    })

    const FailCanonicalQueryCommand = domain.command({
      name: 'MessageList.FailCanonicalQueryCommand',
      impl: ({ get }, payload: { request: CanonicalQueryRequest; error: unknown }) => {
        const finishLoad = payload.request.finishLoad ? [LoadStatus.command.SetFinishedCommand()] : []
        if (payload.request.sequence !== get(CanonicalSequenceState()) && !payload.request.reloadOnFailure) {
          return finishLoad
        }
        return [
          ...finishLoad,
          LoadFailedEvent(toError(payload.error)),
          ...(payload.request.reloadOnFailure ? [ReloadCommand()] : [])
        ]
      }
    })

    const ClearRequestedEvent = domain.event({ name: 'MessageList.ClearRequestedEvent' })
    const ClearListCommand = domain.command({
      name: 'MessageList.ClearListCommand',
      impl: () => ClearRequestedEvent()
    })

    domain.effect({
      name: 'MessageList.CanonicalQueryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(CanonicalQueryRequestedEvent).pipe(
          mergeMap((request) =>
            defer(() => messageStore.query()).pipe(
              map((records) => CompleteCanonicalQueryCommand({ request, records })),
              catchError((error) => [FailCanonicalQueryCommand({ request, error })])
            )
          )
        )
    })

    domain.effect({
      name: 'MessageList.ReloadEffect',
      impl: ({ fromEvent }) =>
        merge(
          of(undefined),
          fromEventPattern(
            (handler) => messageStore.watch(handler),
            (_handler, unwatch) => unwatch()
          ),
          fromEvent(ReloadRequestedEvent)
        ).pipe(map(() => RequestCanonicalQueryCommand({ finishLoad: true, reloadOnFailure: false })))
    })

    domain.effect({
      name: 'MessageList.PersistRecordEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PersistRecordRequestedEvent).pipe(
          mergeMap((record) =>
            defer(async () => {
              if (record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE) await persistNotice(messageStore, record)
              else await messageStore.insert(record)
              return RequestCanonicalQueryCommand({ finishLoad: false, reloadOnFailure: true })
            }).pipe(catchError((error) => [LoadFailedEvent(toError(error)), ReloadCommand()]))
          )
        )
    })

    domain.effect({
      name: 'MessageList.ClearEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ClearRequestedEvent).pipe(
          mergeMap(() =>
            defer(() => messageStore.clear()).pipe(
              map(() => RequestCanonicalQueryCommand({ finishLoad: false, reloadOnFailure: true })),
              catchError((error) => [LoadFailedEvent(toError(error)), ReloadCommand()])
            )
          )
        )
    })

    return {
      query: {
        HasItemQuery,
        ItemQuery,
        ListQuery,
        RecordListQuery,
        LoadIsFinishedQuery
      },
      command: {
        ApplyRecordCommand,
        PersistRecordCommand,
        ReloadCommand,
        ClearListCommand
      },
      event: {
        ChangeListEvent,
        SyncToStateEvent,
        LoadFailedEvent
      }
    }
  }
})

export default MessageListDomain
