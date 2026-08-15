import type { Adapter, Message, OnMessage, SendMessage } from 'comctx'
import { isComctxMessage } from '@/service/adapter/runtime/Core'

interface ListenerEvent<T extends (...args: never[]) => unknown> {
  addListener: (listener: T) => void
  removeListener: (listener: T) => void
}

export interface PresenceStorePortSender {
  id?: string
  url?: string
  tab?: unknown
}

export interface PresenceStorePort {
  name: string
  sender?: PresenceStorePortSender
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: ListenerEvent<(message: unknown) => void>
  onDisconnect: ListenerEvent<() => void>
}

export interface PresenceStorePortApi {
  id: string
  connect: (options: { name: string }) => PresenceStorePort
  onConnect: ListenerEvent<(port: PresenceStorePort) => void>
}

interface ProviderOptions {
  portName: string
  offscreenUrl: string
  onError?: (error: unknown) => void
  onRejected?: (sender: PresenceStorePortSender | undefined) => void
}

interface PortBinding {
  port: PresenceStorePort
  onMessage: (message: unknown) => void
  onDisconnect: () => void
  /** Set when the port's disconnect event fired, proving its already-terminal condition. */
  disconnected?: boolean
}

interface PendingRequest {
  request: Message
  binding: PortBinding
}

interface InjectorGeneration {
  binding?: PortBinding
  terminalReason?: string
}

interface RequestPreparation {
  generation: InjectorGeneration
  response: (message?: Partial<Message>) => void
  pending: boolean
}

const trustedOffscreen = (sender: PresenceStorePortSender | undefined, runtimeId: string, offscreenUrl: string) =>
  sender?.id === runtimeId && sender.url === offscreenUrl && !sender.tab

const dispatch = (
  callbacks: Set<(message?: Partial<Message>) => void>,
  message: Message,
  onError: (error: unknown) => void
) => {
  callbacks.forEach((callback) => {
    try {
      Promise.resolve(callback(message)).catch(onError)
    } catch (error) {
      onError(error)
    }
  })
}

/** Point-to-point provider for the Chrome background-owned PresenceStore. */
export class PresenceStoreProviderPortAdapter implements Adapter {
  readonly name = 'presence-store-background-provider'
  private readonly callbacks = new Set<(message?: Partial<Message>) => void>()
  private readonly requestPorts = new Map<string, PortBinding>()
  private active?: PortBinding

  constructor(
    private readonly runtime: PresenceStorePortApi,
    private readonly options: ProviderOptions
  ) {
    runtime.onConnect.addListener(this.acceptPort)
  }

  private readonly fail = (error: unknown) => this.options.onError?.(error)

  private readonly acceptPort = (port: PresenceStorePort) => {
    if (port.name !== this.options.portName) return
    if (!trustedOffscreen(port.sender, this.runtime.id, this.options.offscreenUrl)) {
      this.options.onRejected?.(port.sender)
      port.disconnect()
      return
    }

    const binding: PortBinding = {
      port,
      onMessage: (rawMessage) => {
        if (!isComctxMessage(rawMessage)) return
        if (rawMessage.namespace !== this.options.portName || rawMessage.sender.type !== 'injector') return
        this.requestPorts.set(rawMessage.id, binding)
        dispatch(this.callbacks, rawMessage, this.fail)
      },
      onDisconnect: () => {
        binding.disconnected = true
        this.detach(binding, false)
      }
    }
    port.onMessage.addListener(binding.onMessage)
    port.onDisconnect.addListener(binding.onDisconnect)

    const previous = this.active
    this.active = binding
    if (previous) this.detach(previous, true)
  }

  private detach(binding: PortBinding, disconnect: boolean) {
    binding.port.onMessage.removeListener(binding.onMessage)
    binding.port.onDisconnect.removeListener(binding.onDisconnect)
    this.requestPorts.forEach((requestPort, id) => {
      if (requestPort === binding) this.requestPorts.delete(id)
    })
    if (this.active === binding) this.active = undefined
    if (disconnect) {
      try {
        binding.port.disconnect()
      } catch (error) {
        this.fail(error)
      }
    }
  }

  sendMessage: SendMessage = (message) => {
    const binding = this.requestPorts.get(message.id)
    if (!binding) return
    this.requestPorts.delete(message.id)
    try {
      binding.port.postMessage(message)
    } catch (error) {
      this.fail(error)
      this.detach(binding, true)
    }
  }

  onMessage: OnMessage = (callback) => {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
    }
  }

  dispose() {
    this.runtime.onConnect.removeListener(this.acceptPort)
    if (this.active) this.detach(this.active, true)
    this.callbacks.clear()
    this.requestPorts.clear()
  }
}

/** Injector whose private Port can receive responses only from the background endpoint. */
export class PresenceStoreInjectPortAdapter implements Adapter {
  readonly name = 'presence-store-offscreen-injector'
  private readonly callbacks = new Set<(message?: Partial<Message>) => void>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly preparations: RequestPreparation[] = []
  private active?: PortBinding
  private current?: InjectorGeneration
  private disposed = false

  constructor(
    private readonly runtime: PresenceStorePortApi,
    private readonly portName: string
  ) {}

  private prepareGeneration() {
    if (!this.current || this.current.terminalReason) this.current = {}
    return this.current
  }

  private connect(generation: InjectorGeneration) {
    if (generation.terminalReason) throw new Error(generation.terminalReason)
    if (generation.binding) return generation.binding

    let port: PresenceStorePort
    try {
      port = this.runtime.connect({ name: this.portName })
    } catch (error) {
      generation.terminalReason = error instanceof Error ? error.message : String(error)
      this.releaseGenerationResponses(generation)
      throw error
    }
    const binding: PortBinding = {
      port,
      onMessage: (rawMessage) => {
        if (!isComctxMessage(rawMessage)) return
        if (rawMessage.namespace !== this.portName || rawMessage.sender.type !== 'provider') return
        const pending = this.pending.get(rawMessage.id)
        if (!pending || pending.binding !== binding) return
        this.pending.delete(rawMessage.id)
        dispatch(this.callbacks, rawMessage, () => {})
      },
      onDisconnect: () => {
        binding.disconnected = true
        this.detach(binding, false)
        this.terminate(generation, binding, 'PresenceStore background port disconnected')
      }
    }
    port.onMessage.addListener(binding.onMessage)
    port.onDisconnect.addListener(binding.onDisconnect)
    generation.binding = binding
    this.active = binding
    return binding
  }

  private terminate(generation: InjectorGeneration, binding: PortBinding, reason: string) {
    generation.terminalReason ??= reason
    this.releaseGenerationResponses(generation)
    this.rejectBindingPending(binding, generation.terminalReason)
  }

  private releaseGenerationResponses(generation: InjectorGeneration) {
    this.preparations.forEach((preparation) => {
      if (preparation.generation === generation) this.callbacks.delete(preparation.response)
    })
  }

  private detach(binding: PortBinding, disconnect: boolean) {
    binding.port.onMessage.removeListener(binding.onMessage)
    binding.port.onDisconnect.removeListener(binding.onDisconnect)
    if (this.active === binding) this.active = undefined
    if (disconnect && !binding.disconnected) {
      try {
        binding.port.disconnect()
      } catch (error) {
        // The disconnect event already proved the port terminal; reaching this throw means an
        // unexpected cleanup failure, which must not disappear.
        console.error(error)
      }
    }
  }

  private rejectBindingPending(binding: PortBinding, reason: string) {
    // from the live Map while dispatching its failure exactly once
    this.pending.forEach((pending, id) => {
      if (pending.binding !== binding) return
      this.pending.delete(id)
      dispatch(
        this.callbacks,
        {
          type: 'apply',
          sender: { type: 'provider', name: this.name },
          id: pending.request.id,
          path: pending.request.path,
          error: reason,
          meta: pending.request.meta,
          namespace: pending.request.namespace,
          timeStamp: Date.now()
        },
        () => {}
      )
    })
  }

  private rejectAllPending(reason: string) {
    new Set(this.pending.values()).forEach(({ binding }) => this.rejectBindingPending(binding, reason))
  }

  private takePreparation() {
    while (this.preparations.length > 0) {
      const preparation = this.preparations.shift()!
      if (!preparation.pending) continue
      preparation.pending = false
      return preparation
    }
  }

  private acknowledgeHeartbeat(message: Message) {
    const callbacks = new Set([...this.callbacks, ...this.preparations.map((preparation) => preparation.response)])
    dispatch(
      callbacks,
      {
        type: 'pong',
        sender: { type: 'provider', name: this.name },
        id: message.id,
        path: message.path,
        meta: message.meta,
        namespace: message.namespace,
        timeStamp: Date.now()
      },
      () => {}
    )
  }

  sendMessage: SendMessage = (message) => {
    if (this.disposed) throw new Error('PresenceStore Offscreen adapter disposed')
    // A dedicated Port reports liveness through send/disconnect. Keeping comctx's
    // preflight local ensures every transmitted operation has binding ownership.
    if (message.type === 'ping' && message.sender.type === 'injector') {
      this.acknowledgeHeartbeat(message)
      return
    }

    const preparation = this.takePreparation()
    const generation = preparation?.generation ?? this.prepareGeneration()
    let binding: PortBinding
    try {
      binding = this.connect(generation)
    } catch (error) {
      if (preparation) this.callbacks.delete(preparation.response)
      throw error
    }
    if (message.type === 'apply' && message.sender.type === 'injector') {
      this.pending.set(message.id, { request: message, binding })
    }
    try {
      binding.port.postMessage(message)
    } catch (error) {
      this.detach(binding, true)
      this.terminate(generation, binding, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  onMessage: OnMessage = (callback) => {
    if (this.disposed) throw new Error('PresenceStore Offscreen adapter disposed')
    this.callbacks.add(callback)
    const preparation: RequestPreparation = {
      generation: this.prepareGeneration(),
      response: callback,
      pending: true
    }
    this.preparations.push(preparation)
    return () => {
      this.callbacks.delete(callback)
      if (!preparation.pending) return
      preparation.pending = false
      const index = this.preparations.indexOf(preparation)
      if (index >= 0) this.preparations.splice(index, 1)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    const reason = 'PresenceStore Offscreen adapter disposed'
    if (this.current) this.current.terminalReason ??= reason
    this.preparations.forEach((preparation) => (preparation.generation.terminalReason ??= reason))
    if (this.active) this.detach(this.active, true)
    this.rejectAllPending(reason)
    this.preparations.length = 0
    this.callbacks.clear()
  }
}
