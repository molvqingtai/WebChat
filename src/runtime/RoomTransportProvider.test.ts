import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOM_TRANSPORT_PROVIDER } from '@/constants/config'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'

const fixture = vi.hoisted(() => ({
  articoTransport: { provider: 'artico' },
  trysteroTransport: { provider: 'trystero' },
  createArticoRoomTransport: vi.fn(),
  createTrysteroRoomTransport: vi.fn()
}))

vi.mock('@/runtime/transports/artico/RoomTransport', () => ({
  createRoomTransport: fixture.createArticoRoomTransport
}))
vi.mock('@/runtime/transports/trystero/RoomTransport', () => ({
  createRoomTransport: fixture.createTrysteroRoomTransport
}))

beforeEach(() => {
  fixture.createArticoRoomTransport.mockReset().mockReturnValue(fixture.articoTransport)
  fixture.createTrysteroRoomTransport.mockReset().mockReturnValue(fixture.trysteroTransport)
})

describe('RoomTransportProvider', () => {
  it('uses the build-time Artico default exactly once without constructing Trystero', () => {
    expect(ROOM_TRANSPORT_PROVIDER).toBe('artico')

    expect(createRoomTransport()).toBe(fixture.articoTransport)
    expect(fixture.createArticoRoomTransport).toHaveBeenCalledOnce()
    expect(fixture.createTrysteroRoomTransport).not.toHaveBeenCalled()
  })

  it('allows a test-owned Trystero build substitution without constructing Artico', async () => {
    vi.resetModules()
    vi.doMock('@/constants/config', () => ({ ROOM_TRANSPORT_PROVIDER: 'trystero' }))

    const { createRoomTransport: createSelectedRoomTransport } = await import('@/runtime/RoomTransportProvider')
    expect(createSelectedRoomTransport()).toBe(fixture.trysteroTransport)
    expect(fixture.createTrysteroRoomTransport).toHaveBeenCalledOnce()
    expect(fixture.createArticoRoomTransport).not.toHaveBeenCalled()
  })
})
