import { Remesh } from 'remesh'

export interface Toast {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

export const ToastExtern = Remesh.extern<Toast>({
  default: {
    success: () => {
      throw new Error('"success" not implemented.')
    },
    error: () => {
      throw new Error('"error" not implemented.')
    },
    info: () => {
      throw new Error('"info" not implemented.')
    },
    warning: () => {
      throw new Error('"warning" not implemented.')
    }
  }
})
