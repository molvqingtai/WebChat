import { Remesh } from 'remesh'
import * as v from 'valibot'
import type { Database, DatabaseItem } from '@/domain/externs/Database'
import type { Unsubscribe } from '@/domain/Subscription'
import { ChatMessageSchema, HLCSchema } from '@/protocol/ChatRoom'
import { ChatUserSchema } from '@/protocol/Session'
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
  | { readonly inserted: false; readonly existing: MessageRecord | unknown }

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

type MessageInsertOptions = Readonly<{ signal?: AbortSignal }>

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

// The local persistence-load boundary: the record schema composes the authoritative protocol
// schema (declarative structure and ceilings) with the local-only record fields, so one schema
// parse accepts or rejects a whole stored item. Relationships the declarative schema cannot
// express (key/identity equality) are not validated.
const finiteNumber = v.pipe(v.number(), v.finite())

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

class InvalidMessageRecordError extends TypeError {
  override readonly name = 'InvalidMessageRecordError'
}

export const isInvalidMessageRecordError = (error: unknown): error is InvalidMessageRecordError =>
  error instanceof InvalidMessageRecordError

const invalidMessageRecord = (message: string): never => {
  throw new InvalidMessageRecordError(message)
}

const decodeMessageRecord = (item: DatabaseItem<string, unknown>): MessageRecord => {
  const parsed = v.safeParse(MessageRecordSchema, item.value)
  if (!parsed.success) return invalidMessageRecord('Database contains an invalid MessageRecord')
  return parsed.output
}

const safeDecodeMessageRecord = (
  item: DatabaseItem<string, unknown>
): { success: true; record: MessageRecord } | { success: false; error: InvalidMessageRecordError } => {
  try {
    return { success: true, record: decodeMessageRecord(item) }
  } catch (error) {
    if (!isInvalidMessageRecordError(error)) throw error
    return { success: false, error }
  }
}

const canonicalContent = (record: MessageRecord): unknown =>
  record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE
    ? { type: record.type, id: record.id, message: record.message, user: record.user }
    : { type: record.type, id: record.id, notice: record.notice, user: record.user }

const canonicalJson = (record: MessageRecord): string => JSON.stringify(canonicalContent(record))

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
  /** Raw stored value preserved as a private diagnostic; never protocol-validated. */
  existing: unknown
  incoming: MessageRecord
  recordedAt: number
}

/** Invalid physical rows stay untouched; conflicts is the existing bounded private diagnostic sink. */
interface InvalidStoredRecord {
  item: DatabaseItem<string, unknown>
  error: InvalidMessageRecordError
}

interface StoredInvalidRecordDiagnostic {
  eventId: string
  invalidHash: string
  reason: string
  recordedAt: number
}

const retainInvalidRecordDiagnostics = async (
  database: Database<MessageDatabaseSchema>,
  invalidRecords: readonly InvalidStoredRecord[],
  signal?: AbortSignal
): Promise<void> => {
  await database.write(
    ['conflicts'],
    async (transaction) => {
      const existing = await transaction.scan('conflicts')
      let total = existing.length
      const keys = new Set(existing.map(({ key }) => key))
      const counts = new Map<string, number>()
      for (const { value } of existing) {
        if (typeof value !== 'object' || value === null) continue
        const eventId = (value as { eventId?: unknown }).eventId
        if (typeof eventId === 'string') counts.set(eventId, (counts.get(eventId) ?? 0) + 1)
      }
      for (const { item, error } of invalidRecords) {
        signal?.throwIfAborted()
        if (total >= MAX_STORED_CONFLICTS) return
        const invalidHash = hashString(JSON.stringify(item.value))
        const diagnosticKey = `invalid-record:${item.key}:${invalidHash}`
        if (keys.has(diagnosticKey)) continue
        const count = counts.get(item.key) ?? 0
        if (count >= MAX_CONFLICTS_PER_RECORD) continue
        const diagnostic: StoredInvalidRecordDiagnostic = {
          eventId: item.key,
          invalidHash,
          reason: error.message,
          recordedAt: Date.now()
        }
        const result = await transaction.insert('conflicts', diagnosticKey, diagnostic)
        if (!result.inserted) continue
        keys.add(diagnosticKey)
        counts.set(item.key, count + 1)
        total += 1
      }
    },
    signal
  )
}

const reportedDiagnosticFailures = new WeakSet<Database<MessageDatabaseSchema>>()

export const createMessageStore = (database: Database<MessageDatabaseSchema>): MessageStore => ({
  insert: async (input, { signal }: MessageInsertOptions = {}) => {
    const record = input
    signal?.throwIfAborted()
    return database.write(
      ['records', 'conflicts'],
      async (transaction) => {
        const result = await transaction.insert('records', record.id, record)
        if (result.inserted) return { inserted: true }
        // Duplicate handling stays on the write path: the stored raw value is compared by
        // content without any protocol parse or property/resource validation. A trusted typed
        // existing value is derived only from the typed input; any other stored occupant is a
        // conflict and is never exposed as a typed record.
        const existing = result.existing
        if (JSON.stringify(existing) === JSON.stringify(record)) return { inserted: false, existing: record }

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
      },
      signal
    )
  },

  query: async (input) => {
    const { type, signal } = validateMessageQuery(input)
    signal?.throwIfAborted()
    const items = await database.read(['records'], (transaction) => transaction.scan('records'), signal)
    const records: MessageRecord[] = []
    const invalidRecords: InvalidStoredRecord[] = []
    for (const item of items) {
      signal?.throwIfAborted()
      const decoded = safeDecodeMessageRecord(item)
      if (decoded.success) records.push(decoded.record)
      else invalidRecords.push({ item, error: decoded.error })
      signal?.throwIfAborted()
    }
    if (invalidRecords.length > 0) {
      try {
        await retainInvalidRecordDiagnostics(database, invalidRecords, signal)
      } catch (error) {
        signal?.throwIfAborted()
        if (!reportedDiagnosticFailures.has(database)) {
          reportedDiagnosticFailures.add(database)
          console.warn('[WebChat] Failed to retain invalid MessageRecord diagnostics:', error)
        }
      }
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
