import { describe, expect, it } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import WorldRoomDomain from '@/domain/WorldRoom'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { BrowserSyncStorageExtern, type Storage } from '@/domain/externs/Storage'
import { WorldRoomExtern, type WorldRoom } from '@/domain/externs/WorldRoom'

const storage: Storage = {
  get: async () => null,
  set: async () => {},
  watch: async () => async () => {}
}

const subscribe = <T>(listeners: Set<T>, callback: T) => {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

describe('Page domain event lifecycle', () => {
  it('removes every Chat listener on discard and does not duplicate after reignite', () => {
    const listeners = {
      message: new Set<Parameters<ChatRoom['onMessage']>[0]>(),
      join: new Set<Parameters<ChatRoom['onJoinRoom']>[0]>(),
      leave: new Set<Parameters<ChatRoom['onLeaveRoom']>[0]>(),
      sessions: new Set<Parameters<ChatRoom['onSessions']>[0]>(),
      error: new Set<Parameters<ChatRoom['onError']>[0]>()
    }
    const chatRoom: ChatRoom = {
      joinRoom: async () => {},
      leaveRoom: async () => {},
      sendMessage: async () => {
        throw new Error('not used')
      },
      onMessage: (callback) => subscribe(listeners.message, callback),
      onJoinRoom: (callback) => subscribe(listeners.join, callback),
      onLeaveRoom: (callback) => subscribe(listeners.leave, callback),
      onSessions: (callback) => subscribe(listeners.sessions, callback),
      onError: (callback) => subscribe(listeners.error, callback)
    }
    const store = Remesh.store({
      externs: [
        ChatRoomExtern.impl(chatRoom),
        SendLifecycleExtern.impl(createSendLifecycle()),
        ReadinessExtern.impl({ onState: () => () => {} }),
        MessageDatabaseExtern.impl(createMemoryMessageDatabase('event-lifecycle')),
        BrowserSyncStorageExtern.impl(storage)
      ]
    })
    const action = ChatRoomDomain()

    let domain = store.getDomain(action)
    let domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([1, 1, 1, 1, 1])

    const firstEvents: Error[] = []
    const firstEventSubscription = store.subscribeEvent(domain.event.OnErrorEvent, (error) => firstEvents.push(error))
    const firstError = new Error('first')
    listeners.error.forEach((listener) => listener(firstError))
    expect(firstEvents).toEqual([firstError])

    firstEventSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([0, 0, 0, 0, 0])

    domain = store.getDomain(action)
    domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([1, 1, 1, 1, 1])

    const nextEvents: Error[] = []
    const nextEventSubscription = store.subscribeEvent(domain.event.OnErrorEvent, (error) => nextEvents.push(error))
    const nextError = new Error('next')
    listeners.error.forEach((listener) => listener(nextError))
    expect(nextEvents).toEqual([nextError])

    nextEventSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([0, 0, 0, 0, 0])
  })

  it('removes every World listener on discard and delivers one event after reignite', () => {
    const listeners = {
      state: new Set<Parameters<WorldRoom['onState']>[0]>(),
      error: new Set<Parameters<WorldRoom['onError']>[0]>()
    }
    const worldRoom: WorldRoom = {
      getState: async () => [],
      onState: (callback) => subscribe(listeners.state, callback),
      onError: (callback) => subscribe(listeners.error, callback)
    }
    const store = Remesh.store({ externs: [WorldRoomExtern.impl(worldRoom)] })
    const action = WorldRoomDomain()

    let domain = store.getDomain(action)
    let domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([1, 1])

    domainSubscription.unsubscribe()
    store.discardDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([0, 0])

    domain = store.getDomain(action)
    domainSubscription = store.subscribeDomain(action)
    store.igniteDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([1, 1])

    const events: Error[] = []
    const eventSubscription = store.subscribeEvent(domain.event.OnErrorEvent, (error) => events.push(error))
    const error = new Error('once')
    listeners.error.forEach((listener) => listener(error))
    expect(events).toEqual([error])

    eventSubscription.unsubscribe()
    domainSubscription.unsubscribe()
    store.discardDomain(action)
    expect(Object.values(listeners).map((set) => set.size)).toEqual([0, 0])
  })
})
