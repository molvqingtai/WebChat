import type { Message } from 'comctx'
import { isComctxMessage } from '@/service/adapter/runtime/Core'
import type { MessageMeta, MessageSender } from '@/service/adapter/runtime/Provider'
import type { TabsApi } from '@/service/adapter/runtime/Tabs'
import { isSameNavigation } from '@/service/adapter/runtime/Navigation'

type RelayMessageListener = (message: unknown, sender: MessageSender) => unknown

export interface RelayMessageApi {
  onMessage: {
    addListener: (listener: RelayMessageListener) => void
    removeListener: (listener: RelayMessageListener) => void
  }
}

export interface RelayRejection {
  reason:
    | 'untrusted-source'
    | 'invalid-direction'
    | 'invalid-namespace'
    | 'invalid-message'
    | 'invalid-target'
    | 'target-unavailable'
    | 'target-mismatch'
  targetId?: number
}

interface RelayOptions {
  runtime: RelayMessageApi
  tabs: TabsApi
  namespace: string
  offscreenUrl: string
  onRejected?: (rejection: RelayRejection) => void
}

const targetFromMessage = (message: Partial<Message<MessageMeta>>) => {
  const id = message.meta?.tab?.id
  const url = message.meta?.tab?.url
  if (!Number.isSafeInteger(id) || id! < 0 || typeof url !== 'string') return null
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch {
    return null
  }
  return { id: id!, url }
}

export const relayOffscreenProviderMessages = (options: RelayOptions) => {
  const reject = (
    reason: RelayRejection['reason'],
    message?: Partial<Message<MessageMeta>>,
    target = message ? targetFromMessage(message) : null
  ) => {
    options.onRejected?.({ reason, ...(target ? { targetId: target.id } : {}) })
  }

  /**
   * Namespace, instance, direction, and sender guards keep one Runtime message graph from crossing into another.
   * @see https://github.com/aklinker1/webext-core/pull/70
   */
  const handler = (rawMessage: unknown, sender: MessageSender) => {
    const fromOffscreen = sender.url === options.offscreenUrl
    if (!isComctxMessage<MessageMeta>(rawMessage)) {
      if (fromOffscreen) reject('invalid-message')
      return
    }

    const message = rawMessage
    const claimsProvider = message.sender?.type === 'provider'
    if (message.namespace !== options.namespace) {
      if (fromOffscreen && claimsProvider) reject('invalid-namespace', message)
      return
    }
    if (!fromOffscreen && !claimsProvider) return
    if (!fromOffscreen) return reject('untrusted-source', message)
    if (!claimsProvider) return reject('invalid-direction', message)
    if (!message.meta?.tab) return
    const target = targetFromMessage(message)
    if (!target) return reject('invalid-target', message)

    // Re-read the tab and require the original HTTPS URL so recycled ids cannot receive another page's RPC.
    void options.tabs
      .get(target.id)
      .then((tab) => {
        if (typeof tab.url !== 'string' || !isSameNavigation(tab.url, target.url)) {
          return reject('target-mismatch', message, target)
        }
        return options.tabs.sendMessage(target.id, message)
      })
      .catch(() => reject('target-unavailable', message, target))
  }

  options.runtime.onMessage.addListener(handler)
  return () => options.runtime.onMessage.removeListener(handler)
}
