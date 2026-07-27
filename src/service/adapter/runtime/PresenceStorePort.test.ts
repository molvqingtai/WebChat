import { defineProxy } from 'comctx'
import type { Message } from 'comctx'
import { describe, expect, it, vi } from 'vitest'
import type { PresenceDomainRecord, PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { createBrowserPresenceStore, presenceStoreNamespace } from '@/runtime/PresenceStore'
import {
  PresenceStoreInjectPortAdapter,
  PresenceStoreProviderPortAdapter,
  type PresenceStorePort,
  type PresenceStorePortApi,
  type PresenceStorePortSender
} from '@/service/adapter/runtime/PresenceStorePort'

const EXTENSION_ID = 'test-extension'
const BACKGROUND_URL = `chrome-extension://${EXTENSION_ID}/background.js`
const OFFSCREEN_URL = `chrome-extension://${EXTENSION_ID}/offscreen.html`
const OPTIONS_URL = `chrome-extension://${EXTENSION_ID}/options.html`
const DOMAIN = 'https://example.test'

const initial: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 1,
  local: { presenceId: 'legitimate-generation', userId: 'user', joinedAt: 1, status: 'active' },
  observers: []
}
const forged: PresenceDomainRecord = {
  domain: DOMAIN,
  lastJoinedAt: 2,
  settledEnd: { presenceId: 'forged-generation', userId: 'user', joinedAt: 2 },
  observers: []
}

const injectorMessage = (id: string, namespace: string): Message => ({
  type: 'apply',
  sender: { type: 'injector' },
  id,
  path: ['load'],
  args: [DOMAIN],
  meta: {},
  namespace,
  timeStamp: 1
})

const providerMessage = (id: string, namespace: string): Message => ({
  type: 'apply',
  sender: { type: 'provider' },
  id,
  path: ['load'],
  data: initial,
  meta: {},
  namespace,
  timeStamp: 2
})

const createListenerEvent = <T extends (...args: never[]) => unknown>() => {
  const listeners = new Set<T>()
  return {
    listeners,
    event: {
      addListener: (listener: T) => listeners.add(listener),
      removeListener: (listener: T) => listeners.delete(listener)
    }
  }
}

const createPortBus = () => {
  const connections = createListenerEvent<(port: PresenceStorePort) => void>()
  const runtimeMessages = createListenerEvent<(message: unknown, sender: PresenceStorePortSender) => void>()
  const ports = new Set<PresenceStorePort>()
  const providerPorts = new Set<PresenceStorePort>()

  const runtime = (source: PresenceStorePortSender): PresenceStorePortApi => ({
    id: EXTENSION_ID,
    connect: ({ name }) => {
      const clientMessages = createListenerEvent<(message: unknown) => void>()
      const providerMessages = createListenerEvent<(message: unknown) => void>()
      const clientDisconnects = createListenerEvent<() => void>()
      const providerDisconnects = createListenerEvent<() => void>()
      let disconnected = false

      const disconnect = () => {
        if (disconnected) return
        disconnected = true
        ports.delete(client)
        ports.delete(provider)
        providerPorts.delete(provider)
        clientDisconnects.listeners.forEach((listener) => listener())
        providerDisconnects.listeners.forEach((listener) => listener())
      }
      const client: PresenceStorePort = {
        name,
        postMessage: (message) => {
          if (disconnected) throw new Error('Port disconnected')
          queueMicrotask(() => {
            if (!disconnected) providerMessages.listeners.forEach((listener) => listener(message))
          })
        },
        disconnect,
        onMessage: clientMessages.event,
        onDisconnect: clientDisconnects.event
      }
      const provider: PresenceStorePort = {
        name,
        sender: source,
        postMessage: (message) => {
          if (disconnected) throw new Error('Port disconnected')
          queueMicrotask(() => {
            if (!disconnected) clientMessages.listeners.forEach((listener) => listener(message))
          })
        },
        disconnect,
        onMessage: providerMessages.event,
        onDisconnect: providerDisconnects.event
      }
      ports.add(client)
      ports.add(provider)
      providerPorts.add(provider)
      queueMicrotask(() => connections.listeners.forEach((listener) => listener(provider)))
      return client
    },
    onConnect: connections.event
  })

  return {
    runtime,
    sendRuntimeMessage: (message: unknown, sender: PresenceStorePortSender) =>
      runtimeMessages.listeners.forEach((listener) => listener(message, sender)),
    sendPortMessage: (message: unknown) => providerPorts.forEach((port) => port.postMessage(message)),
    runtimeMessageListenerCount: () => runtimeMessages.listeners.size,
    connectionListenerCount: () => connections.listeners.size,
    activePortCount: () => ports.size,
    background: runtime({ id: EXTENSION_ID, url: BACKGROUND_URL }),
    offscreen: runtime({ id: EXTENSION_ID, url: OFFSCREEN_URL }),
    content: runtime({
      id: EXTENSION_ID,
      url: DOMAIN,
      tab: { id: 7, url: DOMAIN }
    }),
    options: runtime({
      id: EXTENSION_ID,
      url: OPTIONS_URL,
      tab: { id: 8, url: OPTIONS_URL }
    })
  }
}

const createProviderEndpoint = (namespace: string, sender: PresenceStorePortSender) => {
  const inbound = createListenerEvent<(message: unknown) => void>()
  const disconnected = createListenerEvent<() => void>()
  const outbound: unknown[] = []
  let closed = false
  const port: PresenceStorePort = {
    name: namespace,
    sender,
    postMessage: (message) => {
      if (closed) throw new Error('Port disconnected')
      outbound.push(message)
    },
    disconnect: () => {
      if (closed) return
      closed = true
      disconnected.listeners.forEach((listener) => listener())
    },
    onMessage: inbound.event,
    onDisconnect: disconnected.event
  }
  return {
    port,
    outbound,
    receive: (message: unknown) => inbound.listeners.forEach((listener) => listener(message)),
    drop: () => disconnected.listeners.forEach((listener) => listener())
  }
}

const createInjectorEndpoint = (namespace: string) => {
  const inbound = createListenerEvent<(message: unknown) => void>()
  const disconnected = createListenerEvent<() => void>()
  const outbound: Message[] = []
  let closed = false
  const port: PresenceStorePort = {
    name: namespace,
    postMessage: (message) => {
      if (closed) throw new Error('Port disconnected')
      outbound.push(message as Message)
    },
    disconnect: () => {
      if (closed) return
      closed = true
      disconnected.listeners.forEach((listener) => listener())
    },
    onMessage: inbound.event,
    onDisconnect: disconnected.event
  }
  return {
    port,
    outbound,
    receive: (message: unknown) => inbound.listeners.forEach((listener) => listener(message)),
    drop: () => port.disconnect()
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const injectorRegistries = (adapter: PresenceStoreInjectPortAdapter) =>
  adapter as unknown as {
    callbacks: Set<(message?: Partial<Message>) => void>
    pending: Map<string, unknown>
    preparations: unknown[]
  }

describe('PresenceStore authenticated port', () => {
  it('accepts only the exact Offscreen transport source', async () => {
    const bus = createPortBus()
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const rejected = vi.fn()
    const provider = new PresenceStoreProviderPortAdapter(bus.background, {
      portName: namespace,
      offscreenUrl: OFFSCREEN_URL,
      onRejected: rejected
    })
    const received = vi.fn()
    provider.onMessage(received)

    const content = bus.content.connect({ name: namespace })
    const options = bus.options.connect({ name: namespace })
    const offscreen = bus.offscreen.connect({ name: namespace })
    const response = vi.fn()
    offscreen.onMessage.addListener(response)
    content.postMessage(injectorMessage('content', namespace))
    options.postMessage(injectorMessage('options', namespace))
    offscreen.postMessage(injectorMessage('offscreen', namespace))
    await settle()

    expect(rejected.mock.calls.map(([sender]) => sender?.url)).toEqual([DOMAIN, OPTIONS_URL])
    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(injectorMessage('offscreen', namespace))

    provider.sendMessage(providerMessage('offscreen', namespace), [])
    await settle()
    expect(response).toHaveBeenCalledWith(providerMessage('offscreen', namespace))

    provider.dispose()
    expect(bus.activePortCount()).toBe(0)
    expect(bus.connectionListenerCount()).toBe(0)
  })

  it('accepts provider responses only from the private port and exact route', async () => {
    const bus = createPortBus()
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const provider = new PresenceStoreProviderPortAdapter(bus.background, {
      portName: namespace,
      offscreenUrl: OFFSCREEN_URL
    })
    const inject = new PresenceStoreInjectPortAdapter(bus.offscreen, namespace)
    const received = vi.fn()
    inject.onMessage(received)
    await settle()
    inject.sendMessage(injectorMessage('accepted', namespace), [])
    await settle()

    bus.sendPortMessage(null)
    bus.sendPortMessage(providerMessage('accepted', 'UNKNOWN'))
    bus.sendPortMessage({ ...providerMessage('accepted', namespace), sender: { type: 'injector' } })
    bus.sendRuntimeMessage(providerMessage('accepted', namespace), {
      id: EXTENSION_ID,
      url: OPTIONS_URL,
      tab: { id: 8, url: OPTIONS_URL }
    })
    bus.sendPortMessage(providerMessage('uncorrelated', namespace))
    bus.sendPortMessage(providerMessage('accepted', namespace))
    await settle()

    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(providerMessage('accepted', namespace))
    expect(bus.runtimeMessageListenerCount()).toBe(0)

    inject.dispose()
    provider.dispose()
    expect(bus.activePortCount()).toBe(0)
    expect(bus.connectionListenerCount()).toBe(0)
  })

  it('drops an old response instead of routing it to a replacement Port', () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const connections = createListenerEvent<(port: PresenceStorePort) => void>()
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => {
        throw new Error('provider runtime does not connect')
      },
      onConnect: connections.event
    }
    const provider = new PresenceStoreProviderPortAdapter(runtime, {
      portName: namespace,
      offscreenUrl: OFFSCREEN_URL
    })
    provider.onMessage(() => {})

    const oldBinding = createProviderEndpoint(namespace, { id: EXTENSION_ID, url: OFFSCREEN_URL })
    connections.listeners.forEach((listener) => listener(oldBinding.port))
    oldBinding.receive(injectorMessage('old-request', namespace))
    oldBinding.drop()

    const replacement = createProviderEndpoint(namespace, { id: EXTENSION_ID, url: OFFSCREEN_URL })
    connections.listeners.forEach((listener) => listener(replacement.port))
    provider.sendMessage(providerMessage('old-request', namespace), [])
    expect(replacement.outbound).toEqual([])

    replacement.receive(injectorMessage('new-request', namespace))
    provider.sendMessage(providerMessage('new-request', namespace), [])
    expect(replacement.outbound).toEqual([providerMessage('new-request', namespace)])

    provider.dispose()
    expect(connections.listeners.size).toBe(0)
  })

  it('rejects every request owned by a Port whose send fails', async () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const terminalMessages = createListenerEvent<(message: unknown) => void>()
    const terminalDisconnects = createListenerEvent<() => void>()
    let terminalPosts = 0
    const terminalPort: PresenceStorePort = {
      name: namespace,
      postMessage: () => {
        terminalPosts += 1
        if (terminalPosts === 2) throw new Error('Attempting to use a disconnected port object')
      },
      disconnect: () => queueMicrotask(() => terminalDisconnects.listeners.forEach((listener) => listener())),
      onMessage: terminalMessages.event,
      onDisconnect: terminalDisconnects.event
    }

    const healthyMessages = createListenerEvent<(message: unknown) => void>()
    const healthyDisconnects = createListenerEvent<() => void>()
    const healthyPosts: Message[] = []
    const healthyPort: PresenceStorePort = {
      name: namespace,
      postMessage: (rawMessage) => {
        const message = rawMessage as Message
        healthyPosts.push(message)
        queueMicrotask(() => {
          healthyMessages.listeners.forEach((listener) => listener(providerMessage(message.id, namespace)))
        })
      },
      disconnect: () => healthyDisconnects.listeners.forEach((listener) => listener()),
      onMessage: healthyMessages.event,
      onDisconnect: healthyDisconnects.event
    }

    let connections = 0
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => (connections++ === 0 ? terminalPort : healthyPort),
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)
    const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
      () => {
        throw new Error('background only')
      },
      { namespace }
    )
    const store = injectPresenceStore(inject)

    const first = store.load(`${DOMAIN}/first`)
    const firstRejection = expect(first).rejects.toThrow('Attempting to use a disconnected port object')
    const second = store.load(`${DOMAIN}/second`)
    await Promise.all([firstRejection, expect(second).rejects.toThrow('Attempting to use a disconnected port object')])
    expect(terminalPosts).toBe(2)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])

    await expect(store.load(`${DOMAIN}/recovered`)).resolves.toEqual(initial)
    expect(connections).toBe(2)
    expect(healthyPosts).toHaveLength(1)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)

    inject.dispose()
  })

  it('rejects pre-send calls with their original generation and never opens a replacement for them', async () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const oldEndpoint = createInjectorEndpoint(namespace)
    const replacement = createInjectorEndpoint(namespace)
    let connections = 0
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => (connections++ === 0 ? oldEndpoint.port : replacement.port),
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)
    const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
      () => {
        throw new Error('background only')
      },
      { namespace }
    )
    const store = injectPresenceStore(inject)

    const inFlight = store.load(`${DOMAIN}/in-flight`)
    await vi.waitFor(() => expect(oldEndpoint.outbound).toHaveLength(1))
    const oldRequest = oldEndpoint.outbound[0]
    const preSendLoad = store.load(`${DOMAIN}/pre-send`)
    const preSendSave = store.save(initial)
    oldEndpoint.drop()

    await Promise.all([
      expect(inFlight).rejects.toThrow('PresenceStore background port disconnected'),
      expect(preSendLoad).rejects.toThrow('PresenceStore background port disconnected'),
      expect(preSendSave).rejects.toThrow('PresenceStore background port disconnected')
    ])
    expect(oldEndpoint.outbound).toHaveLength(1)
    expect(replacement.outbound).toEqual([])
    expect(connections).toBe(1)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])

    oldEndpoint.receive(providerMessage(oldRequest.id, namespace))
    expect(injectorRegistries(inject).callbacks.size).toBe(0)

    const recovered = store.load(`${DOMAIN}/recovered`)
    await vi.waitFor(() => expect(replacement.outbound).toHaveLength(1))
    replacement.receive(providerMessage(oldRequest.id, namespace))
    await settle()
    expect(injectorRegistries(inject).callbacks.size).toBe(1)
    replacement.receive(providerMessage(replacement.outbound[0].id, namespace))
    await expect(recovered).resolves.toEqual(initial)
    expect(connections).toBe(2)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)

    inject.dispose()
  })

  it('drains a released heartbeat reservation before the original terminal apply', () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const oldEndpoint = createInjectorEndpoint(namespace)
    const replacement = createInjectorEndpoint(namespace)
    let connections = 0
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => (connections++ === 0 ? oldEndpoint.port : replacement.port),
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)

    const stopActive = inject.onMessage(() => {})
    inject.sendMessage(injectorMessage('active-request', namespace), [])
    oldEndpoint.receive(providerMessage('active-request', namespace))
    if (typeof stopActive === 'function') stopActive()

    const stopApplication = inject.onMessage(() => {})
    let stopHeartbeat: void | (() => void)
    const heartbeat = vi.fn((message?: Partial<Message>) => {
      if (message?.type === 'pong' && message.id === 'terminal-heartbeat') stopHeartbeat?.()
    })
    stopHeartbeat = inject.onMessage(heartbeat) as () => void
    oldEndpoint.drop()
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toHaveLength(2)

    inject.sendMessage(
      {
        type: 'ping',
        sender: { type: 'injector' },
        id: 'terminal-heartbeat',
        path: [],
        meta: {},
        namespace,
        timeStamp: Date.now()
      },
      []
    )
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(injectorRegistries(inject).preparations).toHaveLength(1)
    expect(() => inject.sendMessage(injectorMessage('terminal-apply', namespace), [])).toThrow(
      'PresenceStore background port disconnected'
    )
    if (typeof stopApplication === 'function') stopApplication()
    expect(replacement.outbound).toEqual([])
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])

    const recovered = vi.fn()
    const stopRecovered = inject.onMessage(recovered)
    inject.sendMessage(injectorMessage('fresh-request', namespace), [])
    replacement.receive(providerMessage('fresh-request', namespace))
    expect(recovered).toHaveBeenCalledWith(providerMessage('fresh-request', namespace))
    if (typeof stopRecovered === 'function') stopRecovered()
    expect(connections).toBe(2)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)

    inject.dispose()
  })

  it('rejects a prepared call on dispose without opening or posting to a Port', async () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const endpoint = createInjectorEndpoint(namespace)
    let connections = 0
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => {
        connections += 1
        return endpoint.port
      },
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)
    const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
      () => {
        throw new Error('background only')
      },
      { namespace }
    )

    const request = injectPresenceStore(inject).save(initial)
    inject.dispose()
    await expect(request).rejects.toThrow('PresenceStore Offscreen adapter disposed')
    expect(connections).toBe(0)
    expect(endpoint.outbound).toEqual([])
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])
  })

  it('cleans every prepared response entry after a synchronous connect failure', async () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const replacement = createInjectorEndpoint(namespace)
    let connections = 0
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => {
        connections += 1
        if (connections === 1) throw new Error('PresenceStore connect failed')
        return replacement.port
      },
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)
    const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
      () => {
        throw new Error('background only')
      },
      { namespace }
    )
    const store = injectPresenceStore(inject)

    const first = store.load(`${DOMAIN}/connect-first`)
    const second = store.save(initial)
    const third = store.load(`${DOMAIN}/connect-third`)
    await Promise.all([
      expect(first).rejects.toThrow('PresenceStore connect failed'),
      expect(second).rejects.toThrow('PresenceStore connect failed'),
      expect(third).rejects.toThrow('PresenceStore connect failed')
    ])
    expect(connections).toBe(1)
    expect(replacement.outbound).toEqual([])
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])

    const recovered = store.load(`${DOMAIN}/connect-recovered`)
    await vi.waitFor(() => expect(replacement.outbound).toHaveLength(1))
    replacement.receive(providerMessage(replacement.outbound[0].id, namespace))
    await expect(recovered).resolves.toEqual(initial)
    expect(connections).toBe(2)
    expect(injectorRegistries(inject).callbacks.size).toBe(0)

    inject.dispose()
  })

  it('cleans pending response entries on dispose and ignores a late response', async () => {
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const endpoint = createInjectorEndpoint(namespace)
    const runtime: PresenceStorePortApi = {
      id: EXTENSION_ID,
      connect: () => endpoint.port,
      onConnect: createListenerEvent<(port: PresenceStorePort) => void>().event
    }
    const inject = new PresenceStoreInjectPortAdapter(runtime, namespace)
    const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
      () => {
        throw new Error('background only')
      },
      { namespace }
    )

    const request = injectPresenceStore(inject).load(`${DOMAIN}/pending-dispose`)
    await vi.waitFor(() => expect(endpoint.outbound).toHaveLength(1))
    const sent = endpoint.outbound[0]
    inject.dispose()
    await expect(request).rejects.toThrow('PresenceStore Offscreen adapter disposed')
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
    expect(injectorRegistries(inject).pending.size).toBe(0)
    expect(injectorRegistries(inject).preparations).toEqual([])

    endpoint.receive(providerMessage(sent.id, namespace))
    expect(injectorRegistries(inject).callbacks.size).toBe(0)
  })

  it('keeps lifecycle bytes behind the private port across rejection and provider restart', async () => {
    const values: Record<string, unknown> = {}
    let rejectNextSave = true
    let holdNextLoad = false
    let loadStarted = Promise.withResolvers<void>()
    let releaseLoad = Promise.withResolvers<void>()
    const storage = {
      get: vi.fn(async (key: string) => {
        if (holdNextLoad) {
          holdNextLoad = false
          loadStarted.resolve()
          await releaseLoad.promise
        }
        return { [key]: values[key] }
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        if (rejectNextSave) {
          rejectNextSave = false
          throw new Error('session storage unavailable')
        }
        Object.assign(values, items)
      })
    }
    const bus = createPortBus()
    const namespace = presenceStoreNamespace(EXTENSION_ID)
    const backgroundStore = createBrowserPresenceStore(storage)
    const defineStore = () =>
      defineProxy<() => PresenceStore>(() => backgroundStore, {
        namespace,
        heartbeatInterval: 2,
        heartbeatTimeout: 20
      })
    const [providePresenceStore, injectPresenceStore] = defineStore()
    const rejected = vi.fn()
    const providerErrors = vi.fn()
    let provider = new PresenceStoreProviderPortAdapter(bus.background, {
      portName: namespace,
      offscreenUrl: OFFSCREEN_URL,
      onError: providerErrors,
      onRejected: rejected
    })
    providePresenceStore(provider)

    const offscreenAdapter = new PresenceStoreInjectPortAdapter(bus.offscreen, namespace)
    const offscreenStore = injectPresenceStore(offscreenAdapter)
    await expect(offscreenStore.save(initial)).rejects.toThrow('session storage unavailable')
    await offscreenStore.save(initial)
    await expect(offscreenStore.load(DOMAIN)).resolves.toEqual(initial)

    const forgedResponse = vi.fn()
    const stopForgedObservation = offscreenAdapter.onMessage(forgedResponse)
    bus.sendRuntimeMessage(providerMessage('forged-response', namespace), {
      id: EXTENSION_ID,
      url: OPTIONS_URL,
      tab: { id: 8, url: OPTIONS_URL }
    })
    await settle()
    expect(forgedResponse).not.toHaveBeenCalled()
    expect(bus.runtimeMessageListenerCount()).toBe(0)
    if (typeof stopForgedObservation === 'function') await stopForgedObservation()

    const contentAdapter = new PresenceStoreInjectPortAdapter(bus.content, namespace)
    const optionsAdapter = new PresenceStoreInjectPortAdapter(bus.options, namespace)
    const contentStore = injectPresenceStore(contentAdapter)
    const optionsStore = injectPresenceStore(optionsAdapter)
    await expect(contentStore.load(DOMAIN)).rejects.toThrow('PresenceStore background port disconnected')
    await expect(optionsStore.save(forged)).rejects.toThrow('PresenceStore background port disconnected')
    await expect(backgroundStore.load(DOMAIN)).resolves.toEqual(initial)
    expect(new Set(rejected.mock.calls.map(([sender]) => sender?.url))).toEqual(new Set([DOMAIN, OPTIONS_URL]))

    holdNextLoad = true
    const interruptedLoad = offscreenStore.load(DOMAIN)
    await loadStarted.promise
    provider.dispose()
    await expect(interruptedLoad).rejects.toThrow('PresenceStore background port disconnected')
    releaseLoad.resolve()
    await settle()
    expect(providerErrors).not.toHaveBeenCalled()

    provider = new PresenceStoreProviderPortAdapter(bus.background, {
      portName: namespace,
      offscreenUrl: OFFSCREEN_URL
    })
    providePresenceStore(provider)
    await expect(offscreenStore.load(DOMAIN)).resolves.toEqual(initial)

    contentAdapter.dispose()
    optionsAdapter.dispose()
    offscreenAdapter.dispose()
    provider.dispose()
    expect(bus.activePortCount()).toBe(0)
    expect(bus.connectionListenerCount()).toBe(0)
  })
})
