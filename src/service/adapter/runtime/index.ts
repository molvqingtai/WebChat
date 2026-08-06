import { browser } from '#imports'
import type { SendMessage } from 'comctx'
import { InjectAdapterBase, type MessageApi } from '@/service/adapter/runtime/Core'
import { relayOffscreenProviderMessages } from '@/service/adapter/runtime/Relay'
import type { MessageMeta } from '@/service/adapter/runtime/Provider'
import { TabsProviderAdapter, type TabsApi } from '@/service/adapter/runtime/Tabs'
import { canonicalNavigationUrl } from '@/service/adapter/runtime/Navigation'

export type { MessageMeta, MessageTab } from '@/service/adapter/runtime/Provider'
export type { RelayRejection } from '@/service/adapter/runtime/Relay'
export { relayOffscreenProviderMessages }

const defaultRuntime = browser.runtime as unknown as MessageApi
const defaultTabs = browser.tabs as unknown as TabsApi

export class ProvideAdapter extends TabsProviderAdapter {
  constructor(runtime: MessageApi = defaultRuntime, tabs: TabsApi = defaultTabs) {
    super(runtime, tabs)
  }
}

export class InjectAdapter extends InjectAdapterBase<MessageMeta> {
  constructor(runtime: MessageApi = defaultRuntime) {
    super(runtime)
  }

  sendMessage: SendMessage<MessageMeta> = async (message) => {
    await this.runtime.sendMessage(this.runtime.id, {
      ...message,
      meta: { tab: { url: canonicalNavigationUrl(document.location.href) ?? document.location.href } }
    })
  }
}
