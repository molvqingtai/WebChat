import { describe, expect, it } from 'vitest'
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
const pendingEndRecord: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 10,
  pendingEnd: { presenceId: 'local-generation', userId: 'local-user', joinedAt: 10 },
  observers: record.observers
}
const inflightEndRecord: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 10,
  inflightEnd: { presenceId: 'local-generation', userId: 'local-user', joinedAt: 10 },
  observers: record.observers
}
const settledEndRecord: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 10,
  settledEnd: { presenceId: 'local-generation', userId: 'local-user', joinedAt: 10 },
  observers: record.observers
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

  it('retains mutually exclusive active, unsettled-end, and settled-cleanup generations', async () => {
    const store = createMemoryPresenceStore()
    await store.save(inflightEndRecord)
    await expect(store.load(DOMAIN)).resolves.toEqual(inflightEndRecord)
    await expect(store.save({ ...inflightEndRecord, pendingEnd: pendingEndRecord.pendingEnd })).rejects.toThrow(
      'Invalid Runtime presence record'
    )
    await expect(store.load(DOMAIN)).resolves.toEqual(inflightEndRecord)

    await store.save(pendingEndRecord)
    await expect(store.load(DOMAIN)).resolves.toEqual(pendingEndRecord)
    await expect(store.save({ ...pendingEndRecord, settledEnd: settledEndRecord.settledEnd })).rejects.toThrow(
      'Invalid Runtime presence record'
    )
    await expect(store.load(DOMAIN)).resolves.toEqual(pendingEndRecord)

    await store.save(settledEndRecord)
    await expect(store.load(DOMAIN)).resolves.toEqual(settledEndRecord)
    await expect(store.save({ ...settledEndRecord, local: record.local })).rejects.toThrow(
      'Invalid Runtime presence record'
    )
    await expect(store.load(DOMAIN)).resolves.toEqual(settledEndRecord)
  })

  it('enforces the bounded observer ledger', async () => {
    const store = createMemoryPresenceStore()
    const observers = Array.from({ length: 512 }, (_, index) => ({
      ...record.observers[0],
      presenceId: `remote-generation-${index}`,
      sessionId: `remote-session-${index}`
    }))

    await expect(store.save({ ...record, observers })).resolves.toBeUndefined()
    await expect(
      store.save({
        ...record,
        observers: [
          ...observers,
          { ...record.observers[0], presenceId: 'overflow-generation', sessionId: 'overflow-session' }
        ]
      })
    ).rejects.toThrow('Invalid Runtime presence record')
    await expect(store.load(DOMAIN)).resolves.toEqual({ ...record, observers })
  })

  it('rejects invalid state before replacing a valid generation', async () => {
    const store = createMemoryPresenceStore()
    await store.save(record)
    await expect(
      store.save({ ...record, local: { ...record.local!, status: 'unknown' } } as unknown as PresenceDomainRecord)
    ).rejects.toThrow('Invalid Runtime presence record')
    await expect(store.load(DOMAIN)).resolves.toEqual(record)
  })
})
