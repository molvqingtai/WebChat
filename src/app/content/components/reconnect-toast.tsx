import { type FC, useEffect, useRef } from 'react'
import { Toaster, toast } from 'sonner'
import { useRemeshDomain, useRemeshEvent, useRemeshQuery, useRemeshSend, useRemeshStore } from 'remesh-react'
import AppStatusDomain from '@/domain/AppStatus'
import ChatRoomDomain from '@/domain/ChatRoom'

const reconnectFeedbackIds = (requestId: number) => ({
  loading: `webchat-reconnect-${requestId}-loading`,
  error: `webchat-reconnect-${requestId}-error`
})

const afterRenderedPaint = (toaster: HTMLElement, testId: string, callback: () => void) => {
  let firstFrame: number | null = null
  let secondFrame: number | null = null
  const observer = new MutationObserver(() => schedule())
  const schedule = () => {
    if (firstFrame !== null) return
    const item = toaster.querySelector(`[data-testid="${testId}"][data-mounted="true"][data-visible="true"]`)
    if (!item) return
    observer.disconnect()
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(callback)
    })
  }

  observer.observe(toaster, { attributes: true, childList: true, subtree: true })
  schedule()

  return () => {
    observer.disconnect()
    if (firstFrame !== null) cancelAnimationFrame(firstFrame)
    if (secondFrame !== null) cancelAnimationFrame(secondFrame)
  }
}

export const ReconnectToastLifecycle: FC = () => {
  const store = useRemeshStore()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const panelOpen = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const errorIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (panelOpen || errorIdRef.current === null) return
    toast.dismiss(errorIdRef.current)
    errorIdRef.current = null
  }, [panelOpen])

  useRemeshEvent(chatRoomDomain.event.ReconnectStartedEvent, () => {
    if (errorIdRef.current === null) return
    toast.dismiss(errorIdRef.current)
    errorIdRef.current = null
  })

  useRemeshEvent(chatRoomDomain.event.ReconnectFinishedEvent, ({ id, error }) => {
    const feedback = reconnectFeedbackIds(id)
    toast.dismiss(feedback.loading)
    if (error && store.query(appStatusDomain.query.OpenQuery())) {
      toast.error(error.message, { id: feedback.error, testId: feedback.error })
      errorIdRef.current = feedback.error
    }
  })

  return null
}

export const PanelToaster: FC<{ theme: 'light' | 'dark' }> = ({ theme }) => {
  const send = useRemeshSend()
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const request = useRemeshQuery(chatRoomDomain.query.ReconnectRequestQuery())
  const toasterRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!request) return
    const feedback = reconnectFeedbackIds(request.id)
    toast.loading('Reconnecting to the chat...', {
      id: feedback.loading,
      testId: feedback.loading,
      dismissible: false
    })
    if (request.phase !== 'presenting' || !toasterRef.current) return
    return afterRenderedPaint(toasterRef.current, feedback.loading, () => {
      send(chatRoomDomain.command.PresentReconnectCommand(request.id))
    })
  }, [chatRoomDomain.command, request, send])

  return (
    <div className="pointer-events-none absolute inset-0">
      <Toaster
        ref={toasterRef}
        richColors
        theme={theme}
        offset="70px"
        visibleToasts={1}
        className="pointer-events-auto"
        toastOptions={{
          classNames: {
            toast: 'dark:bg-slate-950 border dark:border-slate-600'
          }
        }}
        position="top-center"
      />
    </div>
  )
}
