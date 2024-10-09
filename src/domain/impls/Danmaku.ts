import { DanmakuExtern } from '@/domain/externs/Danmaku'

import { TextMessage } from '@/domain/Room'
import { createElement } from 'react'
import DanmakuMessage from '@/app/content/components/DanmakuMessage'
import { createRoot } from 'react-dom/client'
import { create, Manager } from 'danmu'

export class Danmaku {
  private container?: Element
  private manager?: Manager<TextMessage>
  constructor() {
    this.manager = create<TextMessage>({
      durationRange: [10000, 13000],
      plugin: {
        $createNode(manager) {
          if (!manager.node) return
          createRoot(manager.node).render(
            createElement(DanmakuMessage, {
              data: manager.data,
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
