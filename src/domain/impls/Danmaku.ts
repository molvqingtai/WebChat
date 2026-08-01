import { DanmakuExtern } from '@/domain/externs/Danmaku'

import type { ProjectedTextMessage } from '@/domain/Message'
import { createElement } from 'react'
import DanmakuMessage from '@/app/content/components/danmaku-message'
import { createRoot } from 'react-dom/client'
import type { Manager } from 'danmu'
import { create } from 'danmu'
import { LocalStorageImpl } from './Storage'
import { APP_OPEN_STORAGE_KEY, APP_UNREAD_STORAGE_KEY } from '@/constants/storage'
import { EVENT } from '@/constants/event'

export class Danmaku {
  private container?: Element
  private manager?: Manager<ProjectedTextMessage>
  constructor() {
    this.manager = create<ProjectedTextMessage>({
      durationRange: [7000, 10000],
      plugin: {
        $createNode(manager) {
          if (!manager.node) return
          createRoot(manager.node).render(
            createElement(DanmakuMessage, {
              data: manager.data,
              onClick: async () => {
                const appOpen = await LocalStorageImpl.value.get<boolean>(APP_OPEN_STORAGE_KEY)
                if (appOpen) return
                await Promise.all([
                  LocalStorageImpl.value.set(APP_OPEN_STORAGE_KEY, true),
                  LocalStorageImpl.value.set(APP_UNREAD_STORAGE_KEY, false)
                ])
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

  push(message: ProjectedTextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.push(message)
  }

  unshift(message: ProjectedTextMessage) {
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
