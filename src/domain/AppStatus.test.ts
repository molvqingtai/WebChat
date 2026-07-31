import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import AppStatusDomain, { defaultStatusState, type AppStatus } from '@/domain/AppStatus'
import { APP_STATUS_STORAGE_KEY } from '@/constants/storage'
import { LocalStorageExtern, type Storage } from '@/domain/externs/Storage'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const createFixture = (read: Promise<AppStatus | null> = new Promise(() => {})) => {
  const get = vi.fn(() => read)
  const set = vi.fn(async () => {})
  const watch = vi.fn(async () => async () => {})
  const storage: Storage = {
    get: get as Storage['get'],
    set: set as Storage['set'],
    watch
  }
  const store = Remesh.store({ externs: [LocalStorageExtern.impl(storage)] })
  const action = AppStatusDomain()
  const domain = store.getDomain(action)
  store.igniteDomain(action)
  return { store, domain, get, set, watch }
}

describe('AppStatus shell ownership', () => {
  it('preserves an open interaction that happens before persisted status hydrates', () => {
    const { store, domain } = createFixture()

    store.send(domain.command.UpdateOpenCommand(true))
    store.send(
      domain.command.HydrateStatusCommand({
        open: false,
        unread: 4,
        position: { x: 80, y: 40 }
      })
    )

    expect(store.query(domain.query.OpenQuery())).toBe(true)
    expect(store.query(domain.query.UnreadQuery())).toBe(0)
    expect(store.query(domain.query.PositionQuery())).toEqual({ x: 80, y: 40 })
    expect(store.query(domain.query.StatusLoadIsFinishedQuery())).toBe(true)
    store.discard()
  })

  it('restores persisted open state when the shell has not been toggled', () => {
    const { store, domain } = createFixture()

    store.send(
      domain.command.HydrateStatusCommand({
        open: true,
        unread: 0,
        position: { x: 50, y: 22 }
      })
    )

    expect(store.query(domain.query.OpenQuery())).toBe(true)
    expect(store.query(domain.query.StatusLoadIsFinishedQuery())).toBe(true)
    store.discard()
  })

  it('hydrates the persisted expanded shell before application bootstrap is relevant', async () => {
    const read = deferred<AppStatus | null>()
    const fixture = createFixture(read.promise)
    const persisted = { open: true, unread: 2, position: { x: 72, y: 31 } }

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledOnce())
    read.resolve(persisted)
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual(persisted.position)
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )
    expect(fixture.watch).toHaveBeenCalledOnce()
    fixture.store.discard()
  })

  it('consumes persisted collapsed provenance instead of merely retaining the default', async () => {
    const persisted = { open: false, unread: 3, position: { x: 91, y: 27 } }
    const fixture = createFixture(Promise.resolve(persisted))

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.UnreadQuery())).toBe(3)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual(persisted.position)
    fixture.store.discard()
  })

  it('keeps the existing collapsed default when no persisted record exists', async () => {
    const fixture = createFixture(Promise.resolve(null))

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual(defaultStatusState.position)
    fixture.store.discard()
  })

  it('persists a pre-hydration interaction and rejects the older opposite snapshot', async () => {
    const read = deferred<AppStatus | null>()
    const fixture = createFixture(read.promise)

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledOnce())
    fixture.store.send(fixture.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )

    read.resolve({ open: false, unread: 7, position: { x: 64, y: 29 } })
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.UnreadQuery())).toBe(0)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual({ x: 64, y: 29 })
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )
    fixture.store.discard()
  })

  it('does not apply or repersist hydration after its shell store is discarded', async () => {
    const staleRead = deferred<AppStatus | null>()
    const stale = createFixture(staleRead.promise)
    await vi.waitFor(() => expect(stale.get).toHaveBeenCalledOnce())
    stale.store.discard()

    const current = createFixture(Promise.resolve({ open: true, unread: 0, position: { x: 75, y: 25 } }))
    await vi.waitFor(() => expect(current.store.query(current.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    staleRead.resolve({ open: false, unread: 9, position: { x: 12, y: 12 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stale.set).not.toHaveBeenCalled()
    expect(current.store.query(current.domain.query.OpenQuery())).toBe(true)
    current.store.discard()
  })

  it('reuses one storage lifecycle when another consumer ignites the same status domain', async () => {
    const fixture = createFixture(Promise.resolve({ open: true, unread: 0, position: { x: 70, y: 30 } }))
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    fixture.store.igniteDomain(AppStatusDomain())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.watch).toHaveBeenCalledOnce()
    fixture.store.discard()
  })
})
