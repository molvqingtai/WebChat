import { Remesh } from 'remesh'

export interface Toast {
  success: (message: string, options?: ToastOptions | number) => number | string
  error: (message: string, options?: ToastOptions | number) => number | string
  info: (message: string, options?: ToastOptions | number) => number | string
  warning: (message: string, options?: ToastOptions | number) => number | string
  loading: (message: string, options?: ToastOptions | number) => number | string
  cancel: (id: number | string) => number | string
}

export interface ToastOptions {
  id?: number | string
  duration?: number
  dismissible?: boolean
  testId?: string
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
