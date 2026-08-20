import { describe, expect, it, vi } from 'vitest'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import type { TransportService } from '@/runtime/TransportHost'

const createService = () => {
  const messageCallbacks: Array<Parameters<TransportService['onMessage']>[0]> = []
  const joinCallbacks: Array<Parameters<TransportService['onPeerJoin']>[0]> = []
  const leaveCallbacks: Array<Parameters<TransportService['onPeerLeave']>[0]> = []
  const closeCallbacks: Array<Parameters<TransportService['onRoomClose']>[0]> = []
  const errorCallbacks: Array<Parameters<TransportService['onError']>[0]> = []
  const service: TransportService = {
    join: vi.fn(async (roomId) => `peer:${roomId}`),
    leave: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    onMessage: vi.fn(async (callback) => {
      messageCallbacks.push(callback)
    }),
    onPeerJoin: vi.fn(async (callback) => {
      joinCallbacks.push(callback)
    }),
    onPeerLeave: vi.fn(async (callback) => {
      leaveCallbacks.push(callback)
    }),
    onRoomClose: vi.fn(async (callback) => {
      closeCallbacks.push(callback)
    }),
    onError: vi.fn(async (callback) => {
      errorCallbacks.push(callback)
    })
  }
  return { service, messageCallbacks, joinCallbacks, leaveCallbacks, closeCallbacks, errorCallbacks }
}

describe('RemoteRoomTransport', () => {
  it('fences stale Offscreen callbacks and closes only known logical rooms on rebind', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    const closes: string[] = []
    transport.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    transport.onRoomClose((roomId) => closes.push(roomId))

    await transport.rebind()
    await transport.join('room-a')
    const staleMessage = fixture.messageCallbacks[0]!
    const staleClose = fixture.closeCallbacks[0]!

    await transport.rebind()
    const currentMessage = fixture.messageCallbacks[1]!
    const currentClose = fixture.closeCallbacks[1]!
    staleMessage('room-a', 'peer-a', 'stale')
    staleClose('room-a')
    currentMessage('room-a', 'peer-a', 'current')

    expect(messages).toEqual(['current'])
    expect(closes).toEqual(['room-a'])
    expect(transport.peerIdOf('room-a')).toBe('')

    currentClose('room-a')
    expect(closes).toEqual(['room-a', 'room-a'])
  })

  it('forwards diagnostic-only release once and fences callbacks after disposal', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    await transport.rebind()
    const errorCallback = fixture.errorCallbacks[0]!

    transport.leave('room-a', { diagnosticOnly: true })
    await Promise.resolve()
    transport.dispose()
    errorCallback(new Error('late physical failure'), 'room-a')

    expect(fixture.service.leave).toHaveBeenCalledWith('room-a', { diagnosticOnly: true })
    expect(errors).toEqual([])
  })
})
