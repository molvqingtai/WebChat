import { browser } from '#imports'
import type { SendMessage } from 'comctx'
import { InjectAdapterBase, type MessageApi } from '@/service/adapter/runtime/Core'
import type { MessageMeta } from '@/service/adapter/runtime/Provider'
import { TabsProviderAdapter, type TabsApi } from '@/service/adapter/runtime/Tabs'
import { canonicalNavigationUrl } from '@/service/adapter/runtime/Navigation'

export type { MessageMeta, MessageTab } from '@/service/adapter/runtime/Provider'

const defaultRuntime = (() => {
  // SAFETY: browser.runtime is the extension runtime object; widen once before re-narrowing.
  const raw = browser.runtime as unknown
  // SAFETY: raw is the browser.runtime object narrowed to the comctx MessageApi contract.
  return raw as MessageApi
})()
const defaultTabs = (() => {
  // SAFETY: browser.tabs is the extension tabs object; widen once before re-narrowing.
  const raw = browser.tabs as unknown
  // SAFETY: raw is the browser.tabs object narrowed to the TabsApi contract.
  return raw as TabsApi
})()
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- inject rejection reasons are untyped
let injectRejectionOwner: ((error: unknown) => void) | null = null

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- inject rejection reasons are untyped
export const ownInjectRejections = (owner: (error: unknown) => void) => {
  if (injectRejectionOwner) throw new Error('Content Runtime rejection owner is already registered')
  injectRejectionOwner = owner
  return () => {
    if (injectRejectionOwner === owner) injectRejectionOwner = null
  }
}

export class ProvideAdapter extends TabsProviderAdapter {
  constructor(runtime: MessageApi = defaultRuntime, tabs: TabsApi = defaultTabs) {
    super(runtime, tabs)
  }
}

export class InjectAdapter extends InjectAdapterBase<MessageMeta> {
  constructor(runtime: MessageApi = defaultRuntime) {
    super(runtime)
  }

  sendMessage: SendMessage<MessageMeta> = (message) => {
    const sending = this.runtime.sendMessage(this.runtime.id, {
      ...message,
      meta: { tab: { url: canonicalNavigationUrl(document.location.href) ?? document.location.href } }
    })
    const owner = injectRejectionOwner
    if (owner) void Promise.resolve(sending).catch(owner)
    // SAFETY: `sending` is the value returned by the comctx sendMessage contract for this meta.
    return sending as ReturnType<SendMessage<MessageMeta>>
  }
}
