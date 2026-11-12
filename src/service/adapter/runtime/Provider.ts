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
    const handler = (...args: unknown[]) => {
      const rawMessage = args[0]
      if (!isComctxMessage<MessageMeta>(rawMessage)) return
      // SAFETY: comctx delivers the browser MessageSender as the second listener argument.
      const sender = args[1] as MessageSender
      const message = rawMessage
      const tab = sender.tab ? { id: sender.tab.id, url: sender.tab.url } : undefined
      // Browser-delivery facts replace every Page payload claim at the provider trust boundary.
      // Runtime methods receive this value as data because comctx transports only method arguments.
      const resolvedArgs =
        message.type === 'apply' && message.args?.length
          ? [
              // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the first method argument
              typeof message.args[0] === 'object' && message.args[0] !== null
                ? { ...message.args[0], caller: sender.tab ? { tab } : undefined }
                : message.args[0],
              ...message.args.slice(1)
            ]
          : message.args
      callback({ ...message, args: resolvedArgs, meta: sender.tab ? { tab } : message.meta })
    }
    runtime.onMessage.addListener(handler)
    return listeners.add(() => runtime.onMessage.removeListener(handler))
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
