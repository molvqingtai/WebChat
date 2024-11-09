import { toast } from 'sonner'
import { ToastExtern } from '@/domain/externs/Toast'

export const ToastImpl = ToastExtern.impl({
  success: (message: string, duration: number = 4000) => {
    return toast.success(message, { duration })
  },
  error: (message: string, duration: number = 4000) => {
    return toast.error(message, { duration })
  },
  info: (message: string, duration: number = 4000) => {
    return toast.info(message, { duration })
  },
  warning: (message: string, duration: number = 4000) => {
    return toast.warning(message, { duration })
  },
  loading: (message: string, duration: number = 4000) => {
    const id = toast.loading(message, { duration })
    setTimeout(() => toast.dismiss(id), duration)
    return id
  },
  cancel: (id: number | string) => {
    return toast.dismiss(id)
  }
})
