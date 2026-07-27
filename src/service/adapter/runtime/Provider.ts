import type { Adapter, OnMessage, SendMessage } from 'comctx'
import { isComctxMessage, MessageListenerRegistry, type MessageApi } from '@/service/adapter/runtime/Core'

export interface MessageTab {
  id?: number
  url?: string
}

export interface MessageMeta {
  tab?: MessageTab
}

export interface MessageSender {
  url?: string
  tab?: MessageTab
}

export const createProviderOnMessage = (
  runtime: MessageApi,
  listeners: MessageListenerRegistry
): OnMessage<MessageMeta> => {
  return (callback) => {
    const handler = (rawMessage: unknown, sender: MessageSender) => {
      if (!isComctxMessage<MessageMeta>(rawMessage)) return
      const message = rawMessage
      // Transport sender metadata replaces payload tab claims at the provider trust boundary.
      callback({
        ...message,
        meta: sender.tab ? { tab: { id: sender.tab.id, url: sender.tab.url } } : message.meta
      })
    }
    runtime.onMessage.addListener(handler as (...args: unknown[]) => unknown)
    return listeners.add(() => runtime.onMessage.removeListener(handler as (...args: unknown[]) => unknown))
  }
}

export class ProviderAdapter implements Adapter<MessageMeta> {
  private readonly messageListeners = new MessageListenerRegistry()
  readonly onMessage: OnMessage<MessageMeta>

  constructor(private readonly runtime: MessageApi) {
    this.onMessage = createProviderOnMessage(runtime, this.messageListeners)
  }

  sendMessage: SendMessage<MessageMeta> = (message) => {
    this.runtime.sendMessage(message)
  }

  dispose() {
    this.messageListeners.dispose()
  }
}
