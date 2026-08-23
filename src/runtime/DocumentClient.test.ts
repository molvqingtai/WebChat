import { describe, expect, it, vi } from 'vitest'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol'
import type { RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { DocumentClient } from '@/runtime/DocumentClient'

const DOMAIN = 'https://example.com'

const snapshot = (marker: string): RuntimeSnapshot => ({
  hostId: 'host-1',
  hostPhase: 'ready',
  peerId: 'peer-1',
  domains: [
    {
      domain: DOMAIN,
      phase: 'active',
      tabIds: [1],
      chatRoomJoined: true,
      sessions: [],
      inbound: [],
      historyFeedback: []
    }
  ],
  world: { joined: true, peerId: 'peer-1', presences: [] },
  failures: marker ? [{ eventId: marker, message: marker, subsystem: 'connection', operation: 'lifecycle' }] : []
})

const inboundRecord = (id: string): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 1, counter: 0 },
    userId: 'remote-user',
    body: id,
    mentions: []
  },
  user: { id: 'remote-user', name: 'Remote', avatar: '' },
  receivedAt: 1
})

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const flush = async (turns = 20) => {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

const setup = () => {
  const registerCalls: string[] = []
  const readCalls: string[] = []
  const registerQueue: Array<ReturnType<typeof deferred<{ snapshot: RuntimeSnapshot }>>> = []
  const readQueue: Array<ReturnType<typeof deferred<RuntimeSnapshot>>> = []
  const coordinator = {
    registerPage: vi.fn((_payload: { domain: string }) => {
      registerCalls.push('register')
      const pending = deferred<{ snapshot: RuntimeSnapshot }>()
      registerQueue.push(pending)
      return pending.promise
    })
  }
  const server = {
    getSnapshot: vi.fn((_payload?: { domain?: string }) => {
      readCalls.push('read')
      const pending = deferred<RuntimeSnapshot>()
      readQueue.push(pending)
      return pending.promise
    })
  }
  const client = new DocumentClient({
    coordinator: coordinator as never,
    server: server as never,
    domain: DOMAIN
  })
  return { client, coordinator, server, registerCalls, readCalls, registerQueue, readQueue }
}

describe('DocumentClient one-way current-state drain', () => {
  it('first pull registers, publishes ready after one clean cycle, and later hints read current state', async () => {
    const { client, coordinator, server, registerQueue, readQueue } = setup()
    const ready = vi.fn()
    client.whenReady(ready)

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toMatchObject({ hostPhase: 'ready' })
    expect(ready).toHaveBeenCalledTimes(1)
    expect(server.getSnapshot).not.toHaveBeenCalled()

    // A hint refreshes through the ordinary current-state read, never a re-registration.
    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
    expect(coordinator.registerPage).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('converges any number of dirty hints through the uncapped loop under one owner', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const applied: string[] = []
    client.registerApplier('chat', (projection) => {
      applied.push(projection.failures[0]?.eventId ?? 'clean')
    })
    // Ready may be published only by the clean cycle: the projection current at publication
    // time must be the final converged state, never the delayed dirty-cycle response.
    let readyMarker: string | null = null
    client.whenReady(() => {
      readyMarker = client.snapshot().failures[0]?.eventId ?? 'clean'
    })

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    // Three hints during the pending registration: only the dirty bit is set, no parallel owner.
    client.invalidate()
    client.invalidate()
    client.invalidate()
    registerQueue.shift()!.resolve({ snapshot: snapshot('s1') })
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    // The s1 registration response was applied, dirty observed, and the owner pulled current s2.
    readQueue.shift()!.resolve(snapshot('s2'))
    await expect(init).resolves.toMatchObject({ hostPhase: 'ready' })
    await flush()
    // The delayed initial s1 could not publish stale ready; only the clean cycle did.
    expect(applied).toEqual(['s1', 's2'])
    expect(readyMarker).toBe('s2')
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps pulling while hints arrive during a refresh, with no fixed follow-up cap', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    // A hint arrives during every read: the owner must keep pulling until one cycle is clean.
    for (let index = 0; index < 4; index += 1) {
      client.invalidate()
      readQueue.shift()!.resolve(snapshot(''))
      await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(index + 2))
    }
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
    expect(server.getSnapshot).toHaveBeenCalledTimes(5)
  })

  it('publishes the original Error on register rejection, retires the owner, and never self-retries', async () => {
    const { client, coordinator, registerQueue } = setup()
    const failure = vi.fn()
    client.whenFailure(failure)
    const original = new Error('background unavailable')

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.reject(original)
    await expect(init).rejects.toBe(original)
    expect(failure).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledWith(original)
    expect(client).toMatchObject({})

    // No internal retry: nothing happens until an explicit invalidation.
    await flush(50)
    expect(coordinator.registerPage).toHaveBeenCalledTimes(1)

    // A failed registration leaves `registered` false: the next hint registers again.
    client.invalidate()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await flush()
  })

  it('publishes the original Error on a current-read rejection and recovers through a later explicit hint', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const failure = vi.fn()
    client.whenFailure(failure)
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    const original = new Error('read exploded')
    readQueue.shift()!.reject(original)
    await vi.waitFor(() => expect(failure).toHaveBeenCalledWith(original))
    await flush(50)
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)

    // Registration already succeeded: the later explicit hint uses the ordinary read.
    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(2))
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
  })

  it.each(['chat', 'persistence', 'world'] as const)(
    'publishes the original Error when the %s apply stage throws and retires the owner',
    async (stage) => {
      const { client, registerQueue } = setup()
      const failure = vi.fn()
      client.whenFailure(failure)
      const original = new Error(`${stage} apply exploded`)
      client.registerApplier(stage, () => {
        throw original
      })

      const init = client.init()
      await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
      registerQueue.shift()!.resolve({ snapshot: snapshot('') })
      await expect(init).rejects.toBe(original)
      expect(failure).toHaveBeenCalledWith(original)
      await flush(50)
      // The owner slot cannot retain a settled Promise and nothing retries by itself.
      client.invalidate()
      await vi.waitFor(() => expect(registerQueue.length + 1).toBeGreaterThan(0))
    }
  )

  it('leaves ready unpublished when a ready observer throws, and a later explicit hint retries publication', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const failure = vi.fn()
    client.whenFailure(failure)
    const original = new Error('observer exploded')
    let shouldThrow = true
    const ready = vi.fn(() => {
      if (shouldThrow) throw original
    })
    client.whenReady(ready)

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).rejects.toBe(original)
    expect(failure).toHaveBeenCalledWith(original)

    // A later explicit hint runs a clean cycle and attempts idempotent publication again.
    // Registration already succeeded, so the retry uses the ordinary current-state read.
    shouldThrow = false
    const retry = client.init()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    readQueue.shift()!.resolve(snapshot(''))
    await expect(retry).resolves.toBeTruthy()
    expect(ready).toHaveBeenCalledTimes(2)
  })

  it('restarts synchronously when an explicit hint lands during ready publication (lost-wakeup fence)', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    let invalidateInsideReady = true
    client.whenReady(() => {
      if (invalidateInsideReady) client.invalidate()
    })

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()
    // The hint set dirty after the last while-check: the synchronous finally recheck must restart.
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    invalidateInsideReady = false
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('a failure without a concurrent explicit hint waits; it never restarts from the failure itself', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    readQueue.shift()!.reject(new Error('boom'))
    await flush(80)
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('a hint arriving during a failed operation is honored by the same finalization cut', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    // The explicit hint lands while the failing read is still pending.
    client.invalidate()
    readQueue.shift()!.reject(new Error('boom'))
    // Finally sees dirty and starts a fresh owner, which reads current state again.
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(2))
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
  })

  it('survives a synchronous register throw and a synchronous read throw, recovering on the next explicit hint', async () => {
    // A native adapter may throw synchronously before producing a Promise. The owner slot is
    // already installed, so the common finally retires it and a later hint starts a fresh owner.
    const syncThrowCoordinator = {
      registerPage: vi.fn((_payload: { domain: string }): Promise<{ snapshot: RuntimeSnapshot }> => {
        throw new Error('native register exploded')
      })
    }
    const client = new DocumentClient({
      coordinator: syncThrowCoordinator as never,
      server: { getSnapshot: async () => snapshot('') } as never,
      domain: DOMAIN
    })
    const failure = vi.fn()
    client.whenFailure(failure)

    await expect(client.init()).rejects.toThrow('native register exploded')
    expect(failure).toHaveBeenCalledTimes(1)
    await flush(50)
    expect(syncThrowCoordinator.registerPage).toHaveBeenCalledTimes(1)

    // The settled Promise was not reinstalled in the slot: an explicit hint starts a new owner.
    syncThrowCoordinator.registerPage.mockImplementationOnce(async () => ({ snapshot: snapshot('') }))
    client.invalidate()
    await vi.waitFor(() => expect(syncThrowCoordinator.registerPage).toHaveBeenCalledTimes(2))

    const { client: readClient, server, registerQueue } = setup()
    const init = readClient.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()
    server.getSnapshot.mockImplementationOnce(() => {
      throw new Error('native read exploded')
    })
    const readFailure = vi.fn()
    readClient.whenFailure(readFailure)
    readClient.invalidate()
    await vi.waitFor(() => expect(readFailure).toHaveBeenCalledTimes(1))
    await flush(50)
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)
    readClient.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(2))
  })

  it('reads current state with a non-empty caller-bearing request', async () => {
    const { client, server, registerQueue, readQueue } = setup()
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(server.getSnapshot).toHaveBeenCalledTimes(1))
    expect(server.getSnapshot).toHaveBeenCalledWith({ domain: DOMAIN })
    const readPayload = server.getSnapshot.mock.calls[0]?.[0] as unknown as Record<string, unknown>
    expect(Object.keys(readPayload)).not.toHaveLength(0)
    readQueue.shift()!.resolve(snapshot(''))
    await flush()
  })

  it('a pulled host replacement re-registers through the register-and-read surface before applying', async () => {
    const { client, coordinator, server, registerQueue, readQueue } = setup()
    const applied: string[] = []
    client.registerApplier('chat', (projection) => {
      applied.push(projection.hostId)
    })
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()
    expect(applied).toEqual(['host-1'])

    // The Background was replaced: the same document must register with the new Runtime instead
    // of merely reading it, so tab membership and the History provider are rebuilt.
    server.getSnapshot.mockImplementation(async () => ({ ...snapshot(''), hostId: 'host-2' }))
    coordinator.registerPage.mockImplementation(async () => ({ snapshot: { ...snapshot(''), hostId: 'host-2' } }))
    client.invalidate()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(applied).toEqual(['host-1', 'host-2']))
    expect(server.getSnapshot).toHaveBeenCalledTimes(1)
    await flush()
  })

  it.each(['chat', 'persistence', 'world'] as const)(
    'publishes the pulled ready phase only after the %s stage has settled',
    async (stage) => {
      const { client, registerQueue } = setup()
      const phases: string[] = []
      client.whenHostPhase((phase) => phases.push(phase))
      const hold = deferred<void>()
      let released = false
      client.registerApplier(stage, async () => {
        if (!released) await hold.promise
      })

      const init = client.init()
      await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
      registerQueue.shift()!.resolve({ snapshot: snapshot('') })
      await flush(10)
      // The registration response is back but one stage is still held: no ready phase yet.
      expect(phases).toEqual(['none', 'connecting'])
      released = true
      hold.resolve()
      await expect(init).resolves.toBeTruthy()
      expect(phases).toEqual(['none', 'connecting', 'ready'])
    }
  )

  it('publishes ready only after every synchronous ready observer returns', async () => {
    const { client, registerQueue } = setup()
    const phases: string[] = []
    client.whenHostPhase((phase) => phases.push(phase))
    const order: string[] = []
    client.whenReady(() => order.push('first'))
    client.whenReady(() => order.push('second'))

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()
    expect(order).toEqual(['first', 'second'])
    expect(phases).toEqual(['none', 'connecting', 'ready'])
  })

  it('detach fences a pending registration: a late settlement writes nothing and init starts fresh immediately', async () => {
    const { client, coordinator, registerQueue } = setup()
    const applied: string[] = []
    const phases: string[] = []
    client.registerApplier('chat', (projection) => {
      applied.push(projection.hostId)
    })
    client.whenHostPhase((phase) => phases.push(phase))

    const init = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    // Detach while the first registration is still pending; the waiter settles as detached.
    client.detach()
    await expect(init).rejects.toMatchObject({ name: 'AbortError' })

    // A later init starts a fresh register-and-read owner without waiting for the old Promise.
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))

    // The old registration settles late: zero snapshot/applier/readiness writes from its continuation.
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await flush(30)
    expect(applied).toEqual([])
    expect(phases).not.toContain('ready')

    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(restored).resolves.toBeTruthy()
    expect(applied).toEqual(['host-1'])
  })

  it('detach inside an apply stage stops the remaining stages and never publishes', async () => {
    const { client, registerQueue } = setup()
    const stages: string[] = []
    const phases: string[] = []
    client.whenHostPhase((phase) => phases.push(phase))
    const chatSeen = deferred<void>()
    client.registerApplier('chat', () => {
      stages.push('chat')
      chatSeen.resolve()
    })
    client.registerApplier('persistence', () => {
      stages.push('persistence')
    })
    client.registerApplier('world', () => {
      stages.push('world')
    })

    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await chatSeen.promise
    client.detach()
    await expect(init).rejects.toMatchObject({ name: 'AbortError' })
    await flush(30)

    expect(stages).toEqual(['chat'])
    expect(phases).not.toContain('ready')
  })

  it('a detached applier continuation produces zero successor ACK/provider/dedup effects', async () => {
    // A real ChatRoom + real message store persistence stage behind the drain.
    const ackInbound = vi.fn(async () => {})
    const provideHistory = vi.fn(async () => {})
    const record = inboundRecord('stale-insert')
    const projection = snapshot('')
    projection.domains[0]!.inbound = [{ sequence: 1, domain: DOMAIN, record, source: 'live' }]
    const registration = deferred<{ snapshot: RuntimeSnapshot }>()
    const coordinator = { registerPage: vi.fn(() => registration.promise) }
    const server = {
      getSnapshot: vi.fn(async () => projection),
      provideHistory: provideHistory as unknown as RuntimeServer['provideHistory'],
      ackInbound: ackInbound as unknown as RuntimeServer['ackInbound']
    }
    const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
    const messageStore = createMessageStore(createMemoryMessageDatabase('stale-applier'))
    const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
    const messages: string[] = []
    room.onMessage((message) => messages.push(message.id))
    client.registerApplier('chat', (p, context) => room.applyChat(p))
    client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))

    // Hold the real durable insert of the first owner's persistence stage.
    const insertGate = Promise.withResolvers<void>()
    const extendedInsert = messageStore.insert as unknown as (
      input: Parameters<typeof messageStore.insert>[0],
      options?: { signal?: AbortSignal }
    ) => ReturnType<typeof messageStore.insert>
    const originalInsert = extendedInsert.bind(messageStore)
    let holdsFirst = true
    vi.spyOn(messageStore, 'insert').mockImplementation((async (input: unknown, options?: unknown) => {
      if (holdsFirst) await insertGate.promise
      return originalInsert(input as never, options as never)
    }) as typeof messageStore.insert)

    const first = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registration.resolve({ snapshot: projection })
    await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(1))

    // Detach mid-insert, then immediately start the fresh owner (as a BFCache pageshow would).
    client.detach()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    holdsFirst = false
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))

    // Let the old held insert settle last: its continuation must produce no successor effects.
    insertGate.resolve()
    await expect(restored).resolves.toBeTruthy()
    await flush(30)

    // Exactly one ACK and one live message projection — both from the fresh owner. The stale
    // continuation wrote no dedup state, issued no ACK, and emitted no observer effect.
    expect(ackInbound).toHaveBeenCalledTimes(1)
    expect(messages).toEqual(['stale-insert'])
    expect(provideHistory).toHaveBeenCalledTimes(1)
    await expect(messageStore.query()).resolves.toEqual([record])
  })

  it('passes the current owner signal into cancellable persistence and aborts it at detach', async () => {
    const registration = deferred<{ snapshot: RuntimeSnapshot }>()
    const coordinator = { registerPage: vi.fn(() => registration.promise) }
    const server = {
      getSnapshot: vi.fn(async () => snapshot('')),
      provideHistory: vi.fn(async () => {}),
      ackInbound: vi.fn(async () => {})
    }
    const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
    const messageStore = createMessageStore(createMemoryMessageDatabase('signal-plumbing'))
    const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (p) => room.applyChat(p))
    client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))

    const insertGate = Promise.withResolvers<void>()
    const seenSignals: Array<AbortSignal | undefined> = []
    const originalInsert = messageStore.insert.bind(messageStore) as unknown as (
      input: unknown,
      options?: { signal?: AbortSignal }
    ) => ReturnType<typeof messageStore.insert>
    vi.spyOn(messageStore, 'insert').mockImplementation(((input: unknown, options?: { signal?: AbortSignal }) => {
      seenSignals.push(options?.signal)
      return (async () => {
        await insertGate.promise
        return originalInsert(input, options)
      })()
    }) as typeof messageStore.insert)

    // A fresh local session forces the self-join insert through the current owner context.
    const fresh = snapshot('')
    fresh.domains[0]!.localSession = {
      sessionId: 'local-session',
      user: { id: 'u', name: 'U', avatar: '' },
      joinedAt: 1,
      fresh: true
    }
    const init = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registration.resolve({ snapshot: fresh })
    await vi.waitFor(() => expect(seenSignals.length).toBeGreaterThan(0))

    // Detach while the live owner's persistence insert is pending: the context signal it
    // received must abort synchronously.
    const ownerSignal = seenSignals[0]
    expect(ownerSignal).toBeDefined()
    expect(ownerSignal?.aborted).toBe(false)
    client.detach()
    expect(ownerSignal?.aborted).toBe(true)
    insertGate.resolve()
    await expect(init).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('a late self-join insert settlement never commits the stale dedup key; a fresh hint writes once', async () => {
    const fresh = snapshot('')
    fresh.domains[0]!.localSession = {
      sessionId: 'local-session',
      user: { id: 'u', name: 'U', avatar: '' },
      joinedAt: 1,
      fresh: true
    }
    const registration = deferred<{ snapshot: RuntimeSnapshot }>()
    const coordinator = { registerPage: vi.fn(() => registration.promise) }
    const server = {
      getSnapshot: vi.fn(async () => fresh),
      provideHistory: vi.fn(async () => {}),
      ackInbound: vi.fn(async () => {})
    }
    const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
    const messageStore = createMessageStore(createMemoryMessageDatabase('self-join-stale'))
    const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (p) => room.applyChat(p))
    client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))

    // Hold the continuation AFTER the physical write completes: the aborted signal cannot undo
    // a completed write, so only the post-await owner assertion fences the stale settlement.
    const insertGate = Promise.withResolvers<void>()
    let holdsFirst = true
    const originalInsert = messageStore.insert.bind(messageStore) as unknown as (
      input: unknown,
      options?: { signal?: AbortSignal }
    ) => ReturnType<typeof messageStore.insert>
    const spy = vi.spyOn(messageStore, 'insert').mockImplementation(((
      input: unknown,
      options?: { signal?: AbortSignal }
    ) => {
      return (async () => {
        const result = await originalInsert(input, options)
        if (holdsFirst) await insertGate.promise
        return result
      })()
    }) as typeof messageStore.insert)

    const first = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registration.resolve({ snapshot: fresh })
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    // Detach mid-insert, then let the stale write settle late: the key must stay uncommitted.
    client.detach()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    holdsFirst = false
    insertGate.resolve()
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    await expect(restored).resolves.toBeTruthy()

    // The fresh hint re-executes the idempotent write (key was never stale-committed), and the
    // total durable side effect is exactly one notice.
    expect(spy).toHaveBeenCalledTimes(2)
    const notices = await messageStore.query({ type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE })
    expect(notices).toHaveLength(1)
  })

  it('a late provideHistory settlement never marks the provider stale-registered; the fresh owner re-provides', async () => {
    const registration = deferred<{ snapshot: RuntimeSnapshot }>()
    const coordinator = { registerPage: vi.fn(() => registration.promise) }
    const provideGate = Promise.withResolvers<void>()
    const provideHistory = vi.fn(async () => provideGate.promise)
    const server = { getSnapshot: vi.fn(async () => snapshot('')), provideHistory, ackInbound: vi.fn(async () => {}) }
    const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
    const messageStore = createMessageStore(createMemoryMessageDatabase('provide-stale'))
    const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (p) => room.applyChat(p))
    client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))

    const first = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registration.resolve({ snapshot: snapshot('') })
    await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(1))

    client.detach()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    provideGate.resolve()
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    await expect(restored).resolves.toBeTruthy()

    // The stale continuation was fenced before marking the provider registered: the fresh owner
    // registers the real provider again.
    expect(provideHistory).toHaveBeenCalledTimes(2)
  })

  it('a late negative-ACK settlement never retires the stale invalid pair; the fresh owner retries it', async () => {
    const invalid = inboundRecord('invalid-stale')
    const projection = snapshot('')
    projection.domains[0]!.inbound = [{ sequence: 1, domain: DOMAIN, record: invalid, source: 'live' }]
    const registration = deferred<{ snapshot: RuntimeSnapshot }>()
    const coordinator = { registerPage: vi.fn(() => registration.promise) }
    const ackGate = Promise.withResolvers<void>()
    let holdAck = true
    const ackInbound = vi.fn(async () => {
      if (holdAck) await ackGate.promise
    })
    const server = { getSnapshot: vi.fn(async () => projection), provideHistory: vi.fn(async () => {}), ackInbound }
    const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
    const messageStore = createMessageStore(createMemoryMessageDatabase('ack-stale'))
    const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (p) => room.applyChat(p))
    client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))
    const insertSpy = vi.spyOn(messageStore, 'insert')
    const { InvalidMessageRecordError } = await import('@/domain/MessageStore')
    insertSpy.mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))

    const first = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registration.resolve({ snapshot: projection })
    await vi.waitFor(() => expect(ackInbound).toHaveBeenCalledTimes(1))

    // Detach with the negative ACK pending, then let it settle late: the exact invalid pair must
    // survive (the stale continuation cannot retire it).
    client.detach()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    holdAck = false
    ackGate.resolve()
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    await expect(restored).resolves.toBeTruthy()

    // The fresh owner re-attempts only the exact pair's negative ACK — no second insert attempt.
    expect(insertSpy).toHaveBeenCalledTimes(1)
    const ackCalls = (ackInbound.mock.calls as Array<[{ inserted?: boolean }?]>).filter(
      (call) => call[0]?.inserted === false
    )
    expect(ackCalls.length).toBeGreaterThanOrEqual(2)
  })

  it.each(['resolve', 'reject'] as const)(
    'an ordinary detach aborts a pending History supply; the late %s terminal stays silent for the fresh document',
    async (branch) => {
      const registration = deferred<{ snapshot: RuntimeSnapshot }>()
      const coordinator = { registerPage: vi.fn(() => registration.promise) }
      const resolveHistorySupply = vi.fn(async () => {})
      const rejectHistorySupply = vi.fn(async () => {})
      let supplyCallback:
        | ((event: {
            type: string
            request?: { supplyId: string; domain: string; syncId: string; cutoff: number; mode: 'provider' }
          }) => void)
        | null = null
      const server = {
        getSnapshot: vi.fn(async () => snapshot('')),
        provideHistory: vi.fn(async (_payload: { domain: string }, callback: NonNullable<typeof supplyCallback>) => {
          supplyCallback = callback
        }),
        ackInbound: vi.fn(async () => {}),
        resolveHistorySupply: resolveHistorySupply as never,
        rejectHistorySupply: rejectHistorySupply as never
      }
      const client = new DocumentClient({ coordinator: coordinator as never, server: server as never, domain: DOMAIN })
      const messageStore = createMessageStore(createMemoryMessageDatabase(`detach-supply-${branch}`))
      const room = new ChatRoom({ server: server as never, messageStore, pageDomain: DOMAIN })
      client.registerApplier('chat', (p) => room.applyChat(p))
      client.registerApplier('persistence', (p, context) => room.applyPersistence(p, context))

      // The drain completes cleanly; the long-lived supplier is registered afterwards.
      const init = client.init()
      await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
      registration.resolve({ snapshot: snapshot('') })
      await expect(init).resolves.toBeTruthy()
      await vi.waitFor(() => expect(server.provideHistory).toHaveBeenCalledTimes(1))

      // A real supply request holds the physical MessageStore query.
      const queryStarted = Promise.withResolvers<AbortSignal>()
      const releaseQuery = Promise.withResolvers<readonly never[]>()
      let queryCount = 0
      vi.spyOn(messageStore, 'query').mockImplementation(async (query) => {
        queryCount += 1
        if (queryCount === 1) {
          queryStarted.resolve(query?.signal ?? new AbortController().signal)
          return releaseQuery.promise as never
        }
        return [] as never
      })
      supplyCallback!({
        type: 'request',
        request: { supplyId: 'supply-1', domain: DOMAIN, syncId: 'sync-1', cutoff: 0, mode: 'provider' }
      })
      const querySignal = await queryStarted.promise

      // Ordinary document detach (BFCache): the exact document capability aborts the pending
      // query without any drain owner being live.
      expect(querySignal.aborted).toBe(false)
      client.detach()
      expect(querySignal.aborted).toBe(true)

      // The fresh document re-registers and becomes ready without waiting for B1.
      const restored = client.init()
      await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
      await expect(restored).resolves.toBeTruthy()

      // The stale supply settles late in either direction: zero resolve/fail effects, and the
      // fresh document's provider/dedup/readiness are untouched.
      if (branch === 'resolve') releaseQuery.resolve([])
      else releaseQuery.reject(new Error('late query failure'))
      await flush(20)
      expect(resolveHistorySupply).not.toHaveBeenCalled()
      expect(rejectHistorySupply).not.toHaveBeenCalled()
      expect(server.provideHistory).toHaveBeenCalledTimes(1)
    }
  )

  it('reuses one exact attached-document capability across drains and replaces it only at detach', async () => {
    const { client, coordinator, registerQueue, readQueue } = setup()
    const seen: Array<{ signal: AbortSignal; assertActive: () => void }> = []
    client.registerApplier('chat', (_projection, context) => {
      seen.push(context.document)
    })

    const init = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.invalidate()
    await vi.waitFor(() => expect(readQueue).toHaveLength(1))
    readQueue.shift()!.resolve(snapshot(''))
    await flush()

    // Every drain of the same document receives the identical capability object (no re-wrapping).
    expect(seen.length).toBeGreaterThanOrEqual(2)
    const first = seen[0]!
    expect(seen.every((capability) => capability === first)).toBe(true)
    expect(() => first.assertActive()).not.toThrow()

    // Detach aborts and clears the slot; re-init installs a NEW exact object, and the old
    // reference can never become active again (slot mismatch AND aborted).
    client.detach()
    expect(() => first.assertActive()).toThrow()
    const restored = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(restored).resolves.toBeTruthy()
    const replacement = seen.at(-1)!
    expect(replacement).not.toBe(first)
    expect(() => replacement.assertActive()).not.toThrow()
    expect(() => first.assertActive()).toThrow()
  })

  it('document detach discards the owner; a fresh document registers again instead of recovering the old owner', async () => {
    const { client, coordinator, server, registerQueue, readQueue } = setup()
    const init = client.init()
    await vi.waitFor(() => expect(registerQueue).toHaveLength(1))
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(init).resolves.toBeTruthy()

    client.detach()
    const next = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    expect(server.getSnapshot).not.toHaveBeenCalled()
    registerQueue.shift()!.resolve({ snapshot: snapshot('') })
    await expect(next).resolves.toBeTruthy()
    await flush()
    expect(readQueue).toHaveLength(0)
  })
})
