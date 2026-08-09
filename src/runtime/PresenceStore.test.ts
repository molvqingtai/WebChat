import { describe, expect, it, vi } from 'vitest'
import type { PresenceDomainRecord } from '@/domain/runtime/externs/PresenceStore'
import { createBrowserPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'

const DOMAIN = 'https://example.test'
const record: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 10,
  local: { presenceId: 'local-generation', userId: 'local-user', joinedAt: 10, status: 'active' },
  observers: [
    {
      presenceId: 'remote-generation',
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      joinedAt: 9,
      status: 'active'
    }
  ]
}

describe('presence store', () => {
  it('keeps private lifecycle state reusable across Runtime host replacement', async () => {
    const store = createMemoryPresenceStore()
    await store.save(record)

    const loaded = await store.load(DOMAIN)
    expect(loaded).toEqual(record)
    loaded!.observers[0].status = 'ended'
    await expect(store.load(DOMAIN)).resolves.toEqual(record)
  })

  it('strictly persists and reloads browser session-storage records', async () => {
    const values: Record<string, unknown> = {}
    const storage = {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(values, items)
      }
    }
    await createBrowserPresenceStore(storage).save(record)

    await expect(createBrowserPresenceStore(storage).load(DOMAIN)).resolves.toEqual(record)
    const [key] = Object.keys(values)
    values[key] = { ...record, unknown: true }
    await expect(createBrowserPresenceStore(storage).load(DOMAIN)).resolves.toBeNull()
  })

  it('does not compare the requested domain with the stored record domain', async () => {
    const values: Record<string, unknown> = {}
    const store = createBrowserPresenceStore({
      get: async (_key) => values,
      set: async (items) => {
        Object.assign(values, items)
      }
    })
    await store.save(record)
    // A stored record whose domain differs from the requested domain is still returned: that
    // relationship is not expressible declaratively and is not validated.
    const [key] = Object.keys(values)
    values[key] = { ...record, domain: 'https://other.example' }
    await expect(store.load(DOMAIN)).resolves.toEqual({ ...record, domain: 'https://other.example' })
  })

  it('does not parse invalid typed values in the memory store (zero parse)', async () => {
    const store = createMemoryPresenceStore()
    // Typed save trusts its input; the memory store never parses, so an invalid status value
    // round-trips as-is.
    const invalid = { ...record, local: { ...record.local!, status: 'unknown' } } as unknown as PresenceDomainRecord
    await store.save(invalid)
    await expect(store.load(DOMAIN)).resolves.toEqual(invalid)
  })

  it('enforces the bounded observer ledger at the durable load boundary', async () => {
    const values: Record<string, unknown> = {}
    const store = createBrowserPresenceStore({
      get: async (_key) => values,
      set: async (items) => {
        Object.assign(values, items)
      }
    })
    const observers = Array.from({ length: 512 }, (_, index) => ({
      ...record.observers[0],
      presenceId: `remote-generation-${index}`,
      sessionId: `remote-session-${index}`
    }))

    // Typed save trusts its input (no parse on the write path); the declarative ledger ceiling
    // is enforced when the durable value is loaded.
    await expect(store.save({ ...record, observers })).resolves.toBeUndefined()
    await store.save({
      ...record,
      observers: [
        ...observers,
        { ...record.observers[0], presenceId: 'overflow-generation', sessionId: 'overflow-session' }
      ]
    })
    await expect(store.load(DOMAIN)).resolves.toBeNull()
  })

  it('trusts typed saves and isolates an invalid generation at the durable load boundary', async () => {
    const values: Record<string, unknown> = {}
    const store = createBrowserPresenceStore({
      get: async (_key) => values,
      set: async (items) => {
        Object.assign(values, items)
      }
    })
    await store.save(record)
    // Typed save trusts its input; the invalid status value is stored but is omitted at load by
    // the declarative schema (no typed write is rejected).
    await store.save({ ...record, local: { ...record.local!, status: 'unknown' } } as unknown as PresenceDomainRecord)
    await expect(store.load(DOMAIN)).resolves.toBeNull()
  })

  it('serializes per-domain saves and the newest record wins after a held first write', async () => {
    const values: Record<string, unknown> = {}
    const releaseFirst = Promise.withResolvers<void>()
    let writeCount = 0
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        writeCount += 1
        if (writeCount === 1) await releaseFirst.promise
        Object.assign(values, items)
      })
    }
    const store = createBrowserPresenceStore(storage)
    const newer: PresenceDomainRecord = {
      ...record,
      lastJoinedAt: 20,
      local: { ...record.local!, presenceId: 'newer-generation', joinedAt: 20 }
    }
    const first = store.save(record)
    const second = store.save(newer)
    releaseFirst.resolve()
    await Promise.allSettled([first, second])
    // Writes are serialized per domain so the newest record lands last and wins.
    await expect(store.load(DOMAIN)).resolves.toEqual(newer)
  })
})
