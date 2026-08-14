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

/**
 * Structural (order-insensitive) deep equality over plain data comparing every own key.
 */
const plainDataEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => plainDataEqual(item, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.hasOwn(rightRecord, key) && plainDataEqual(leftRecord[key], rightRecord[key]))
}

/**
 * Persistence-write duplicate decision: the receiver-local top-level `receivedAt` metadata key
 * is excluded at the ROOT only; every nested own key is compared structurally and
 * order-independently, so any nested difference is a conflict.
 */
const replayEqualExcludingRootReceivedAt = (left: unknown, right: unknown): boolean => {
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return left === right
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => plainDataEqual(item, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).filter((key) => key !== 'receivedAt')
  const rightKeys = Object.keys(rightRecord).filter((key) => key !== 'receivedAt')
  if (leftKeys.length !== rightKeys.length) return false
  return (
    leftKeys.every((key) => Object.hasOwn(rightRecord, key) && plainDataEqual(leftRecord[key], rightRecord[key])) &&
    rightKeys.every((key) => Object.hasOwn(leftRecord, key))
  )
}

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
  const hash = value.split('').reduce((acc, char) => Math.imul(acc ^ char.charCodeAt(0), 16777619), 2166136261)
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
      const eventIds = existing.flatMap(({ value }) => {
        if (typeof value !== 'object' || value === null) return []
        const eventId = (value as { eventId?: unknown }).eventId
        return typeof eventId === 'string' ? [eventId] : []
      })
      const counts = eventIds.reduce<Map<string, number>>((acc, eventId) => {
        const current = acc.get(eventId) ?? 0
        return new Map([...acc, [eventId, current + 1]])
      }, new Map())
      // functional-loop: early-return — the stored-conflict cap must stop the persistence walk
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
        // content without any protocol parse or property/resource validation. `receivedAt` is
        // receiver-local metadata, not canonical record identity: a same-ID value identical
        // except for the top-level `receivedAt` is a replay (keep the first row, no conflict),
        // and a trusted typed existing is derived only from the typed input. Any other stored
        // occupant is a conflict and is never exposed as a typed record.
        const existing = result.existing
        if (replayEqualExcludingRootReceivedAt(existing, record)) {
          return { inserted: false, existing: record }
        }

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
    // functional-loop: owner-commit — ordered per-item decode with abort checks and no bulk primitive
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
