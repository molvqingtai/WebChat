import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { COORDINATOR_HEALTH_INTERVAL_MS, Coordinator } from '@/runtime/Coordinator'
import type { RuntimeSnapshot } from '@/runtime/Contract'

const DOMAIN_A = 'https://a.example'
const DOMAIN_B = 'https://b.example'

const snapshot = (domain: string, pageId: string): RuntimeSnapshot => ({
  hostId: 'host-a',
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [{ domain, phase: 'active', pageIds: [pageId], chatRoomJoined: true, sessions: [] }],
  world: { joined: true, peerId: 'peer-a', presences: [] }
})

const createFixture = () => {
  let hostId = 'host-a'
  let replacementPending = false
  const events: string[] = []
  const releasedPageIds: string[] = []
  const tabs = new Map([
    [1, { id: 1, url: `${DOMAIN_A}/topic#first` }],
    [2, { id: 2, url: `${DOMAIN_A}/other` }]
  ])
  const detachFailures = new Map<string, number>()
  const tabLookupFailures = new Map<number, Error>()
  let persistFailure: Error | null = null
  const delayedDetaches = new Set<string>()
  const pendingDetaches: Array<{ pageId: string; resolve: () => void }> = []
  const attachPage = vi.fn(async ({ domain, pageId }: { domain: string; pageId: string }) => {
    events.push(`attach:${domain}:${pageId}`)
    return snapshot(domain, pageId)
  })
  const detachPage = vi.fn(async ({ domain, pageId }: { domain: string; pageId: string }) => {
    events.push(`detach:${domain}:${pageId}`)
    const remaining = detachFailures.get(pageId) ?? 0
    if (remaining > 0) {
      detachFailures.set(pageId, remaining - 1)
      throw new Error(`detach failed for ${pageId}`)
    }
    if (delayedDetaches.has(pageId)) {
      await new Promise<void>((resolve) => pendingDetaches.push({ pageId, resolve }))
    }
    releasedPageIds.push(pageId)
  })
  const coordinator = new Coordinator({
    storage: {
      get: async () => ({}),
      set: async () => {
        if (!persistFailure) return
        const error = persistFailure
        persistFailure = null
        throw error
      }
    },
    ensureHostDocument: async () => {
      const created = replacementPending
      replacementPending = false
      return { phase: 'ready' as const, created }
    },
    probeHost: async () => ({ hostId, phase: 'ready' as const }),
    destroyHostDocument: async () => {},
    attachPage,
    detachPage,
    tabs: {
      get: async (tabId: number) => {
        const lookupFailure = tabLookupFailures.get(tabId)
        if (lookupFailure) throw lookupFailure
        const tab = tabs.get(tabId)
        if (!tab) throw new Error('No tab')
        return tab
      }
    }
  } as never)
  const register = (domain: string, pageId: string, tabId: number, url: string) =>
    (coordinator.registerPage as (payload: unknown) => Promise<unknown>)({
      domain,
      pageId,
      tab: { id: tabId, url }
    })
  const removeTab = (tabId: number) =>
    (coordinator as unknown as { removeTab: (tabId: number) => Promise<void> }).removeTab(tabId)

  return {
    coordinator,
    register,
    removeTab,
    tabs,
    attachPage,
    detachPage,
    events,
    releasedPageIds,
    failDetach: (pageId: string) => detachFailures.set(pageId, 1),
    failTabLookup: (tabId: number, error: Error) => tabLookupFailures.set(tabId, error),
    clearTabLookupFailure: (tabId: number) => tabLookupFailures.delete(tabId),
    failNextPersist: (error: Error) => {
      persistFailure = error
    },
    reconcileTabs: () => (coordinator as unknown as { reconcileTabs: () => Promise<void> }).reconcileTabs(),
    delayDetach: (pageId: string) => delayedDetaches.add(pageId),
    resolveNextDetach: (pageId: string) => {
      const index = pendingDetaches.findIndex((pending) => pending.pageId === pageId)
      if (index < 0) throw new Error(`No delayed detach for ${pageId}`)
      pendingDetaches.splice(index, 1)[0]!.resolve()
    },
    resolveDetaches: (pageId: string) => {
      pendingDetaches.filter((pending) => pending.pageId === pageId).forEach((pending) => pending.resolve())
      pendingDetaches.splice(
        0,
        pendingDetaches.length,
        ...pendingDetaches.filter((pending) => pending.pageId !== pageId)
      )
    },
    replaceHost: () => {
      hostId = 'host-b'
      replacementPending = true
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Coordinator trusted Tabs lifecycle', () => {
  it('keeps attempt-all rebuild evidence when one tab attachment fails', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    await fixture.register(DOMAIN_A, 'document-b', 2, `${DOMAIN_A}/other`)
    fixture.events.length = 0
    const failure = new Error('attach failed for document-b')
    fixture.attachPage.mockImplementation(async ({ domain, pageId }: { domain: string; pageId: string }) => {
      fixture.events.push(`attach:${domain}:${pageId}`)
      if (pageId === 'document-b') throw failure
      return snapshot(domain, pageId)
    })
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    fixture.replaceHost()
    await fixture.coordinator.reconcile()

    // Attempt-all rebuild continues: the failed tab keeps its original Error as a direct
    // diagnostic at the Coordinator owner while the other tab is still attached.
    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(fixture.events).toContain(`attach:${DOMAIN_A}:document-a`)
    expect(fixture.events).toContain(`attach:${DOMAIN_A}:document-b`)
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 1, pageId: 'document-a' })
    )
    diagnostic.mockRestore()
  })

  it('keeps a lookup failure diagnostic while reconciling independent tabs', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    await fixture.register(DOMAIN_A, 'document-b', 2, `${DOMAIN_A}/other`)
    const failure = new Error('tab lookup failed')
    fixture.failTabLookup(1, failure)
    fixture.tabs.set(2, { id: 2, url: `${DOMAIN_A}/updated#fragment` })
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fixture.reconcileTabs()

    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 1, pageId: 'document-a' })
    )
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 2, url: `${DOMAIN_A}/updated` })
    )
    diagnostic.mockRestore()
  })

  it('retains and retries a navigation update whose persistence fails', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_A}/updated#fragment` })
    const failure = new Error('reconciliation persistence failed')
    fixture.failNextPersist(failure)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fixture.reconcileTabs()
    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 1, url: `${DOMAIN_A}/topic` })
    )

    await fixture.reconcileTabs()
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 1, url: `${DOMAIN_A}/updated` })
    )
    diagnostic.mockRestore()
  })

  it('retains and reconciles a confirmed removal whose persistence fails', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    const failure = new Error('removal persistence failed')
    fixture.failNextPersist(failure)

    await expect(fixture.removeTab(1)).rejects.toBe(failure)
    expect(fixture.coordinator.snapshotForTest().tabs).toContainEqual(
      expect.objectContaining({ tabId: 1, pageId: 'document-a' })
    )

    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    await fixture.reconcileTabs()

    expect(fixture.coordinator.snapshotForTest().tabs).toEqual([])
    expect(fixture.detachPage).toHaveBeenCalledTimes(2)
    expect(diagnostic).not.toHaveBeenCalled()
    diagnostic.mockRestore()
  })

  it('keeps multiple same-domain tabs and releases only trusted non-last/last closes', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    await fixture.register(DOMAIN_A, 'document-b', 2, `${DOMAIN_A}/other`)

    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [
        { tabId: 1, domain: DOMAIN_A, pageId: 'document-a' },
        { tabId: 2, domain: DOMAIN_A, pageId: 'document-b' }
      ]
    })

    await fixture.removeTab(1)
    expect(fixture.detachPage).toHaveBeenCalledWith({ domain: DOMAIN_A, pageId: 'document-a' })
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 2, domain: DOMAIN_A, pageId: 'document-b' }]
    })

    await fixture.removeTab(2)
    expect(fixture.detachPage).toHaveBeenCalledWith({ domain: DOMAIN_A, pageId: 'document-b' })
    await fixture.removeTab(2)
    expect(fixture.detachPage).toHaveBeenCalledTimes(2)
  })

  it('never converts missing page health into physical tab leave', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(fixture.detachPage).not.toHaveBeenCalled()
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_A, pageId: 'document-a' }]
    })
  })

  it('reattaches reload/same-domain documents before retiring the old generation', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-old', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_A}/topic?view=new#second` })
    await fixture.register(DOMAIN_A, 'document-new', 1, `${DOMAIN_A}/topic?view=new#second`)

    expect(fixture.events).toEqual([
      `attach:${DOMAIN_A}:document-old`,
      `attach:${DOMAIN_A}:document-new`,
      `detach:${DOMAIN_A}:document-old`
    ])
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_A, pageId: 'document-new' }]
    })
  })

  it('releases a prior domain exactly once and rejects payload-only or stale tab claims', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_B}/next` })
    await fixture.register(DOMAIN_B, 'document-b', 1, `${DOMAIN_B}/next`)

    expect(fixture.events).toEqual([
      `attach:${DOMAIN_A}:document-a`,
      `attach:${DOMAIN_B}:document-b`,
      `detach:${DOMAIN_A}:document-a`
    ])

    await expect(fixture.register(DOMAIN_A, 'forged-document', 2, `${DOMAIN_A}/forged`)).rejects.toThrow()
    fixture.tabs.delete(1)
    await expect(fixture.register(DOMAIN_B, 'reused-document', 1, `${DOMAIN_B}/next`)).rejects.toThrow()
    expect(fixture.attachPage).toHaveBeenCalledTimes(2)
  })

  it('retries a one-shot tab close after transient detach failure', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.delete(1)
    fixture.failDetach('document-a')

    await expect(fixture.removeTab(1)).rejects.toThrow('detach failed for document-a')
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_A, pageId: 'document-a' }]
    })

    await vi.advanceTimersByTimeAsync(COORDINATOR_HEALTH_INTERVAL_MS)
    await vi.waitFor(() => expect(fixture.detachPage).toHaveBeenCalledTimes(2))
    expect(fixture.releasedPageIds).toEqual(['document-a'])
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({ tabs: [] })
  })

  it('joins a delayed tab close with interval reconciliation and releases it once', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.delete(1)
    fixture.delayDetach('document-a')

    const removal = fixture.removeTab(1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(COORDINATOR_HEALTH_INTERVAL_MS)

    expect.soft(fixture.detachPage).toHaveBeenCalledTimes(1)
    fixture.resolveNextDetach('document-a')
    await removal
    expect.soft(fixture.coordinator.snapshotForTest().tabs).toEqual([])
    expect.soft(fixture.releasedPageIds).toEqual(['document-a'])

    fixture.resolveDetaches('document-a')
    await vi.advanceTimersByTimeAsync(0)
  })

  it('joins a reused tab handoff with its pending old-binding release', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.delayDetach('document-a')

    const removal = fixture.removeTab(1)
    await vi.advanceTimersByTimeAsync(0)
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_B}/next` })
    const registration = fixture.register(DOMAIN_B, 'document-b', 1, `${DOMAIN_B}/next`)
    await vi.advanceTimersByTimeAsync(0)

    expect.soft(fixture.detachPage).toHaveBeenCalledTimes(1)
    fixture.resolveDetaches('document-a')
    await Promise.all([removal, registration])

    expect.soft(fixture.releasedPageIds).toEqual(['document-a'])
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_B, pageId: 'document-b' }]
    })
  })

  it('does not let a retained failed close delete a newer binding', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.delete(1)
    fixture.failDetach('document-a')
    await expect(fixture.removeTab(1)).rejects.toThrow('detach failed for document-a')

    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_B}/next` })
    await fixture.register(DOMAIN_B, 'document-b', 1, `${DOMAIN_B}/next`)
    await vi.advanceTimersByTimeAsync(COORDINATOR_HEALTH_INTERVAL_MS)

    expect(fixture.releasedPageIds).toEqual(['document-a'])
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_B, pageId: 'document-b' }]
    })
  })

  it('retains the prior binding when a handoff detach fails and replaces it only after retry', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_B}/next` })
    fixture.failDetach('document-a')

    await expect(fixture.register(DOMAIN_B, 'document-b', 1, `${DOMAIN_B}/next`)).rejects.toThrow(
      'detach failed for document-a'
    )
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_A, pageId: 'document-a' }]
    })

    await fixture.register(DOMAIN_B, 'document-b', 1, `${DOMAIN_B}/next`)
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN_B, pageId: 'document-b' }]
    })
  })

  it('reconciles a replacement host from current tabs without changing membership', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.events.length = 0

    await fixture.coordinator.reconcile()
    expect(fixture.events).toEqual([])

    fixture.replaceHost()

    await fixture.coordinator.reconcile()

    expect(fixture.events).toEqual([`attach:${DOMAIN_A}:document-a`])
    expect(fixture.detachPage).not.toHaveBeenCalled()
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      generation: 2,
      hostId: 'host-b',
      tabs: [{ tabId: 1, domain: DOMAIN_A, pageId: 'document-a' }]
    })
  })

  it('releases a binding once after reconciliation confirms lost eligibility', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.events.length = 0
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_B}/next` })

    await fixture.coordinator.reconcile()
    await fixture.coordinator.reconcile()

    expect(fixture.events).toEqual([`detach:${DOMAIN_A}:document-a`])
    expect(fixture.coordinator.snapshotForTest().tabs).toEqual([])
  })

  it('retains the physical owner across a confirmed same-domain navigation', async () => {
    const fixture = createFixture()
    await fixture.register(DOMAIN_A, 'document-a', 1, `${DOMAIN_A}/topic#first`)
    fixture.events.length = 0
    fixture.tabs.set(1, { id: 1, url: `${DOMAIN_A}/next?view=new#second` })

    await fixture.coordinator.reconcile()

    expect(fixture.events).toEqual([])
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [
        {
          tabId: 1,
          domain: DOMAIN_A,
          pageId: 'document-a',
          url: `${DOMAIN_A}/next?view=new`
        }
      ]
    })
  })

  it('uses tab activation only as a wake and reconciliation trigger', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/runtime/Background.ts'), 'utf8')

    expect(source).toContain('browser.tabs.onActivated.addListener(() => void coordinator.reconcile())')
    expect(source).not.toMatch(/onActivated\.addListener\([^\n]*(removeTab|detachPage|updateTab)/)
  })
})
