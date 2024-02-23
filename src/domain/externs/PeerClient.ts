import { Remesh } from 'remesh'

export interface PeerClient {
  connect: (id: string) => Promise<void>
  sendMessage: (message: string) => Promise<void>
  onMessage: (callback: (message: string) => void) => void
  close: () => Promise<void> | void
}

export const PeerClientExtern = Remesh.extern<PeerClient>({
  default: {
    connect: async () => {
      throw new Error('"connect" not implemented.')
    },
    sendMessage: async () => {
      throw new Error('"sendMessage" not implemented.')
    },
    onMessage: () => {
      throw new Error('"onMessage" not implemented.')
    },
    close: () => {
      throw new Error('"close" not implemented.')
    }
  }
})
