import { describe, expect, it } from 'vitest'
import { Remesh } from 'remesh'
import AppStatusDomain from '@/domain/AppStatus'

const createFixture = () => {
  const store = Remesh.store({ externs: [] })
  const action = AppStatusDomain()
  const domain = store.getDomain(action)
  store.igniteDomain(action)
  return { store, domain }
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
})
