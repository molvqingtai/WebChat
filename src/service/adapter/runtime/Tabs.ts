import type { Adapter, OnMessage, SendMessage } from 'comctx'
import { MessageListenerRegistry, type MessageApi } from '@/service/adapter/runtime/Core'
import { createProviderOnMessage, type MessageMeta, type MessageTab } from '@/service/adapter/runtime/Provider'

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
    // Fan out to matching pages and Runtime without letting one closed receiver cancel the remaining deliveries.
    const tabs = await this.tabs.query({ url: message.meta.tab?.url })
    await Promise.allSettled([
      ...tabs.flatMap((tab) => (tab.id === undefined ? [] : [Promise.resolve(this.tabs.sendMessage(tab.id, message))])),
      Promise.resolve(this.runtime.sendMessage(message))
    ])
  }

  dispose() {
    this.messageListeners.dispose()
  }
}
