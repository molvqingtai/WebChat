import { describe, expect, it } from 'vitest'
import { Remesh } from 'remesh'
import SessionDomain, { getChatRoomId } from './Session'
import WireDomain from './Wire'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { PagePort } from '@/runtime/PagePort'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import type { ChatUser } from '@/protocol/Session'

const DOMAIN = 'https://chat.example.com'
const USER: ChatUser = { id: 'user-1', name: 'User', avatar: '' }

const jsonCodec = {
  encode: async (value: unknown): Promise<string> => JSON.stringify(value),
  decode: async (value: string): Promise<unknown> => JSON.parse(value)
}

const setup = async () => {
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_000_000 }),
      IdentityExtern.impl({ nextId: () => `id-${Math.random().toString(36).slice(2)}` }),
      PresenceStoreExtern.impl({
        load: async () => null,
        save: async () => {}
      }),
      RoomTransportExtern.impl({
        peerIdOf: () => 'local-peer',
        join: async () => {},
        leave: () => {},
        retireRoomsForPreparation: async () => {},
        send: async () => {},
        onMessage: (callback) => {
          messageListener = callback
          return () => {
            messageListener = null
          }
        },
        onPeerJoin: () => () => {},
        onPeerLeave: () => () => {},
        onRoomClose: () => () => {},
        onError: () => () => {},
        dispose: () => {}
      }),
      WireCodecExtern.impl(jsonCodec),
      PagePortExtern.impl(new PagePort())
    ]
  })
  const wireAction = WireDomain()
  const sessionAction = SessionDomain()
  const wire = store.getDomain(wireAction)
  const session = store.getDomain(sessionAction)
  store.subscribeDomain(wireAction)
  store.subscribeDomain(sessionAction)
  store.igniteDomain(wireAction)
  store.igniteDomain(sessionAction)
  // A committed runtime is required by the allocation commands.
  store.send(
    session.command.HydratePresenceCommand({
      domain: DOMAIN,
      lastJoinedAt: 1,
      local: { presenceId: 'presence-1', userId: USER.id, joinedAt: 1, status: 'active' },
      observers: []
    })
  )
  store.send(
    session.command.PrepareDomainCommand({
      attemptId: 'attempt-1',
      mode: 'join',
      domain: DOMAIN,
      user: USER,
      site: { origin: DOMAIN }
    })
  )
  store.send(session.command.CommitPreparedCommand('attempt-1'))
  store.send(wire.command.JoinRoomsCommand({ requestId: 'join-1', roomIds: [getChatRoomId(DOMAIN)] }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return {
    store,
    session,
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      messageListener?.(roomId, sourcePeerId, JSON.stringify(message))
    }
  }
}

describe('Session prepared rebind markers (Wire boundary)', () => {
  it('stages an epoch-bound local owner without entering the ordinary PreparedEvent path', async () => {
    const { store, session } = await setup()
    const normal: unknown[] = []
    const privateTerminals: unknown[] = []
    store.subscribeEvent(session.event.PreparedEvent, (event) => normal.push(event))
    store.subscribeEvent(session.event.EpochPreparedEvent, (event) => privateTerminals.push(event))

    store.send(
      session.command.PrepareEpochDomainCommand({
        attemptId: 'epoch-attempt',
        epoch: 'epoch-1',
        chatGeneration: 4,
        domain: DOMAIN,
        roomId: getChatRoomId(DOMAIN),
        local: {
          sessionId: 'local-session',
          presenceId: 'presence-1',
          user: USER,
          site: { origin: DOMAIN },
          joinedAt: 1
        }
      })
    )

    expect(normal).toEqual([])
    expect(privateTerminals).toEqual([
      { attemptId: 'epoch-attempt', epoch: 'epoch-1', domain: DOMAIN, roomId: getChatRoomId(DOMAIN) }
    ])
    expect(store.query(session.query.PreparedSessionQuery('epoch-attempt'))).toMatchObject({
      stagedEpoch: 'epoch-1',
      stagedChatGeneration: 4,
      runtime: { sessionId: 'local-session' }
    })
  })

  it('deduplicates repeated same-presence prepared SESSION frames into one structural rebind marker', async () => {
    const { store, session, receive } = await setup()
    const roomId = getChatRoomId(DOMAIN)
    const remoteSession = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b',
      presenceId: 'presence-b',
      joinedAt: 2,
      user: { id: 'user-b', name: 'B', avatar: '' }
    }
    // B binds through the real Wire boundary, then its source departs (pending armed).
    receive(roomId, 'peer-b', remoteSession)
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.send(session.command.PeerLeftCommand({ roomId, sourcePeerId: 'peer-b' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A prepared attempt receives B's SESSION twice through the Wire boundary.
    store.send(
      session.command.PrepareDomainCommand({
        attemptId: 'attempt-2',
        mode: 'join',
        domain: DOMAIN,
        user: USER,
        site: { origin: DOMAIN }
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    receive(roomId, 'peer-b', remoteSession)
    await new Promise((resolve) => setTimeout(resolve, 0))
    receive(roomId, 'peer-b', remoteSession)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // One logical structural marker (a reference-identity implementation would store two).
    const prepared = store.query(session.query.PreparedSessionQuery('attempt-2'))
    expect(prepared?.reboundBindings).toHaveLength(1)
  })
})

describe('Session allocation success events', () => {
  it('emits only the typed allocation event (zero generic successes) for a text allocation', async () => {
    const { store, session } = await setup()
    const genericSuccesses: string[] = []
    const typedSuccesses: string[] = []
    store.subscribeEvent(session.event.OperationSucceededEvent, (result) => genericSuccesses.push(result.operationId))
    store.subscribeEvent(session.event.TextMessageAllocatedEvent, (result) => typedSuccesses.push(result.operationId))
    store.send(
      session.command.AllocateTextMessageCommand({
        operationId: 'alloc-1',
        domain: DOMAIN,
        body: 'hi',
        mentions: []
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(genericSuccesses).toEqual([])
    expect(typedSuccesses).toEqual(['alloc-1'])
  })

  it('emits only the typed allocation event (zero generic successes) for a reaction allocation', async () => {
    const { store, session } = await setup()
    const genericSuccesses: string[] = []
    const typedSuccesses: string[] = []
    store.subscribeEvent(session.event.OperationSucceededEvent, (result) => genericSuccesses.push(result.operationId))
    store.subscribeEvent(session.event.ReactionMessageAllocatedEvent, (result) =>
      typedSuccesses.push(result.operationId)
    )
    store.send(
      session.command.AllocateReactionMessageCommand({
        operationId: 'alloc-2',
        domain: DOMAIN,
        targetId: 'target-1',
        reaction: 'like',
        active: true
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(genericSuccesses).toEqual([])
    expect(typedSuccesses).toEqual(['alloc-2'])
  })
})
