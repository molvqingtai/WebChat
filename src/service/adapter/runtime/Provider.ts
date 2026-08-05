import type { Adapter, OnMessage, SendMessage } from 'comctx'
import { isComctxMessage, MessageListenerRegistry, type MessageApi } from '@/service/adapter/runtime/Core'
import { runtimeLifecycleLog } from '@/runtime/Debug'

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
      const tab = sender.tab ? { id: sender.tab.id, url: sender.tab.url } : undefined
      if (message.type === 'apply' && message.path.at(-1) === 'registerPage') {
        const lease = message.args?.[0]
        runtimeLifecycleLog('transport.provider.receive', {
          rpcId: message.id,
          pageId:
            typeof lease === 'object' && lease !== null && 'pageId' in lease && typeof lease.pageId === 'string'
              ? lease.pageId
              : null,
          tabId: tab?.id ?? null
        })
      }
      // Transport sender metadata replaces payload tab claims at the provider trust boundary.
      callback({
        ...message,
        ...(message.type === 'apply' && message.path.at(-1) === 'registerPage' && message.args?.length
          ? {
              args: [
                typeof message.args[0] === 'object' && message.args[0] !== null
                  ? { ...message.args[0], tab }
                  : message.args[0],
                ...message.args.slice(1)
              ]
            }
          : {}),
        meta: sender.tab ? { tab } : message.meta
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
