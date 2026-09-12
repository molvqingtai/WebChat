import type { Adapter, OnMessage, SendMessage } from 'comctx'
import { MessageListenerRegistry, type MessageApi } from '@/service/adapter/runtime/Core'
import { createProviderOnMessage, type MessageMeta, type MessageTab } from '@/service/adapter/runtime/Provider'
import { isSameNavigation } from '@/service/adapter/runtime/Navigation'

export interface TabsApi {
  query: (query: { url?: string }) => Promise<MessageTab[]>
  get: (tabId: number) => Promise<MessageTab>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- tabs message API contract
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
    const tabDelivery =
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the optional tab target
      Number.isSafeInteger(target?.id) && target!.id! >= 0 && typeof target?.url === 'string'
        ? this.tabs.get(target!.id!).then((tab) => {
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the delivered tab record
            if (typeof tab.url === 'string' && isSameNavigation(tab.url, target!.url!)) {
              return this.tabs.sendMessage(target!.id!, message)
            }
          })
        : Promise.resolve()
    await Promise.allSettled([tabDelivery, Promise.resolve(this.runtime.sendMessage(message))])
  }

  dispose() {
    this.messageListeners.dispose()
  }
}
