import { describe, expect, it, vi } from 'vitest'
import { Remesh, type Args, type RemeshEvent, type RemeshSubscribeOnlyEvent } from 'remesh'
import WireDomain from '@/domain/runtime/Wire'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { MAX_DECODE_QUEUE_BYTES, MAX_DECODE_QUEUE_FRAMES } from '@/constants/config'
import { MESSAGE_TYPE, WireCodecError, type WireCodec } from '@/protocol'

const ROOM = 'chat-room'
const message = {
  type: MESSAGE_TYPE.SESSION,
  sessionId: 'session-1',
  presenceId: 'presence-1',
  joinedAt: 1,
  user: { id: 'user-1', name: 'User', avatar: '' }
} as const

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const fixture = (
  codec: WireCodec = { encode: async (value) => JSON.stringify(value), decode: async (payload) => JSON.parse(payload) }
) => {
  const sent: { roomId: string; payload: string; to?: string | string[] }[] = []
  let join: (roomId: string) => Promise<void> = async () => {}
  let send: RoomTransport['send'] = async (roomId, payload, to) => {
    sent.push({ roomId, payload, to })
  }
  let onMessage: Parameters<RoomTransport['onMessage']>[0] = () => {}
  let onPeerJoin: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
  let onPeerLeave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
  let onRoomClose: Parameters<RoomTransport['onRoomClose']>[0] = () => {}
  let onError: Parameters<RoomTransport['onError']>[0] = () => {}
  const transport: RoomTransport = {
    peerId: 'local-peer',
    join: (roomId) => join(roomId),
    leave: vi.fn(),
    send: (roomId, payload, to) => send(roomId, payload, to),
    onMessage: (callback) => {
      onMessage = callback
      return () => {}
    },
    onPeerJoin: (callback) => {
      onPeerJoin = callback
      return () => {}
    },
    onPeerLeave: (callback) => {
      onPeerLeave = callback
      return () => {}
    },
    onRoomClose: (callback) => {
      onRoomClose = callback
      return () => {}
    },
    onError: (callback) => {
      onError = callback
      return () => {}
    },
    dispose: vi.fn()
  }
  const store = Remesh.store({
    externs: [RoomTransportExtern.impl(transport), WireCodecExtern.impl(codec)]
  })
  const action = WireDomain()
  const wire = store.getDomain(action)
  store.subscribeDomain(action)
  store.igniteDomain(action)
  const event = <T extends Args, U>(target: RemeshEvent<T, U> | RemeshSubscribeOnlyEvent<T, U>) =>
    new Promise<U>((resolve) => {
      const subscription = store.subscribeEvent(target, (value) => {
        subscription.unsubscribe()
        resolve(value)
      })
    })
  return {
    store,
    wire,
    sent,
    transport,
    setJoin: (next: typeof join) => {
      join = next
    },
    setSend: (next: typeof send) => {
      send = next
    },
    receive: (roomId: string, sourcePeerId: string, payload: string) => onMessage(roomId, sourcePeerId, payload),
    peerJoin: (roomId: string, sourcePeerId: string) => onPeerJoin(roomId, sourcePeerId),
    peerLeave: (roomId: string, sourcePeerId: string) => onPeerLeave(roomId, sourcePeerId),
    close: (roomId: string) => onRoomClose(roomId),
    fail: (error: Error) => onError(error),
    event
  }
}

const trustRoom = async (runtime: ReturnType<typeof fixture>) => {
  const joined = runtime.event(runtime.wire.event.RoomsJoinedEvent)
  runtime.store.send(runtime.wire.command.JoinRoomsCommand({ requestId: 'join-1', roomIds: [ROOM] }))
  await joined
}

const invalidateRoom = (runtime: ReturnType<typeof fixture>, transition: 'leave' | 'close') => {
  if (transition === 'leave') {
    runtime.store.send(runtime.wire.command.LeaveRoomCommand(ROOM))
  } else {
    runtime.close(ROOM)
  }
}

describe('WireDomain anti-corruption boundary', () => {
  it('admits sends and typed inbound values only after physical room acceptance', async () => {
    const runtime = fixture()
    const untrustedFailure = runtime.event(runtime.wire.event.MessageSendFailedEvent)
    runtime.store.send(runtime.wire.command.SendMessageCommand({ requestId: 'send-untrusted', roomId: ROOM, message }))
    await expect(untrustedFailure).resolves.toMatchObject({ requestId: 'send-untrusted' })

    await trustRoom(runtime)
    const sent = runtime.event(runtime.wire.event.MessageSentEvent)
    runtime.store.send(runtime.wire.command.SendMessageCommand({ requestId: 'send-1', roomId: ROOM, message }))
    await expect(sent).resolves.toEqual({ requestId: 'send-1' })
    expect(runtime.sent).toEqual([{ roomId: ROOM, payload: JSON.stringify(message), to: undefined }])

    const accepted = runtime.event(runtime.wire.event.MessageAcceptedEvent)
    runtime.receive(ROOM, 'remote-peer', JSON.stringify(message))
    await expect(accepted).resolves.toEqual({ roomId: ROOM, sourcePeerId: 'remote-peer', message })
  })

  it('serializes delayed encode and send per room', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const calls: string[] = []
    const runtime = fixture({
      encode: (value) => {
        const sessionId = (value as { sessionId: string }).sessionId
        calls.push(sessionId)
        return sessionId === 'first' ? first.promise : second.promise
      },
      decode: async (payload) => JSON.parse(payload)
    })
    await trustRoom(runtime)
    const sent: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.MessageSentEvent, ({ requestId }) => sent.push(requestId))

    runtime.store.send(
      runtime.wire.command.SendMessageCommand({
        requestId: 'first',
        roomId: ROOM,
        message: { ...message, sessionId: 'first' }
      })
    )
    runtime.store.send(
      runtime.wire.command.SendMessageCommand({
        requestId: 'second',
        roomId: ROOM,
        message: { ...message, sessionId: 'second' }
      })
    )
    second.resolve('second')
    await vi.waitFor(() => expect(calls).toEqual(['first']))
    expect(runtime.sent).toEqual([])

    first.resolve('first')
    await vi.waitFor(() => expect(sent).toEqual(['first', 'second']))
    expect(runtime.sent.map(({ payload }) => payload)).toEqual(['first', 'second'])
  })

  it('accepts a later frame from the same source after its prior decode queue drains', async () => {
    const runtime = fixture()
    await trustRoom(runtime)
    const accepted: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, ({ message: value }) => {
      if ('type' in value && value.type === MESSAGE_TYPE.SESSION) accepted.push(value.sessionId)
    })

    runtime.receive(ROOM, 'peer-a', JSON.stringify({ ...message, sessionId: 'first' }))
    await vi.waitFor(() => expect(accepted).toEqual(['first']))
    expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([])
    runtime.receive(ROOM, 'peer-a', JSON.stringify({ ...message, sessionId: 'second' }))

    await vi.waitFor(() => expect(accepted).toEqual(['first', 'second']))
  })

  it('serializes decode per room/source while allowing typed completion order to remain causal', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const calls: string[] = []
    const runtime = fixture({
      encode: async (value) => JSON.stringify(value),
      decode: (payload) => {
        calls.push(payload)
        return payload === 'first' ? first.promise : second.promise
      }
    })
    await trustRoom(runtime)
    const accepted: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, (event) => accepted.push(event.sourcePeerId))

    runtime.receive(ROOM, 'peer-a', 'first')
    runtime.receive(ROOM, 'peer-a', 'second')
    await vi.waitFor(() => expect(calls).toEqual(['first']))
    second.resolve(message)
    first.resolve(message)
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']))
    await vi.waitFor(() => expect(accepted).toEqual(['peer-a', 'peer-a']))
  })

  it('bounds queued frames per source without blocking another source', async () => {
    const blocked = deferred<unknown>()
    const runtime = fixture({
      encode: async (value) => JSON.stringify(value),
      decode: (payload) => (payload.startsWith('frame-') ? blocked.promise : Promise.resolve(JSON.parse(payload)))
    })
    await trustRoom(runtime)
    const drops: string[] = []
    const accepted: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.ProtocolDropEvent, ({ reason }) => drops.push(reason))
    runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, ({ sourcePeerId }) =>
      accepted.push(sourcePeerId)
    )

    for (let index = 0; index <= MAX_DECODE_QUEUE_FRAMES; index += 1) {
      runtime.receive(ROOM, 'peer-a', `frame-${index}`)
    }
    runtime.receive(ROOM, 'peer-b', JSON.stringify(message))

    await vi.waitFor(() => expect(accepted).toEqual(['peer-b']))
    await vi.waitFor(() => expect(drops).toContain('queue-overflow'))
    expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([
      { id: JSON.stringify([ROOM, 'peer-a']), frameCount: MAX_DECODE_QUEUE_FRAMES, wireBytes: 56 }
    ])
    blocked.resolve(message)
  })

  it('enforces the accumulated source queue byte limit independently of frame count', async () => {
    const blocked = deferred<unknown>()
    const runtime = fixture({ encode: async (value) => JSON.stringify(value), decode: () => blocked.promise })
    await trustRoom(runtime)
    const drops: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.ProtocolDropEvent, ({ reason }) => drops.push(reason))
    const frame = 'x'.repeat(MAX_DECODE_QUEUE_BYTES / 4)

    for (let index = 0; index < 4; index += 1) runtime.receive(ROOM, 'peer-a', frame)
    runtime.receive(ROOM, 'peer-a', 'x')

    await vi.waitFor(() => expect(drops).toContain('queue-overflow'))
    expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([
      {
        id: JSON.stringify([ROOM, 'peer-a']),
        frameCount: 4,
        wireBytes: MAX_DECODE_QUEUE_BYTES
      }
    ])
    blocked.resolve(message)
  })

  it('contains malformed decode failure and continues the same source queue', async () => {
    const runtime = fixture({
      encode: async (value) => JSON.stringify(value),
      decode: async (payload) => {
        if (payload === 'bad') throw new Error('bad frame')
        return JSON.parse(payload)
      }
    })
    await trustRoom(runtime)
    const drops: string[] = []
    const accepted: string[] = []
    runtime.store.subscribeEvent(runtime.wire.event.ProtocolDropEvent, ({ reason }) => drops.push(reason))
    runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, ({ sourcePeerId }) =>
      accepted.push(sourcePeerId)
    )

    runtime.receive(ROOM, 'peer-a', 'bad')
    runtime.receive(ROOM, 'peer-a', JSON.stringify(message))

    await vi.waitFor(() => expect(drops).toContain('invalid-frame'))
    await vi.waitFor(() => expect(accepted).toEqual(['peer-a']))
    expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([])
  })

  it.each(['leave', 'close'] as const)(
    'drops delayed decode admitted before %s and accepts no stale fact after rejoin',
    async (transition) => {
      const decoded = deferred<unknown>()
      const runtime = fixture({
        encode: async (value) => JSON.stringify(value),
        decode: () => decoded.promise
      })
      await trustRoom(runtime)
      const accepted: string[] = []
      runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, ({ sourcePeerId }) =>
        accepted.push(sourcePeerId)
      )

      runtime.receive(ROOM, 'stale-peer', 'old-generation-frame')
      await vi.waitFor(() => expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toHaveLength(1))
      invalidateRoom(runtime, transition)
      await trustRoom(runtime)
      decoded.resolve(message)
      await decoded.promise
      await Promise.resolve()
      await Promise.resolve()

      expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([])
      expect(accepted).toEqual([])
    }
  )

  it.each(['leave', 'close'] as const)(
    'drops delayed encode admitted before %s without sending into the replacement room',
    async (transition) => {
      const staleEncode = deferred<string>()
      const runtime = fixture({
        encode: (value) =>
          (value as { sessionId?: string }).sessionId === 'stale-session'
            ? staleEncode.promise
            : Promise.resolve(JSON.stringify(value)),
        decode: async (payload) => JSON.parse(payload)
      })
      await trustRoom(runtime)
      const sent: string[] = []
      const failed: string[] = []
      runtime.store.subscribeEvent(runtime.wire.event.MessageSentEvent, ({ requestId }) => sent.push(requestId))
      runtime.store.subscribeEvent(runtime.wire.event.MessageSendFailedEvent, ({ requestId }) => failed.push(requestId))
      const stale = { ...message, sessionId: 'stale-session' }
      const current = { ...message, sessionId: 'current-session' }

      runtime.store.send(
        runtime.wire.command.SendMessageCommand({ requestId: 'stale-send', roomId: ROOM, message: stale })
      )
      invalidateRoom(runtime, transition)
      await trustRoom(runtime)
      runtime.store.send(
        runtime.wire.command.SendMessageCommand({ requestId: 'current-send', roomId: ROOM, message: current })
      )
      staleEncode.resolve(JSON.stringify(stale))

      await vi.waitFor(() => expect(sent).toContain('current-send'))
      expect(runtime.sent.map(({ payload }) => payload)).toEqual([JSON.stringify(current)])
      expect(sent).not.toContain('stale-send')
      expect(failed).toContain('stale-send')
    }
  )

  it.each(['leave', 'close'] as const)(
    'fences provider completion admitted before %s without blocking the replacement queue',
    async (transition) => {
      const staleProvider = deferred<void>()
      const providerPayloads: string[] = []
      const runtime = fixture()
      runtime.setSend(async (_roomId, payload) => {
        providerPayloads.push(payload)
        if (JSON.parse(payload).sessionId === 'stale-session') await staleProvider.promise
      })
      await trustRoom(runtime)
      const sent: string[] = []
      const failed: string[] = []
      runtime.store.subscribeEvent(runtime.wire.event.MessageSentEvent, ({ requestId }) => sent.push(requestId))
      runtime.store.subscribeEvent(runtime.wire.event.MessageSendFailedEvent, ({ requestId }) => failed.push(requestId))
      const stale = { ...message, sessionId: 'stale-session' }
      const current = { ...message, sessionId: 'current-session' }

      runtime.store.send(
        runtime.wire.command.SendMessageCommand({ requestId: 'stale-provider', roomId: ROOM, message: stale })
      )
      await vi.waitFor(() => expect(providerPayloads).toEqual([JSON.stringify(stale)]))
      invalidateRoom(runtime, transition)
      await trustRoom(runtime)
      runtime.store.send(
        runtime.wire.command.SendMessageCommand({ requestId: 'current-provider', roomId: ROOM, message: current })
      )

      await vi.waitFor(() => expect(sent).toContain('current-provider'))
      staleProvider.resolve()
      await staleProvider.promise
      await Promise.resolve()
      expect(providerPayloads).toEqual([JSON.stringify(stale), JSON.stringify(current)])
      expect(sent).not.toContain('stale-provider')
      expect(failed).toContain('stale-provider')
    }
  )

  it('fences a late physical join after leave and never trusts the stale room', async () => {
    const pending = deferred<void>()
    const runtime = fixture()
    runtime.setJoin(() => pending.promise)
    const failed = runtime.event(runtime.wire.event.RoomsJoinFailedEvent)
    runtime.store.send(runtime.wire.command.JoinRoomsCommand({ requestId: 'late-join', roomIds: [ROOM] }))
    runtime.store.send(runtime.wire.command.LeaveRoomCommand(ROOM))
    pending.resolve()

    await expect(failed).resolves.toMatchObject({ requestId: 'late-join', error: new Error('Room join superseded') })
    expect(runtime.store.query(runtime.wire.query.IsRoomTrustedQuery(ROOM))).toBe(false)
  })

  it('reports codec failure as one operation result without invoking the provider', async () => {
    const runtime = fixture({
      encode: async () => {
        throw new WireCodecError('encode failed')
      },
      decode: async (payload) => JSON.parse(payload)
    })
    await trustRoom(runtime)
    const failed = runtime.event(runtime.wire.event.MessageSendFailedEvent)
    runtime.store.send(runtime.wire.command.SendMessageCommand({ requestId: 'codec-failure', roomId: ROOM, message }))

    await expect(failed).resolves.toMatchObject({
      requestId: 'codec-failure',
      error: new WireCodecError('encode failed')
    })
    expect(runtime.sent).toEqual([])
  })
})
