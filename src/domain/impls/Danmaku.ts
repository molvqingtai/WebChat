import { DanmakuExtern } from '@/domain/externs/Danmaku'

import { TextMessage } from '@/domain/ChatRoom'
import { createElement } from 'react'
import DanmakuMessage from '@/app/content/components/DanmakuMessage'
import { createRoot } from 'react-dom/client'
import { create, Manager } from 'danmu'
import { LocalStorageImpl } from './Storage'
import { AppStatus } from '../AppStatus'
import { APP_STATUS_STORAGE_KEY } from '@/constants/config'
import { EVENT } from '@/constants/event'

export class Danmaku {
  private container?: Element
  private manager?: Manager<TextMessage>
  constructor() {
    this.manager = create<TextMessage>({
      durationRange: [7000, 10000],
      plugin: {
        $createNode(manager) {
          if (!manager.node) return
          createRoot(manager.node).render(
            createElement(DanmakuMessage, {
              data: manager.data,
              onClick: async () => {
                const appStatus = await LocalStorageImpl.value.get<AppStatus>(APP_STATUS_STORAGE_KEY)
                LocalStorageImpl.value.set<AppStatus>(APP_STATUS_STORAGE_KEY, { ...appStatus!, open: true, unread: 0 })
                dispatchEvent(new CustomEvent(EVENT.APP_OPEN))
              },
              onMouseEnter: () => manager.pause(),
              onMouseLeave: () => manager.resume()
            })
          )
        }
      }
    })
  }

  mount(container: HTMLElement) {
    this.container = container
    this.manager!.mount(container)
    this.manager!.startPlaying()
  }

  unmount() {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.unmount()
  }

  push(message: TextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.push(message)
  }

  unshift(message: TextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.unshift(message)
  }

  clear() {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.clear()
  }
}

export const DanmakuImpl = DanmakuExtern.impl(new Danmaku())
