import { toast } from 'sonner'
import { ToastExtern, type ToastOptions } from '@/domain/externs/Toast'

const normalizeOptions = (options?: ToastOptions | number): ToastOptions | undefined =>
  typeof options === 'number' ? { duration: options } : options

const timedOptions = (options?: ToastOptions | number) => {
  const normalized = normalizeOptions(options)
  return { ...normalized, duration: normalized?.duration ?? 4000 }
}

export const ToastImpl = ToastExtern.impl({
  success: (message: string, options?: ToastOptions | number) => {
    return toast.success(message, timedOptions(options))
  },
  error: (message: string, options?: ToastOptions | number) => {
    return toast.error(message, timedOptions(options))
  },
  info: (message: string, options?: ToastOptions | number) => {
    return toast.info(message, timedOptions(options))
  },
  warning: (message: string, options?: ToastOptions | number) => {
    return toast.warning(message, timedOptions(options))
  },
  loading: (message: string, options?: ToastOptions | number) => {
    const normalized = normalizeOptions(options) ?? { duration: undefined }
    const id = toast.loading(message, normalized)
    if (normalized?.duration !== undefined) setTimeout(() => toast.dismiss(id), normalized.duration)
    return id
  },
  cancel: (id: number | string) => {
    return toast.dismiss(id)
  }
})
