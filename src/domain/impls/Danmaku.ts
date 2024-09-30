import { DanmakuExtern } from '@/domain/externs/Danmaku'

import { TextMessage } from '@/domain/Room'
import { createElement } from 'react'
import _Danmaku from 'danmaku'
import DanmakuMessage from '@/app/content/components/DanmakuMessage'
import { createRoot } from 'react-dom/client'

// import { create } from 'danmaku'
// const manager = create<TextMessage>({
//   trackHeight: '20%',
//   plugin: {
//     init(manager) {
//       'shadow shadow-slate-200 bg-slate-100'.split(' ').forEach((c) => {
//         manager.container.node.classList.add(c)
//       })
//     },
//     $createNode(dm) {
//       if (!dm.node) return
//       createRoot(dm.node).render(createElement(DanmakuMessage, { data: dm.data }))
//     }
//   }
// })

// manager.mount(document.body)
// manager.startPlaying()

export class Danmaku {
  private container?: Element
  private _danmaku?: _Danmaku

  mount(container: HTMLElement) {
    this.container = container

    this._danmaku = new _Danmaku({
      container
    })
  }

  destroy() {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this._danmaku!.destroy()
  }

  push(message: TextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }

    const root = document.createElement('div')
    createRoot(root).render(createElement(DanmakuMessage, { data: message }))

    // Wait for React render to complete
    requestIdleCallback(() => {
      this._danmaku!.emit({
        render() {
          return root.firstElementChild! as HTMLElement
        }
      })
    })
  }

  unshift(message: TextMessage) {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    // console.log(message)
  }

  clear() {
    if (!this.container) {
      throw new Error('Danmaku not mounted')
    }
    this._danmaku!.clear()
  }
}

export const DanmakuImpl = DanmakuExtern.impl(new Danmaku())
