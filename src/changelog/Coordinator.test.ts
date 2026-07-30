import { describe, expect, it, vi } from 'vitest'
import {
  ChangelogCoordinator,
  acknowledgeChangelogVersion,
  type ChangelogInstallDetails,
  type ChangelogState,
  type ChangelogStateStore,
  type ChangelogTab,
  type ChangelogTabs
} from './Coordinator'

const VERSION = '2.0.1'

class MemoryStateStore implements ChangelogStateStore {
  value: unknown
  writes: ChangelogState[] = []
  readFailure = false
  writeFailure = false

  constructor(value?: unknown) {
    this.value = value
  }

  async read() {
    if (this.readFailure) throw new Error('private read detail')
    return structuredClone(this.value)
  }

  async write(state: ChangelogState) {
    if (this.writeFailure) throw new Error('private write detail')
    this.value = structuredClone(state)
    this.writes.push(structuredClone(state))
  }
}

class MemoryTabs implements ChangelogTabs {
  live: ChangelogTab[] = []
  creates = 0
  focuses: ChangelogTab[] = []
  findFailure = false
  createFailure = false

  async find() {
    if (this.findFailure) throw new Error('private query detail')
    return this.live[0]
  }

  async focus(tab: ChangelogTab) {
    this.focuses.push(tab)
  }

  async create() {
    if (this.createFailure) throw new Error('private create detail')
    this.creates += 1
    this.live.push({ id: this.creates, windowId: 1 })
  }
}

const state = (overrides: Partial<ChangelogState> = {}): ChangelogState => ({
  observedVersion: VERSION,
  shownVersions: [],
  ...overrides
})

const setup = (stored?: unknown) => {
  const store = new MemoryStateStore(stored)
  const tabs = new MemoryTabs()
  const log = vi.fn()
  const coordinator = new ChangelogCoordinator({ currentVersion: () => VERSION, store, tabs, log })

  return { coordinator, store, tabs, log }
}

describe('ChangelogCoordinator', () => {
  it('registers the install listener synchronously before startup reconciliation settles', async () => {
    let resolveRead!: (value: unknown) => void
    const pendingRead = new Promise<unknown>((resolve) => (resolveRead = resolve))
    const store: ChangelogStateStore = {
      read: () => pendingRead,
      write: vi.fn(async () => {})
    }
    const tabs = new MemoryTabs()
    const coordinator = new ChangelogCoordinator({ currentVersion: () => VERSION, store, tabs })
    let listener: ((details: ChangelogInstallDetails) => void) | undefined
    const runtime = {
      onInstalled: {
        addListener: vi.fn((next: (details: ChangelogInstallDetails) => void) => (listener = next))
      }
    }

    const startup = coordinator.start(runtime)

    expect(runtime.onInstalled.addListener).toHaveBeenCalledTimes(1)
    expect(listener).toBeTypeOf('function')
    resolveRead(undefined)
    await startup
  })

  it('establishes a quiet baseline for missing or malformed state', async () => {
    for (const stored of [undefined, { observedVersion: VERSION, shownVersions: [VERSION, VERSION] }]) {
      const { coordinator, store, tabs } = setup(stored)

      await coordinator.reconcile()

      expect(store.value).toEqual(state())
      expect(tabs.creates).toBe(0)
    }
  })

  it('uses trusted update evidence when the previous build predates this feature', async () => {
    const { coordinator, store, tabs } = setup()

    await coordinator.reconcile({ reason: 'update', previousVersion: '2.0.0' })

    expect(store.value).toEqual(state({ pendingVersion: VERSION }))
    expect(tabs.creates).toBe(1)
  })

  it('joins startup with trusted update evidence that arrives during the pending operation', async () => {
    let resolveRead!: (value: unknown) => void
    const store = new MemoryStateStore()
    vi.spyOn(store, 'read').mockImplementationOnce(() => new Promise((resolve) => (resolveRead = resolve)))
    const tabs = new MemoryTabs()
    const coordinator = new ChangelogCoordinator({ currentVersion: () => VERSION, store, tabs })

    const startup = coordinator.reconcile()
    await vi.waitFor(() => expect(store.read).toHaveBeenCalledTimes(1))
    const update = coordinator.reconcile({ reason: 'update', previousVersion: '2.0.0' })
    const joined = startup === update
    resolveRead(undefined)
    await Promise.all([startup, update])

    expect(joined).toBe(true)
    expect(store.value).toEqual(state({ pendingVersion: VERSION }))
    expect(tabs.creates).toBe(1)
    expect(tabs.focuses).toHaveLength(0)
  })

  it.each([
    { details: undefined, name: 'startup' },
    { details: { reason: 'install' }, name: 'install' },
    { details: { reason: 'browser_update' }, name: 'browser update' },
    { details: { reason: 'update' }, name: 'update without previousVersion' }
  ])('does not open on a quiet $name baseline', async ({ details }) => {
    const { coordinator, tabs } = setup()

    await coordinator.reconcile(details)

    expect(tabs.creates).toBe(0)
  })

  it('opens for strict version inequality, including downgrade, and suppresses acknowledged versions', async () => {
    const upgrade = setup(state({ observedVersion: '2.0.0' }))
    await upgrade.coordinator.reconcile()
    expect(upgrade.store.value).toEqual(state({ pendingVersion: VERSION }))
    expect(upgrade.tabs.creates).toBe(1)

    const downgrade = setup(state({ observedVersion: '3.0.0' }))
    await downgrade.coordinator.reconcile()
    expect(downgrade.tabs.creates).toBe(1)

    const acknowledged = setup(state({ observedVersion: '3.0.0', shownVersions: [VERSION] }))
    await acknowledged.coordinator.reconcile()
    expect(acknowledged.store.value).toEqual(state({ shownVersions: [VERSION] }))
    expect(acknowledged.tabs.creates).toBe(0)
  })

  it('retries pending work by focusing one existing page', async () => {
    const { coordinator, tabs } = setup(state({ pendingVersion: VERSION }))
    const existing = { id: 42, windowId: 7 }
    tabs.live.push(existing)

    await coordinator.reconcile()

    expect(tabs.creates).toBe(0)
    expect(tabs.focuses).toEqual([existing])
  })

  it('supersedes stale pending work with the installed version', async () => {
    const { coordinator, store, tabs } = setup(
      state({ observedVersion: VERSION, pendingVersion: '2.0.0', shownVersions: ['1.0.0'] })
    )

    await coordinator.reconcile()

    expect(store.value).toEqual(state({ pendingVersion: VERSION, shownVersions: ['1.0.0'] }))
    expect(tabs.creates).toBe(1)
  })

  it('serializes concurrent lifecycle signals and leaves one live page', async () => {
    const { coordinator, tabs } = setup(state({ observedVersion: '2.0.0' }))

    const startup = coordinator.reconcile()
    const update = coordinator.reconcile({ reason: 'update', previousVersion: '2.0.0' })
    const retry = coordinator.reconcile()
    const joined = startup === update && update === retry
    await Promise.all([startup, update, retry])

    expect(joined).toBe(true)
    expect(tabs.live).toHaveLength(1)
    expect(tabs.creates).toBe(1)
    expect(tabs.focuses).toHaveLength(0)
  })

  it('fails closed on storage failure and retains pending state on tab failure', async () => {
    const storageFailure = setup(state({ observedVersion: '2.0.0' }))
    storageFailure.store.writeFailure = true

    await storageFailure.coordinator.reconcile()

    expect(storageFailure.tabs.creates).toBe(0)
    expect(storageFailure.log).toHaveBeenCalledWith('Changelog reconciliation failed')

    const tabFailure = setup(state({ observedVersion: '2.0.0' }))
    tabFailure.tabs.createFailure = true

    await tabFailure.coordinator.reconcile()

    expect(tabFailure.store.value).toEqual(state({ pendingVersion: VERSION }))
    expect(tabFailure.log).toHaveBeenCalledWith('Changelog reconciliation failed')
  })

  it('acknowledges only the current rendered version and remains idempotent', async () => {
    const store = new MemoryStateStore(state({ pendingVersion: VERSION, shownVersions: ['2.0.0'] }))
    const log = vi.fn()

    await acknowledgeChangelogVersion(store, VERSION, log)
    await acknowledgeChangelogVersion(store, VERSION, log)

    expect(store.value).toEqual(state({ shownVersions: ['2.0.0', VERSION] }))
    expect(log).not.toHaveBeenCalled()

    const stale = new MemoryStateStore(state({ observedVersion: '3.0.0', pendingVersion: '3.0.0' }))
    await acknowledgeChangelogVersion(stale, VERSION, log)
    expect(stale.writes).toHaveLength(0)
  })
})
