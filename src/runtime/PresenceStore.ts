import * as v from 'valibot'
import { ChatUserSchema } from '@/protocol/Session'
import {
  MAX_PRESENCE_OBSERVATIONS,
  type PresenceDomainRecord,
  type PresenceStore
} from '@/domain/runtime/externs/PresenceStore'
import stringToHex from '@/utils/stringToHex'

const PRESENCE_STORAGE_PREFIX = 'WEB_CHAT_RUNTIME_PRESENCE_V1'
const PRESENCE_STORE_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_PRESENCE_STORE_V1'
export const presenceStoreNamespace = (runtimeId: string) => `${PRESENCE_STORE_NAMESPACE_PREFIX}:${runtimeId}`

const boundedId = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const domainOrigin = v.pipe(v.string(), v.minLength(1), v.maxLength(2048))
const safeNonNegativeInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const LocalPresenceLeaseSchema = v.strictObject({
  presenceId: boundedId,
  userId: boundedId,
  joinedAt: safeNonNegativeInteger,
  status: v.picklist(['pending', 'active'])
})
const PendingPresenceEndSchema = v.strictObject({
  presenceId: boundedId,
  userId: boundedId,
  joinedAt: safeNonNegativeInteger
})
const ObservedPresenceSchema = v.strictObject({
  presenceId: boundedId,
  sessionId: boundedId,
  user: ChatUserSchema,
  joinedAt: safeNonNegativeInteger,
  status: v.picklist(['active', 'ended'])
})
const PresenceDomainRecordSchema = v.pipe(
  v.strictObject({
    domain: domainOrigin,
    lastJoinedAt: safeNonNegativeInteger,
    local: v.optional(LocalPresenceLeaseSchema),
    inflightEnd: v.optional(PendingPresenceEndSchema),
    pendingEnd: v.optional(PendingPresenceEndSchema),
    settledEnd: v.optional(PendingPresenceEndSchema),
    observers: v.pipe(v.array(ObservedPresenceSchema), v.maxLength(MAX_PRESENCE_OBSERVATIONS))
  }),
  v.check(
    (record) => [record.local, record.inflightEnd, record.pendingEnd, record.settledEnd].filter(Boolean).length <= 1,
    'Presence lease and final-end states are mutually exclusive'
  )
)

interface SessionStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const storageKey = (domain: string) => `${PRESENCE_STORAGE_PREFIX}:${stringToHex(domain)}`
const clone = <Value>(value: Value): Value => structuredClone(value)
const parsePresenceRecord = (record: unknown): PresenceDomainRecord => {
  const parsed = v.safeParse(PresenceDomainRecordSchema, record)
  if (!parsed.success) throw new Error('Invalid Runtime presence record')
  return parsed.output
}

export const createBrowserPresenceStore = (storage: SessionStorage): PresenceStore => {
  const tails = new Map<string, Promise<void>>()
  return {
    load: async (domain) => {
      await tails.get(domain)?.catch(() => {})
      const key = storageKey(domain)
      const parsed = v.safeParse(PresenceDomainRecordSchema, (await storage.get(key))[key])
      return parsed.success && parsed.output.domain === domain ? clone(parsed.output) : null
    },
    save: async (record) => {
      const parsed = parsePresenceRecord(record)
      const task = (tails.get(record.domain) ?? Promise.resolve())
        .catch(() => {})
        .then(() => storage.set({ [storageKey(record.domain)]: clone(parsed) }))
      tails.set(record.domain, task)
      await task
    }
  }
}

export const createMemoryPresenceStore = (): PresenceStore => {
  const records = new Map<string, PresenceDomainRecord>()
  return {
    load: async (domain) => clone(records.get(domain) ?? null),
    save: async (record) => {
      const parsed = parsePresenceRecord(record)
      records.set(record.domain, clone(parsed))
    }
  }
}
