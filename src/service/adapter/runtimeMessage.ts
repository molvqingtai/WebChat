import { browser } from '#imports'
import type { Browser } from '#imports'
import type { Adapter, Message, SendMessage, OnMessage } from 'comctx'

export interface MessageTab {
  id?: number
  url?: string
}

export interface MessageMeta {
  tab?: MessageTab
}

export class ProvideAdapter implements Adapter<MessageMeta> {
  sendMessage: SendMessage<MessageMeta> = async (message) => {
    const tabs = await browser.tabs.query({ url: message.meta.tab?.url })

    tabs.map((tab) => browser.tabs.sendMessage(tab.id!, message))

    browser.runtime.sendMessage(message)
  }

  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (message: Partial<Message<MessageMeta>>, sender: Browser.runtime.MessageSender) => {
      callback({ ...message, meta: { tab: { id: sender.tab?.id, url: sender.tab?.url } } })
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}

export class InjectAdapter implements Adapter<MessageMeta> {
  sendMessage: SendMessage<MessageMeta> = (message) => {
    browser.runtime.sendMessage(browser.runtime.id, {
      ...message,
      meta: { tab: { url: document.location.href } }
    })
  }
  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (message?: Partial<Message<MessageMeta>>) => {
      callback(message)
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}
