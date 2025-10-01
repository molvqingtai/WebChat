import { Remesh } from 'remesh'
import type { ChatRoomTextMessage } from '@/protocol'

export interface Danmaku {
  push: (message: ChatRoomTextMessage) => void
  unshift: (message: ChatRoomTextMessage) => void
  clear: () => void
  mount: (root: HTMLElement) => void
  unmount: () => void
}

export const DanmakuExtern = Remesh.extern<Danmaku>({
  default: {
    mount: () => {
      throw new Error('"mount" not implemented.')
    },
    unmount() {
      throw new Error('"unmount" not implemented.')
    },
    clear: () => {
      throw new Error('"clear" not implemented.')
    },
    push: () => {
      throw new Error('"push" not implemented.')
    },
    unshift: () => {
      throw new Error('"unshift" not implemented.')
    }
  }
})
