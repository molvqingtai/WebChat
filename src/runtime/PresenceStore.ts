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
const PRESENCE_STORE_OPERATION_TIMEOUT_MS = 5000
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
const ObservedPresenceSchema = v.strictObject({
  presenceId: boundedId,
  sessionId: boundedId,
  user: ChatUserSchema,
  joinedAt: safeNonNegativeInteger,
  status: v.picklist(['active', 'ended'])
})
const PresenceDomainRecordSchema = v.strictObject({
  domain: domainOrigin,
  lastJoinedAt: safeNonNegativeInteger,
  local: v.optional(LocalPresenceLeaseSchema),
  observers: v.pipe(v.array(ObservedPresenceSchema), v.maxLength(MAX_PRESENCE_OBSERVATIONS))
})

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

const boundedStores = new WeakMap<PresenceStore, PresenceStore>()

const withDeadline = <Value>(task: Promise<Value>, onTimeout?: () => void): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      callback()
    }
    const timer = globalThis.setTimeout(
      () =>
        finish(() => {
          onTimeout?.()
          reject(new Error('Presence store operation timed out'))
        }),
      PRESENCE_STORE_OPERATION_TIMEOUT_MS
    )
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })

interface TailState {
  tail: Promise<void>
}

/**
 * Bounds every read/write with a deadline and serializes writes per domain. Absorbed into the
 * underlying store; there is no durable owner/outcome/cleanup-journal or compare-and-swap recovery
 * (round contract forbids it); the only durable presence state is the current `local` lease.
 */
export const createBoundedPresenceStore = (store: PresenceStore): PresenceStore => {
  const existing = boundedStores.get(store)
  if (existing) return existing
  const states = new Map<string, TailState>()
  const stateFor = (domain: string): TailState => {
    let state = states.get(domain)
    if (!state) {
      state = { tail: Promise.resolve() }
      states.set(domain, state)
    }
    return state
  }

  const bounded: PresenceStore = {
    load: async (domain) => {
      await stateFor(domain).tail.catch(() => {})
      return withDeadline(Promise.resolve().then(() => store.load(domain)))
    },
    save: async (record) => {
      const parsed = clone(parsePresenceRecord(record))
      const task = stateFor(parsed.domain)
        .tail.catch(() => {})
        .then(() => withDeadline(Promise.resolve().then(() => store.save(clone(parsed)))))
      stateFor(parsed.domain).tail = task
      await task
    }
  }
  boundedStores.set(store, bounded)
  boundedStores.set(bounded, bounded)
  return bounded
}

export const createBrowserPresenceStore = (storage: SessionStorage): PresenceStore => {
  const store: PresenceStore = {
    load: async (domain) => {
      const key = storageKey(domain)
      const parsed = v.safeParse(PresenceDomainRecordSchema, (await storage.get(key))[key])
      return parsed.success && parsed.output.domain === domain ? clone(parsed.output) : null
    },
    save: async (record) => {
      const parsed = parsePresenceRecord(record)
      await storage.set({ [storageKey(record.domain)]: clone(parsed) })
    }
  }
  return createBoundedPresenceStore(store)
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
