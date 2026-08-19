import { describe, expect, it } from 'vitest'
import type { RoomTransport } from '@/runtime/RoomTransport'

/**
 * The minimal provider driver surface every RoomTransport contract test needs. Each provider
 * supplies its own library mock behind this interface; the shared suite never imports or sees a
 * concrete peer library.
 */
export interface RoomTransportHarness {
  /** Provider label used in suite/test names. */
  readonly provider: string
  readonly createTransport: () => RoomTransport
  /** The identity `peerIdOf` must report while the room is joined. */
  readonly joinedPeerId: (roomId: string) => string
  /** The provider's physical room-join invocations, in order. */
  readonly joinCalls: () => readonly string[]
  /** The provider's raw send invocations, in order (broadcast normalized to `undefined`). */
  readonly sendCalls: () => readonly { roomId: string; payload: string; target?: string | string[] | null }[]
  /** Payloads the provider actually delivered to any peer, in order. */
  readonly deliveries: () => readonly string[]
  /** Makes the next provider send reject with the exact error. */
  readonly failNextSend: (error: Error) => void
  readonly emitMessage: (roomId: string, sourcePeerId: string, payload: string) => void
  readonly emitPeerJoin: (roomId: string, peerId: string) => void
  readonly emitPeerLeave: (roomId: string, peerId: string) => void
  readonly emitJoinError: (roomId: string, error: Error) => void
  /** Flushes the provider's asynchronous settlements (a no-op for synchronous providers). */
  readonly settle: () => Promise<void>
}

/**
 * The provider-neutral RoomTransport contract: every assertion is observable through the
 * interface alone and runs once per provider harness. Provider-specific lifecycle (e.g. async leave
 * settlement) stays in each adapter's own test file.
 */
export const describeRoomTransportContract = (harness: RoomTransportHarness) => {
  describe(`RoomTransport contract [${harness.provider}]`, () => {
    it('joins a room physically and reports its peer identity only while joined', async () => {
      const transport = harness.createTransport()
      expect(transport.peerIdOf('room-a')).toBe('')

      await transport.join('room-a')

      expect(harness.joinCalls()).toContain('room-a')
      expect(transport.peerIdOf('room-a')).toBe(harness.joinedPeerId('room-a'))
      expect(transport.peerIdOf('room-a')).not.toBe('')
      transport.dispose()
    })

    it('rejects a send to a room that was never joined', async () => {
      const transport = harness.createTransport()

      await expect(transport.send('room-missing', 'payload')).rejects.toThrow()
      expect(harness.sendCalls()).toEqual([])
      transport.dispose()
    })

    it('passes broadcast, single, array, and unknown targets through to the provider', async () => {
      const transport = harness.createTransport()
      await transport.join('room-a')

      await transport.send('room-a', 'all')
      await transport.send('room-a', 'one', 'peer-a')
      await transport.send('room-a', 'two', ['peer-a', 'peer-b'])
      await transport.send('room-a', 'none', 'missing-peer')

      expect(harness.sendCalls()).toEqual([
        { roomId: 'room-a', payload: 'all', target: undefined },
        { roomId: 'room-a', payload: 'one', target: 'peer-a' },
        { roomId: 'room-a', payload: 'two', target: ['peer-a', 'peer-b'] },
        { roomId: 'room-a', payload: 'none', target: 'missing-peer' }
      ])
      transport.dispose()
    })

    it('sends nothing for an empty target array without delivering to any peer', async () => {
      const transport = harness.createTransport()
      await transport.join('room-a')

      await transport.send('room-a', 'nobody', [])

      expect(harness.deliveries()).toEqual([])
      transport.dispose()
    })

    it('surfaces a provider send rejection with its exact identity', async () => {
      const transport = harness.createTransport()
      await transport.join('room-a')
      const failure = new Error('provider send failed')
      harness.failNextSend(failure)

      await expect(transport.send('room-a', 'boom')).rejects.toBe(failure)
      transport.dispose()
    })

    it('routes messages, peer joins, peer leaves, and errors with their exact room scope', async () => {
      const transport = harness.createTransport()
      const events: string[] = []
      transport.onMessage((roomId, sourcePeerId, payload) =>
        events.push(`message:${roomId}:${sourcePeerId}:${payload}`)
      )
      transport.onPeerJoin((roomId, peerId) => events.push(`join:${roomId}:${peerId}`))
      transport.onPeerLeave((roomId, peerId) => events.push(`leave:${roomId}:${peerId}`))
      transport.onError((error, roomId) => events.push(`error:${roomId}:${error.message}`))
      await transport.join('room-a')
      await transport.join('room-b')

      harness.emitMessage('room-a', 'peer-a', 'hello')
      harness.emitPeerJoin('room-a', 'peer-a')
      harness.emitPeerLeave('room-b', 'peer-b')
      harness.emitJoinError('room-b', new Error('join broke'))

      expect(events).toEqual([
        'message:room-a:peer-a:hello',
        'join:room-a:peer-a',
        'leave:room-b:peer-b',
        'error:room-b:join broke'
      ])
      transport.dispose()
    })

    it('fences stale callbacks and rejects sends after leave', async () => {
      const transport = harness.createTransport()
      const events: string[] = []
      transport.onMessage((roomId, sourcePeerId) => events.push(`message:${roomId}:${sourcePeerId}`))
      transport.onPeerJoin((roomId, peerId) => events.push(`join:${roomId}:${peerId}`))
      await transport.join('room-a')

      transport.leave('room-a')
      await harness.settle()

      expect(transport.peerIdOf('room-a')).toBe('')
      harness.emitMessage('room-a', 'stale-peer', 'stale')
      harness.emitPeerJoin('room-a', 'stale-peer')
      expect(events).toEqual([])
      await expect(transport.send('room-a', 'late')).rejects.toThrow()
      transport.dispose()
    })

    it('rejects sends and clears identities after dispose', async () => {
      const transport = harness.createTransport()
      await transport.join('room-a')
      await transport.join('room-b')

      transport.dispose()
      await harness.settle()

      expect(transport.peerIdOf('room-a')).toBe('')
      expect(transport.peerIdOf('room-b')).toBe('')
      await expect(transport.send('room-a', 'late')).rejects.toThrow()
    })

    it('stops delivering events to an unsubscribed listener', async () => {
      const transport = harness.createTransport()
      const events: string[] = []
      const unsubscribe = transport.onMessage((roomId, sourcePeerId) => events.push(`${roomId}:${sourcePeerId}`))
      await transport.join('room-a')

      harness.emitMessage('room-a', 'peer-a', 'first')
      unsubscribe()
      harness.emitMessage('room-a', 'peer-a', 'second')

      expect(events).toEqual(['room-a:peer-a'])
      transport.dispose()
    })
  })
}
