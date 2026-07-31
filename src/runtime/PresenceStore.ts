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

interface DomainPersistenceState {
  revision: number
  desired: PresenceDomainRecord | null
  tail: Promise<void>
}

export const createBoundedPresenceStore = (store: PresenceStore): PresenceStore => {
  const existing = boundedStores.get(store)
  if (existing) return existing
  const states = new Map<string, DomainPersistenceState>()
  const stateFor = (domain: string) => {
    let state = states.get(domain)
    if (!state) {
      state = { revision: 0, desired: null, tail: Promise.resolve() }
      states.set(domain, state)
    }
    return state
  }

  const persistPhysical = async (domain: string, record: PresenceDomainRecord, revision: number) => {
    let timedOut = false
    const physical = Promise.resolve().then(() => store.save(clone(record)))
    void physical.then(
      () => {
        if (timedOut) restoreLatest(domain, revision)
      },
      () => {}
    )
    await withDeadline(physical, () => {
      timedOut = true
    })
  }

  function restoreLatest(domain: string, staleRevision: number) {
    const state = stateFor(domain)
    if (state.revision <= staleRevision || !state.desired) return
    const revision = state.revision
    const desired = clone(state.desired)
    const restore = state.tail
      .catch(() => {})
      .then(async () => {
        if (state.revision !== revision) return
        await persistPhysical(domain, desired, revision)
      })
    state.tail = restore
    void restore.catch(() => {})
  }

  const bounded: PresenceStore = {
    load: async (domain) => {
      await stateFor(domain).tail.catch(() => {})
      return withDeadline(Promise.resolve().then(() => store.load(domain)))
    },
    save: async (record) => {
      const parsed = clone(parsePresenceRecord(record))
      const state = stateFor(parsed.domain)
      const revision = state.revision + 1
      state.revision = revision
      state.desired = parsed
      const task = state.tail.catch(() => {}).then(() => persistPhysical(parsed.domain, parsed, revision))
      state.tail = task
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
