import { Remesh } from 'remesh'

export interface Toast {
  success: (message: string, duration?: number) => number | string
  error: (message: string, duration?: number) => number | string
  info: (message: string, duration?: number) => number | string
  warning: (message: string, duration?: number) => number | string
  loading: (message: string, duration?: number) => number | string
  cancel: (id: number | string) => number | string
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
    },
    loading: () => {
      throw new Error('"loading" not implemented.')
    },
    cancel: () => {
      throw new Error('"cancel" not implemented.')
    }
  }
})
