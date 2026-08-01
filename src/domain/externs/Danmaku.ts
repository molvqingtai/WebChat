import { Remesh } from 'remesh'
import type { ProjectedTextMessage } from '@/domain/Message'

export interface Danmaku {
  push: (message: ProjectedTextMessage) => void
  mount: (root: HTMLElement, onOpen: () => void) => void
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
    push: () => {
      throw new Error('"push" not implemented.')
    }
  }
})
