import { DanmakuExtern } from '@/domain/externs/Danmaku'

import type { ProjectedTextMessage } from '@/domain/Message'
import { createElement } from 'react'
import DanmakuMessage from '@/app/content/components/danmaku-message'
import { createRoot } from 'react-dom/client'
import type { Manager } from 'danmu'
import { create } from 'danmu'

export class Danmaku {
  private container?: Element
  private onOpen?: () => void
  private manager?: Manager<ProjectedTextMessage>
  constructor() {
    this.manager = create<ProjectedTextMessage>({
      durationRange: [7000, 10000],
      plugin: {
        $createNode: (manager) => {
          if (!manager.node) return
          createRoot(manager.node).render(
            createElement(DanmakuMessage, {
              data: manager.data,
              onClick: () => this.onOpen?.(),
              onMouseEnter: () => manager.pause(),
              onMouseLeave: () => manager.resume()
            })
          )
        }
      }
    })
  }

  mount(container: HTMLElement, onOpen: () => void) {
    this.container = container
    this.onOpen = onOpen
    this.manager!.mount(container)
    this.manager!.startPlaying()
  }

  unmount() {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.unmount()
    this.container = undefined
    this.onOpen = undefined
  }

  push(message: ProjectedTextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this.manager!.push(message)
  }
}

export const DanmakuImpl = DanmakuExtern.impl(new Danmaku())
