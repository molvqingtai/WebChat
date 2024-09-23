import { toast } from 'sonner'
import { ToastExtern } from '@/domain/externs/Toast'

export const ToastImpl = ToastExtern.impl({
  success: (message: string) => {
    toast.success(message)
  },
  error: (message: string) => {
    toast.error(message)
  },
  info: (message: string) => {
    toast.info(message)
  },
  warning: (message: string) => {
    toast.warning(message)
  }
})
