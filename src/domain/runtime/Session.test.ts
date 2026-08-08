import { describe, expect, it } from 'vitest'
import { Remesh } from 'remesh'
import SessionDomain, { getChatRoomId } from './Session'
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
  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_000_000 }),
      IdentityExtern.impl({ nextId: () => `id-${Math.random().toString(36).slice(2)}` }),
      PresenceStoreExtern.impl({
        load: async () => null,
        save: async () => {}
      }),
      RoomTransportExtern.impl({
        peerId: 'local-peer',
        join: async () => {},
        leave: () => {},
        peers: () => [],
        send: async () => {},
        onMessage: () => () => {},
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
  const sessionAction = SessionDomain()
  const session = store.getDomain(sessionAction)
  store.subscribeDomain(sessionAction)
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
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { store, session }
}

describe('Session prepared rebind markers', () => {
  it('deduplicates repeated same-presence prepared SESSION frames into one rebind marker', async () => {
    const { store, session } = await setup()
    const chatRoomId = getChatRoomId(DOMAIN)
    const remoteSession = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b',
      presenceId: 'presence-b',
      joinedAt: 2,
      user: { id: 'user-b', name: 'B', avatar: '' }
    }
    // A remote B commits, departs (pending armed), then a prepared attempt receives B's SESSION
    // twice: the marker array must stay structurally deduplicated.
    store.send(
      session.command.ApplySessionMessageCommand({
        roomId: chatRoomId,
        sourcePeerId: 'peer-b',
        message: remoteSession
      })
    )
    store.send(session.command.PeerLeftCommand({ roomId: chatRoomId, sourcePeerId: 'peer-b' }))
    store.send(
      session.command.PrepareDomainCommand({
        attemptId: 'attempt-2',
        mode: 'join',
        domain: DOMAIN,
        user: USER,
        site: { origin: DOMAIN }
      })
    )
    store.send(
      session.command.ApplySessionMessageCommand({
        roomId: chatRoomId,
        sourcePeerId: 'peer-b',
        message: remoteSession
      })
    )
    store.send(
      session.command.ApplySessionMessageCommand({
        roomId: chatRoomId,
        sourcePeerId: 'peer-b',
        message: remoteSession
      })
    )
    expect(store.query(session.query.PreparedRebindCountQuery('attempt-2'))).toBe(1)
  })
})

describe('Session prepared rebind markers', () => {
  it('deduplicates repeated same-presence prepared SESSION frames into one rebind marker', async () => {
    const { store, session } = await setup()
    const roomId = getChatRoomId(DOMAIN)
    const bSession = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b',
      presenceId: 'presence-b',
      joinedAt: 2,
      user: { id: 'user-b', name: 'B', avatar: '' }
    }
    // B binds in the committed runtime, then its source departs (pending leave armed).
    store.send(session.command.ApplySessionMessageCommand({ roomId, sourcePeerId: 'peer-b', message: bSession }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.send(session.command.PeerLeftCommand({ roomId, sourcePeerId: 'peer-b' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A local join preparation seeds the committed sessions.
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
    // B's valid same-presence SESSION arrives twice in the prepared attempt: one logical marker.
    store.send(session.command.ApplySessionMessageCommand({ roomId, sourcePeerId: 'peer-b', message: bSession }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.send(session.command.ApplySessionMessageCommand({ roomId, sourcePeerId: 'peer-b', message: bSession }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.query(session.query.PreparedRebindCountQuery('attempt-2'))).toBe(1)
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
