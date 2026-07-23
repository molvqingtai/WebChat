import { Remesh } from 'remesh'
import * as v from 'valibot'
import type { Database, DatabaseItem } from '@/domain/externs/Database'
import type { Unsubscribe } from '@/domain/Subscription'
import { HLCSchema, ChatMessageSchema, isMessageWithinLimit } from '@/protocol/ChatRoom'
import { ChatUserSchema, isUserWithinLimit } from '@/protocol/Session'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type MessageRecord } from '@/domain/Message'
import { MAX_CONFLICTS_PER_RECORD, MAX_STORED_CONFLICTS } from '@/constants/config'
import type { DatabaseDefinition } from '@/domain/impls/database/Definition'

export interface MessageDatabaseSchema {
  records: {
    key: string
    value: unknown
    indexes: Record<never, never>
  }
  conflicts: {
    key: string
    value: unknown
    indexes: { byEventId: string }
  }
}

export const createMessageDatabaseDefinition = (
  name: string,
  version: number
): DatabaseDefinition<MessageDatabaseSchema> => ({
  name,
  version,
  channelName: `${name}:WATCH`,
  stores: {
    records: { key: 'string', introducedIn: 1, indexes: {} },
    conflicts: {
      key: 'string',
      introducedIn: 1,
      indexes: { byEventId: { key: 'string', keyPath: 'eventId', introducedIn: 2 } }
    }
  }
})

export type InsertMessageResult =
  | { readonly inserted: true }
  | { readonly inserted: false; readonly existing: MessageRecord }

export type MessageQuery = Readonly<{
  type?: MessageRecord['type']
  signal?: AbortSignal
}>

export interface MessageStore {
  insert(record: MessageRecord): Promise<InsertMessageResult>
  query(query?: MessageQuery): Promise<readonly MessageRecord[]>
  clear(): Promise<void>
  watch(listener: () => void): Unsubscribe
}

const validateMessageQuery = (input: MessageQuery | undefined): MessageQuery => {
  if (input === undefined) return {}
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  ) {
    throw new TypeError('Message query must be a plain object')
  }
  if (Reflect.ownKeys(input).some((key) => key !== 'type' && key !== 'signal')) {
    throw new TypeError('Message query contains an unknown field')
  }
  if (
    input.type !== undefined &&
    input.type !== MESSAGE_RECORD_TYPE.CHAT_MESSAGE &&
    input.type !== MESSAGE_RECORD_TYPE.SYSTEM_NOTICE
  ) {
    throw new TypeError('Message query contains an invalid record type')
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new TypeError('Message query signal must be an AbortSignal')
  }
  return input
}

const unavailable = (): never => {
  throw new Error('Database is not implemented')
}

export const MessageDatabaseExtern = Remesh.extern<Database<MessageDatabaseSchema>>({
  default: {
    read: unavailable,
    write: unavailable,
    watch: unavailable,
    close: unavailable
  }
})

const finiteNumber = v.pipe(
  v.number(),
  v.check((value) => Number.isFinite(value), 'Expected a finite number')
)

const ChatMessageRecordSchema = v.strictObject({
  type: v.literal(MESSAGE_RECORD_TYPE.CHAT_MESSAGE),
  id: v.string(),
  message: ChatMessageSchema,
  user: ChatUserSchema,
  receivedAt: finiteNumber
})

const NoticeSchema = v.strictObject({
  id: v.string(),
  hlc: HLCSchema,
  type: v.picklist([NOTICE_TYPE.JOIN, NOTICE_TYPE.LEAVE, NOTICE_TYPE.INFO]),
  body: v.string()
})

const SystemNoticeRecordSchema = v.strictObject({
  type: v.literal(MESSAGE_RECORD_TYPE.SYSTEM_NOTICE),
  id: v.string(),
  notice: NoticeSchema,
  user: ChatUserSchema,
  receivedAt: finiteNumber
})

const MessageRecordSchema = v.variant('type', [ChatMessageRecordSchema, SystemNoticeRecordSchema])

const decodeMessageRecord = (item: DatabaseItem<string, unknown>): MessageRecord => {
  const parsed = v.safeParse(MessageRecordSchema, item.value)
  if (!parsed.success) throw new TypeError('Database contains an invalid MessageRecord')
  const record = parsed.output as MessageRecord
  if (item.key !== record.id) throw new TypeError('Database item key does not match record id')
  if (!isUserWithinLimit(record.user)) throw new TypeError('MessageRecord user exceeds protocol limits')
  if (record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE) {
    if (record.id !== record.message.id) throw new TypeError('Chat record id does not match message id')
    if (record.user.id !== record.message.userId) {
      throw new TypeError('Chat record user does not match message user')
    }
    if (!isMessageWithinLimit(record.message)) throw new TypeError('Chat record message exceeds protocol limits')
  } else if (record.id !== record.notice.id) {
    throw new TypeError('System notice record id does not match notice id')
  }
  return record
}

const canonicalContent = (record: MessageRecord): unknown =>
  record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE
    ? { type: record.type, id: record.id, message: record.message, user: record.user }
    : { type: record.type, id: record.id, notice: record.notice, user: record.user }

const canonicalJson = (record: MessageRecord): string => JSON.stringify(canonicalContent(record))

const contentEquals = (left: MessageRecord, right: MessageRecord): boolean =>
  canonicalJson(left) === canonicalJson(right)

const hashString = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

interface StoredConflict {
  /** Preserved v2 physical index key path; its value is the outer record id. */
  eventId: string
  incomingHash: string
  existing: MessageRecord
  incoming: MessageRecord
  recordedAt: number
}

const decodeInput = (record: MessageRecord): MessageRecord => decodeMessageRecord({ key: record.id, value: record })

export const createMessageStore = (database: Database<MessageDatabaseSchema>): MessageStore => ({
  insert: async (input) => {
    const record = decodeInput(input)
    return database.write(['records', 'conflicts'], async (transaction) => {
      const result = await transaction.insert('records', record.id, record)
      if (result.inserted) return { inserted: true }
      const existing = decodeMessageRecord({ key: record.id, value: result.existing })
      if (contentEquals(existing, record)) return { inserted: false, existing }

      const incomingHash = hashString(canonicalJson(record))
      const conflictKey = `${record.id}:${incomingHash}`
      const duplicate = await transaction.get('conflicts', conflictKey)
      if (!duplicate) {
        const [total, forRecord] = await Promise.all([
          transaction.count('conflicts'),
          transaction.count('conflicts', { index: 'byEventId', range: { lower: record.id, upper: record.id } })
        ])
        if (total < MAX_STORED_CONFLICTS && forRecord < MAX_CONFLICTS_PER_RECORD) {
          const conflict: StoredConflict = {
            eventId: record.id,
            incomingHash,
            existing,
            incoming: record,
            recordedAt: Date.now()
          }
          await transaction.insert('conflicts', conflictKey, conflict)
        }
      }
      return { inserted: false, existing }
    })
  },

  query: async (input) => {
    const { type, signal } = validateMessageQuery(input)
    signal?.throwIfAborted()
    const items = await database.read(['records'], (transaction) => transaction.scan('records'), signal)
    const records: MessageRecord[] = []
    for (const item of items) {
      signal?.throwIfAborted()
      records.push(decodeMessageRecord(item))
      signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
    if (type === undefined) return records
    const filtered = records.filter((record) => {
      signal?.throwIfAborted()
      return record.type === type
    })
    signal?.throwIfAborted()
    return filtered
  },

  clear: () =>
    database.write(['records', 'conflicts'], async (transaction) => {
      await Promise.all([transaction.clear('records'), transaction.clear('conflicts')])
    }),

  watch: (listener) => database.watch(['records'], listener)
})
