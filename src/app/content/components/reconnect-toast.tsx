import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useRemeshDomain, useRemeshEvent, useRemeshQuery, useRemeshSend, useRemeshStore } from 'remesh-react'
import AppStatusDomain from '@/domain/AppStatus'
import ChatRoomDomain from '@/domain/ChatRoom'

const RECONNECT_PRESENTATION_TIMEOUT_MS = 1000

const reconnectFeedbackId = (requestId: number) => `webchat-reconnect-${requestId}`

const afterRenderedPaint = (
  toaster: HTMLElement,
  testId: string,
  onPresented: () => void,
  onUnavailable: () => void
) => {
  let frame: number | null = null
  let timeout: ReturnType<typeof setTimeout>
  let eligibleFrames = 0
  let settled = false

  const finish = (callback: () => void) => {
    if (settled) return
    settled = true
    if (frame !== null) cancelAnimationFrame(frame)
    clearTimeout(timeout)
    callback()
  }

  const observe = () => {
    const item = toaster.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    const opacity = item ? Number.parseFloat(getComputedStyle(item).opacity || '1') : 0
    const eligible =
      item?.getAttribute('data-mounted') === 'true' &&
      item.getAttribute('data-visible') === 'true' &&
      item.getAttribute('data-removed') !== 'true' &&
      Number.isFinite(opacity) &&
      opacity > 0

    eligibleFrames = eligible ? eligibleFrames + 1 : 0
    if (eligibleFrames >= 3) {
      finish(onPresented)
      return
    }
    frame = requestAnimationFrame(observe)
  }

  timeout = setTimeout(() => finish(onUnavailable), RECONNECT_PRESENTATION_TIMEOUT_MS)
  frame = requestAnimationFrame(observe)

  return () => {
    settled = true
    if (frame !== null) cancelAnimationFrame(frame)
    clearTimeout(timeout)
  }
}

export const useReconnectToast = () => {
  const store = useRemeshStore()
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const panelOpen = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const request = useRemeshQuery(chatRoomDomain.query.ReconnectRequestQuery())
  const toasterRef = useRef<HTMLElement>(null)
  const terminalToastIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (panelOpen || terminalToastIdRef.current === null) return
    toast.dismiss(terminalToastIdRef.current)
    terminalToastIdRef.current = null
  }, [panelOpen])

  useRemeshEvent(chatRoomDomain.event.ReconnectStartedEvent, () => {
    if (terminalToastIdRef.current === null) return
    toast.dismiss(terminalToastIdRef.current)
    terminalToastIdRef.current = null
  })

  useRemeshEvent(chatRoomDomain.event.ReconnectFinishedEvent, ({ id, error }) => {
    const feedbackId = reconnectFeedbackId(id)
    if (!store.query(appStatusDomain.query.OpenQuery())) {
      toast.dismiss(feedbackId)
      return
    }

    if (error) {
      toast.error(error.message, { id: feedbackId, testId: feedbackId })
    } else {
      toast.success('Ready to chat', { id: feedbackId, testId: feedbackId })
    }
    terminalToastIdRef.current = feedbackId
  })

  useEffect(() => {
    if (!request) return
    const feedbackId = reconnectFeedbackId(request.id)

    if (!panelOpen) {
      if (request.feedback.phase !== 'complete') {
        if (request.feedback.attempted) toast.dismiss(feedbackId)
        send(chatRoomDomain.command.FailReconnectFeedbackCommand(request.id))
      }
      return
    }

    if (!request.feedback.attempted) {
      send(chatRoomDomain.command.BeginReconnectFeedbackCommand(request.id))
      return
    }

    if (request.feedback.phase !== 'presenting') return

    toast.loading('Reconnecting to the chat...', {
      id: feedbackId,
      testId: feedbackId,
      dismissible: false
    })

    const toaster = toasterRef.current
    if (!toaster) {
      send(chatRoomDomain.command.FailReconnectFeedbackCommand(request.id))
      return
    }

    return afterRenderedPaint(
      toaster,
      feedbackId,
      () => send(chatRoomDomain.command.PresentReconnectCommand(request.id)),
      () => send(chatRoomDomain.command.FailReconnectFeedbackCommand(request.id))
    )
  }, [chatRoomDomain.command, panelOpen, request, send])

  return toasterRef
}
