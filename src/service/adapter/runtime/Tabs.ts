import type { Adapter, OnMessage, SendMessage } from 'comctx'
import { MessageListenerRegistry, type MessageApi } from '@/service/adapter/runtime/Core'
import { createProviderOnMessage, type MessageMeta, type MessageTab } from '@/service/adapter/runtime/Provider'
import { isSameNavigation } from '@/service/adapter/runtime/Navigation'
import { runtimeErrorName, runtimeLifecycleLog } from '@/runtime/Debug'

export interface TabsApi {
  query: (query: { url?: string }) => Promise<MessageTab[]>
  get: (tabId: number) => Promise<MessageTab>
  sendMessage: (tabId: number, message: unknown) => unknown
}

export class TabsProviderAdapter implements Adapter<MessageMeta> {
  private readonly messageListeners = new MessageListenerRegistry()
  readonly onMessage: OnMessage<MessageMeta>

  constructor(
    private readonly runtime: MessageApi,
    private readonly tabs: TabsApi
  ) {
    this.onMessage = createProviderOnMessage(runtime, this.messageListeners)
  }

  sendMessage: SendMessage<MessageMeta> = async (message) => {
    const target = message.meta.tab
    const registerPage = message.path.at(-1) === 'registerPage'
    if (registerPage) {
      runtimeLifecycleLog('transport.provider.reply.start', {
        rpcId: message.id,
        tabId: target?.id ?? null
      })
    }
    const tabDelivery =
      Number.isSafeInteger(target?.id) && target!.id! >= 0 && typeof target?.url === 'string'
        ? this.tabs.get(target!.id!).then((tab) => {
            if (typeof tab.url === 'string' && isSameNavigation(tab.url, target!.url!)) {
              return this.tabs.sendMessage(target!.id!, message)
            }
          })
        : Promise.resolve()
    const results = await Promise.allSettled([tabDelivery, Promise.resolve(this.runtime.sendMessage(message))])
    if (registerPage) {
      runtimeLifecycleLog('transport.provider.reply.finish', {
        rpcId: message.id,
        tabId: target?.id ?? null,
        tabDelivery:
          results[0].status === 'fulfilled'
            ? 'fulfilled'
            : { status: 'rejected', ...runtimeErrorName(results[0].reason) },
        runtimeDelivery:
          results[1].status === 'fulfilled'
            ? 'fulfilled'
            : { status: 'rejected', ...runtimeErrorName(results[1].reason) }
      })
    }
  }

  dispose() {
    this.messageListeners.dispose()
  }
}
