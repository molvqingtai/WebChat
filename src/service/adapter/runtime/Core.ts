import { checkMessage } from 'comctx'
import type { Adapter, Message, MessageMeta, OnMessage, SendMessage } from 'comctx'

const isMessageObject = (message: unknown): message is Partial<Message> =>
  message !== null && typeof message === 'object' && !Array.isArray(message)

export const isComctxMessage = <T extends MessageMeta>(message: unknown): message is Message<T> =>
  isMessageObject(message) && checkMessage(message)

export interface MessageApi {
  id: string
  sendMessage: (...args: unknown[]) => unknown
  onMessage: {
    addListener: (listener: (...args: unknown[]) => unknown) => void
    removeListener: (listener: (...args: unknown[]) => unknown) => void
  }
}

/** Owns adapter listeners so host replacement cannot leave a second live Runtime message graph. */
export class MessageListenerRegistry {
  private readonly disposers = new Set<() => void>()

  add(disposeListener: () => void) {
    const dispose = () => {
      disposeListener()
      this.disposers.delete(dispose)
    }
    this.disposers.add(dispose)
    return dispose
  }

  dispose() {
    let firstError: unknown
    // The live disposer Set is iterated directly: a disposer registered during disposal joins
    // the same pass, and the first non-nullish thrown value is retained, then thrown only if
    // it is truthy, matching the frozen semantics.
    for (const dispose of this.disposers) {
      try {
        dispose()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }
}

export abstract class InjectAdapterBase<T extends MessageMeta> implements Adapter<T> {
  constructor(protected readonly runtime: MessageApi) {}

  abstract sendMessage: SendMessage<T>

  onMessage: OnMessage<T> = (callback) => {
    const handler = (message: unknown) => {
      // Extension messages stay unknown until the strict comctx envelope guard succeeds.
      if (!isComctxMessage<T>(message)) return
      callback(message)
    }
    this.runtime.onMessage.addListener(handler as (...args: unknown[]) => unknown)
    return () => this.runtime.onMessage.removeListener(handler as (...args: unknown[]) => unknown)
  }
}

export class BackgroundInjectAdapter<T extends MessageMeta> extends InjectAdapterBase<T> {
  sendMessage: SendMessage<T> = (message) => {
    this.runtime.sendMessage(this.runtime.id, { ...message, meta: {} })
  }
}
