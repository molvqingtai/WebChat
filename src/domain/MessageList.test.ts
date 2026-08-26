import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import MessageListDomain from '@/domain/MessageList'
import type { Database } from '@/domain/externs/Database'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MessageDatabaseExtern, createMessageStore, type MessageDatabaseSchema } from '@/domain/MessageStore'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  type MessageRecord,
  type SystemNoticeRecord,
  type TextMessageRecord
} from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol'
import { stringToHex } from '@/utils'

let databaseId = 0

const textRecord = (id: string, body: string): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 1, counter: 0 },
    userId: 'user-1',
    body,
    mentions: []
  },
  user: { id: 'user-1', name: 'User', avatar: '' },
  receivedAt: 1
})

const noticeRecord = (id: string, timestamp = 2): SystemNoticeRecord => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  notice: {
    id,
    hlc: { timestamp, counter: 0 },
    type: NOTICE_TYPE.JOIN,
    body: '"Remote" joined the chat'
  },
  user: { id: 'remote-user', name: 'Remote', avatar: '' },
  receivedAt: timestamp
})

const first = textRecord('message-1', 'first')
const second = textRecord('message-2', 'second')

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const createHarness = (databaseName = `message-list-${databaseId++}`) => {
  const database = createMemoryMessageDatabase(databaseName)
  const messageStore = createMessageStore(database)
  const store = Remesh.store({ externs: [MessageDatabaseExtern.impl(database)] })
  const action = MessageListDomain()
  const domain = store.getDomain(action)
  const errors: Error[] = []
  const errorSubscription = store.subscribeEvent(domain.event.LoadFailedEvent, (error) => errors.push(error))
  const domainSubscription = store.subscribeDomain(action)
  store.igniteDomain(action)
  return { store, action, domain, domainSubscription, errorSubscription, errors, messageStore }
}

describe('MessageList Database-backed pipeline', () => {
  it('reloads the canonical list after a committed cross-consumer insert', async () => {
    const harness = createHarness()
    await settle()

    await harness.messageStore.insert(first)
    await harness.messageStore.insert(second)
    await settle()

    expect(harness.store.query(harness.domain.query.RecordListQuery())).toEqual([first, second])
    expect(harness.store.query(harness.domain.query.LoadIsFinishedQuery())).toBe(true)
    expect(harness.errors).toEqual([])

    harness.errorSubscription.unsubscribe()
    harness.domainSubscription.unsubscribe()
    harness.store.discardDomain(harness.action)
  })

  it('keeps setup previews outside canonical records and clears them on reload', async () => {
    const harness = createHarness()
    await settle()

    harness.store.send(harness.domain.command.ApplyRecordCommand(first))

    expect(harness.store.query(harness.domain.query.RecordListQuery())).toEqual([])
    expect(harness.store.query(harness.domain.query.ItemQuery(first.id))?.id).toBe(first.id)

    harness.store.send(harness.domain.command.ReloadCommand())
    expect(harness.store.query(harness.domain.query.ItemQuery(first.id))).toBeNull()
    await settle()
    expect(await harness.messageStore.query()).toEqual([])

    harness.errorSubscription.unsubscribe()
    harness.domainSubscription.unsubscribe()
    harness.store.discardDomain(harness.action)
  })

  it('keeps one canonical record across duplicate Domain persistence requests', async () => {
    const harness = createHarness()
    await settle()

    harness.store.send(harness.domain.command.PersistRecordCommand(first))
    await settle()
    harness.store.send(harness.domain.command.PersistRecordCommand(first))
    await settle()

    expect(harness.store.query(harness.domain.query.RecordListQuery())).toEqual([first])

    harness.errorSubscription.unsubscribe()
    harness.domainSubscription.unsubscribe()
    harness.store.discardDomain(harness.action)
  })

  it('survives a near-match corrupt raw same-key occupant without a typed value escaping', async () => {
    const databaseName = `message-list-corrupt-${databaseId++}`
    const database = createMemoryMessageDatabase(databaseName)
    const seedStore = createMessageStore(database)
    const notice = noticeRecord('notice:corrupt')
    // A near-match raw value: every field a subset classifier would check matches the notice,
    // plus an unknown extra key. The raw occupant must stay opaque — the fallback loop moves
    // to the next slot and persists the valid notice there.
    await database.write(['records'], (transaction) =>
      transaction.insert('records', notice.id, {
        type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
        id: notice.id,
        notice: { ...notice.notice },
        user: notice.user,
        receivedAt: notice.receivedAt,
        unknownExtraKey: true
      })
    )
    const harness = createHarness(databaseName)
    await settle()
    // The fallback must not interpret the raw conflict result: it queries the typed occupant
    // through the load boundary (which drops the corrupt row) and continues to the next slot.
    harness.store.send(harness.domain.command.PersistRecordCommand(notice))
    await settle()
    await settle()
    const records = await seedStore.query()
    const joinNotices = records.filter(
      (record): record is SystemNoticeRecord =>
        record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && record.notice.type === NOTICE_TYPE.JOIN
    )
    expect(joinNotices).toHaveLength(1)
    expect(joinNotices[0]?.id).not.toBe(notice.id)
    expect(records.some((record) => record.id === notice.id)).toBe(false)
    harness.errorSubscription.unsubscribe()
    harness.domainSubscription.unsubscribe()
    harness.store.discardDomain(harness.action)
  })

  it('preserves occupied fallback slots while parallel pages and reload converge on one notice', async () => {
    const databaseName = `message-list-notice-fallback-${databaseId++}`
    const seedStore = createMessageStore(createMemoryMessageDatabase(databaseName))
    const notice = noticeRecord('notice:remote-join')
    const concurrentNotice = noticeRecord(notice.id, 3)
    const reloadedNotice = noticeRecord(notice.id, 4)
    const fallbackId = (slot: number) => `notice:${stringToHex(`${notice.id}:${slot}`)}`
    const initialChatWinner = textRecord(notice.id, 'initial Chat winner')
    const occupiedNotice = noticeRecord(fallbackId(1))
    const systemWinner: SystemNoticeRecord = {
      ...occupiedNotice,
      notice: { ...occupiedNotice.notice, type: NOTICE_TYPE.INFO, body: 'different notice winner' }
    }
    const laterChatWinner = textRecord(fallbackId(2), 'later Chat winner')
    await seedStore.insert(initialChatWinner)
    await seedStore.insert(systemWinner)
    await seedStore.insert(laterChatWinner)
    const firstPage = createHarness(databaseName)
    const secondPage = createHarness(databaseName)
    await settle()

    firstPage.store.send(firstPage.domain.command.PersistRecordCommand(notice))
    secondPage.store.send(secondPage.domain.command.PersistRecordCommand(concurrentNotice))
    await settle()
    await settle()

    const reloadedPage = createHarness(databaseName)
    await settle()
    reloadedPage.store.send(reloadedPage.domain.command.PersistRecordCommand(reloadedNotice))
    await settle()
    await settle()

    const records = await seedStore.query()
    expect(records.find((record) => record.id === initialChatWinner.id)).toEqual(initialChatWinner)
    expect(records.find((record) => record.id === systemWinner.id)).toEqual(systemWinner)
    expect(records.find((record) => record.id === laterChatWinner.id)).toEqual(laterChatWinner)
    const notices = records.filter(
      (record): record is SystemNoticeRecord =>
        record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && record.notice.type === NOTICE_TYPE.JOIN
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]?.id).toBe(fallbackId(3))
    ;[firstPage, secondPage, reloadedPage].forEach((harness) => {
      expect(harness.store.query(harness.domain.query.RecordListQuery())).toEqual(records)
      harness.errorSubscription.unsubscribe()
      harness.domainSubscription.unsubscribe()
      harness.store.discardDomain(harness.action)
    })
  })

  it('keeps a later notice projected after a delayed recovery reload', async () => {
    const database = createMemoryMessageDatabase(`message-list-persist-recovery-${databaseId++}`)
    const messageStore = createMessageStore(database)
    let failNextRead = false
    let holdNextRead = false
    const heldReadStarted = deferred<void>()
    const releaseHeldRead = deferred<void>()
    const read = database.read.bind(database)
    const failingDatabase: Database<MessageDatabaseSchema> = {
      read: (async (stores, operation, signal) => {
        if (failNextRead) {
          failNextRead = false
          holdNextRead = true
          throw new Error('transient canonical query failure')
        }
        const result = await read(stores, operation, signal)
        if (holdNextRead) {
          holdNextRead = false
          heldReadStarted.resolve()
          await releaseHeldRead.promise
        }
        return result
      }) as typeof database.read,
      write: database.write.bind(database),
      watch: () => () => {}
    }
    const store = Remesh.store({ externs: [MessageDatabaseExtern.impl(failingDatabase)] })
    const action = MessageListDomain()
    const domain = store.getDomain(action)
    const errors: Error[] = []
    const errorSubscription = store.subscribeEvent(domain.event.LoadFailedEvent, (error) => errors.push(error))
    const domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    await vi.waitFor(() => expect(store.query(domain.query.LoadIsFinishedQuery())).toBe(true))

    const join = noticeRecord('notice:persist-recovery-join')
    const leaveBase = noticeRecord('notice:persist-recovery-leave', 3)
    const leave: SystemNoticeRecord = {
      ...leaveBase,
      notice: { ...leaveBase.notice, type: NOTICE_TYPE.LEAVE, body: '"Remote" left the chat' }
    }
    failNextRead = true
    store.send(domain.command.PersistRecordCommand(join))
    await heldReadStarted.promise

    store.send(domain.command.PersistRecordCommand(leave))
    await vi.waitFor(async () => expect(await messageStore.query()).toEqual([join, leave]))
    await vi.waitFor(() => expect(store.query(domain.query.RecordListQuery())).toEqual([join, leave]))

    releaseHeldRead.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(await messageStore.query()).toEqual([join, leave])
    expect(store.query(domain.query.RecordListQuery())).toEqual([join, leave])
    expect(errors.map(({ message }) => message)).toEqual(['transient canonical query failure'])

    errorSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    await database.close()
  })

  it('retains durable history when local watch is delivered before insert returns', async () => {
    const database = createMemoryMessageDatabase(`message-list-delivered-watch-${databaseId++}`)
    const rawStore = createMessageStore(database)
    const read = database.read.bind(database)
    const write = database.write.bind(database)
    const heldReads: Array<ReturnType<typeof deferred<void>>> = []
    let watchListener: (() => void) | undefined
    const controlledDatabase: Database<MessageDatabaseSchema> = {
      read: (async (stores, operation, signal) => {
        const held = heldReads.shift()
        const result = await read(stores, operation, signal)
        if (held) {
          held.resolve()
          await held.promise
        }
        return result
      }) as typeof database.read,
      write: (async (stores, operation, signal) => {
        const result = await write(stores, operation, signal)
        watchListener?.()
        return result
      }) as typeof database.write,
      watch: (_stores, listener) => {
        watchListener = listener
        return () => {
          if (watchListener === listener) watchListener = undefined
        }
      }
    }
    const store = Remesh.store({ externs: [MessageDatabaseExtern.impl(controlledDatabase)] })
    const action = MessageListDomain()
    const domain = store.getDomain(action)
    const errors: Error[] = []
    const errorSubscription = store.subscribeEvent(domain.event.LoadFailedEvent, (error) => errors.push(error))
    const domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    await vi.waitFor(() => expect(store.query(domain.query.LoadIsFinishedQuery())).toBe(true))

    const history = textRecord('message:history', 'history')
    const live = textRecord('message:live', 'live')
    await rawStore.insert(history)

    const historyReloadStarted = deferred<void>()
    const releaseHistoryReload = deferred<void>()
    heldReads.push({ promise: releaseHistoryReload.promise, resolve: historyReloadStarted.resolve })
    store.send(domain.command.ReloadCommand())
    await historyReloadStarted.promise

    const deliveredWatchStarted = deferred<void>()
    const releaseDeliveredWatch = deferred<void>()
    heldReads.push({ promise: releaseDeliveredWatch.promise, resolve: deliveredWatchStarted.resolve })
    store.send(domain.command.PersistRecordCommand(live))
    await deliveredWatchStarted.promise

    await vi.waitFor(async () => expect(await rawStore.query()).toEqual([history, live]))
    await vi.waitFor(() => expect(store.query(domain.query.RecordListQuery())).toEqual([history, live]))

    releaseDeliveredWatch.resolve()
    releaseHistoryReload.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(await rawStore.query()).toEqual([history, live])
    expect(store.query(domain.query.RecordListQuery())).toEqual([history, live])
    expect(errors).toEqual([])

    errorSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    await database.close()
  })

  it('clears canonical records only through the explicit command', async () => {
    const harness = createHarness()
    await harness.messageStore.insert(first)
    await settle()

    harness.store.send(harness.domain.command.ClearListCommand())
    await settle()

    expect(harness.store.query(harness.domain.query.RecordListQuery())).toEqual([])
    await expect(harness.messageStore.query()).resolves.toEqual([])

    harness.errorSubscription.unsubscribe()
    harness.domainSubscription.unsubscribe()
    harness.store.discardDomain(harness.action)
  })

  it('keeps the clear lane alive after one transient write failure', async () => {
    const database = createMemoryMessageDatabase(`message-list-clear-recovery-${databaseId++}`)
    const messageStore = createMessageStore(database)
    const write = database.write.bind(database)
    let failNextWrite = false
    const failingDatabase: Database<MessageDatabaseSchema> = {
      read: database.read.bind(database),
      write: (async (stores, operation, signal) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new Error('transient clear failure')
        }
        return write(stores, operation, signal)
      }) as typeof database.write,
      watch: database.watch.bind(database)
    }
    const store = Remesh.store({ externs: [MessageDatabaseExtern.impl(failingDatabase)] })
    const action = MessageListDomain()
    const domain = store.getDomain(action)
    const errors: Error[] = []
    const syncs: Array<readonly MessageRecord[]> = []
    const errorSubscription = store.subscribeEvent(domain.event.LoadFailedEvent, (error) => errors.push(error))
    const syncSubscription = store.subscribeEvent(domain.event.SyncToStateEvent, (records) => syncs.push(records))
    const domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    await vi.waitFor(() => expect(store.query(domain.query.LoadIsFinishedQuery())).toBe(true))

    await messageStore.insert(first)
    await vi.waitFor(() => expect(store.query(domain.query.RecordListQuery())).toEqual([first]))
    syncs.length = 0

    failNextWrite = true
    store.send(domain.command.ClearListCommand())
    await vi.waitFor(() => expect(errors.map(({ message }) => message)).toEqual(['transient clear failure']))
    await vi.waitFor(() => expect(syncs).toContainEqual([first]))
    expect(await messageStore.query()).toEqual([first])
    expect(store.query(domain.query.RecordListQuery())).toEqual([first])

    store.send(domain.command.ClearListCommand())
    await vi.waitFor(async () => expect(await messageStore.query()).toEqual([]))
    await vi.waitFor(() => expect(store.query(domain.query.RecordListQuery())).toEqual([]))
    expect(errors.map(({ message }) => message)).toEqual(['transient clear failure'])

    errorSubscription.unsubscribe()
    syncSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    await database.close()
  })
})
