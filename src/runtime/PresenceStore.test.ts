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

  it('bounds a stale per-domain save and restores the newest record after its late completion', async () => {
    vi.useFakeTimers()
    const values: Record<string, unknown> = {}
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    let writeCount = 0
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        writeCount += 1
        if (writeCount === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        Object.assign(values, items)
      })
    }
    const store = createBrowserPresenceStore(storage)
    const newer: PresenceDomainRecord = {
      ...record,
      lastJoinedAt: 20,
      local: { ...record.local!, presenceId: 'newer-generation', joinedAt: 20 }
    }
    let firstError: Error | null = null
    let secondSettled = false
    const first = store.save(record).catch((error: Error) => {
      firstError = error
    })
    await firstStarted.promise
    const second = store.save(newer).then(() => {
      secondSettled = true
    })

    try {
      await vi.advanceTimersByTimeAsync(5001)

      expect(firstError).toEqual(new Error('Presence store operation timed out'))
      expect(secondSettled).toBe(true)

      releaseFirst.resolve()
      await Promise.allSettled([first, second])
      await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(3))
      await expect(store.load(DOMAIN)).resolves.toEqual(newer)
    } finally {
      releaseFirst.resolve()
      await Promise.allSettled([first, second])
      vi.useRealTimers()
    }
  })

  it('fences a late timed-out restoration behind the newest revision', async () => {
    vi.useFakeTimers()
    const values: Record<string, unknown> = {}
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const restorationStarted = Promise.withResolvers<void>()
    const releaseRestoration = Promise.withResolvers<void>()
    let writeCount = 0
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        writeCount += 1
        if (writeCount === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        } else if (writeCount === 3) {
          restorationStarted.resolve()
          await releaseRestoration.promise
        }
        Object.assign(values, items)
      })
    }
    const store = createBrowserPresenceStore(storage)
    const secondRecord: PresenceDomainRecord = {
      ...record,
      lastJoinedAt: 20,
      local: { ...record.local!, presenceId: 'second-generation', joinedAt: 20 }
    }
    const newestRecord: PresenceDomainRecord = {
      ...record,
      lastJoinedAt: 30,
      local: { ...record.local!, presenceId: 'newest-generation', joinedAt: 30 }
    }
    const first = store.save(record).catch(() => {})
    await firstStarted.promise
    const second = store.save(secondRecord)
    let newest: Promise<void> | null = null

    try {
      await vi.advanceTimersByTimeAsync(5001)
      await second

      releaseFirst.resolve()
      await restorationStarted.promise
      newest = store.save(newestRecord)
      await vi.advanceTimersByTimeAsync(5001)
      await newest

      releaseRestoration.resolve()
      await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(5))
      await expect(store.load(DOMAIN)).resolves.toEqual(newestRecord)
    } finally {
      releaseFirst.resolve()
      releaseRestoration.resolve()
      await Promise.allSettled([first, second, ...(newest ? [newest] : [])])
      vi.useRealTimers()
    }
  })
})
