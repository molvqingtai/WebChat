import '@webcomponents/custom-elements'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRemeshDomain, useRemeshEvent, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Toaster } from 'sonner'
import Header from '@/app/content/views/header'
import Footer from '@/app/content/views/footer'
import Main from '@/app/content/views/main'
import Setup from '@/app/content/views/setup'
import AppLayout from '@/app/content/views/app-layout'
import DanmakuContainer from '@/app/content/components/danmaku-container'
import MediaPreview, {
  MediaPreviewContext,
  type MediaPreviewHandle,
  type MediaPreviewRequest
} from '@/app/content/components/media-preview'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import MessageListDomain from '@/domain/MessageList'
import WorldRoomDomain from '@/domain/WorldRoom'
import DanmakuDomain from '@/domain/Danmaku'
import AppStatusDomain from '@/domain/AppStatus'
import type { HistorySyncCompletedEvent } from '@/domain/externs/ChatRoom'
import { checkDarkMode, cn } from '@/utils'

if (import.meta.env.FIREFOX) {
  window.requestAnimationFrame = window.requestAnimationFrame.bind(window)
}

const App = () => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const initializationReady = useRemeshQuery(appStatusDomain.query.ReadyQuery())
  const appOpenStatus = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const worldRoomDomain = useRemeshDomain(WorldRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const chatRoomJoinIsFinished = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const worldRoomJoinIsFinished = useRemeshQuery(worldRoomDomain.query.JoinIsFinishedQuery())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const danmakuIsEnabled = userInfo?.danmakuEnabled ?? false
  const danmakuContainerRef = useRef<HTMLDivElement>(null)
  const mediaPreviewRef = useRef<MediaPreviewHandle>(null)
  const [localSendToken, setLocalSendToken] = useState(0)
  const [historySyncIntents, setHistorySyncIntents] = useState<readonly HistorySyncCompletedEvent[]>([])
  const historySyncIntentKeysRef = useRef(new Set<string>())
  const historySyncIntent = historySyncIntents[0] ?? null
  const openMediaPreview = useCallback((request: MediaPreviewRequest) => mediaPreviewRef.current?.open(request), [])
  const handleLocalTextSent = useCallback(() => setLocalSendToken((token) => token + 1), [])
  const consumeHistorySyncIntent = useCallback(
    (syncId: string) =>
      setHistorySyncIntents((intents) => (intents[0]?.syncId === syncId ? intents.slice(1) : intents)),
    []
  )

  useRemeshEvent(chatRoomDomain.event.HistorySyncCompletedEvent, (completion) => {
    if (!completion.inserted) return
    const key = `${window.location.origin}:${completion.syncId}`
    if (historySyncIntentKeysRef.current.has(key)) return
    historySyncIntentKeysRef.current.add(key)
    setHistorySyncIntents((intents) => [...intents, completion])
  })

  useEffect(() => {
    if (initializationReady && messageListLoadFinished && userInfoSetFinished) {
      send(chatRoomDomain.command.JoinRoomCommand())
    }
  }, [initializationReady, userInfoSetFinished, messageListLoadFinished, send, chatRoomDomain.command])

  useEffect(() => {
    if (initializationReady && chatRoomJoinIsFinished && !worldRoomJoinIsFinished) {
      send(worldRoomDomain.command.JoinRoomCommand())
    }
  }, [initializationReady, chatRoomJoinIsFinished, worldRoomJoinIsFinished, send, worldRoomDomain.command])

  useEffect(() => {
    if (danmakuIsEnabled) {
      send(
        danmakuDomain.command.MountCommand({
          container: danmakuContainerRef.current!,
          onOpen: () => send(appStatusDomain.command.UpdateOpenCommand(true))
        })
      )
    }
    return () => {
      if (danmakuIsEnabled) send(danmakuDomain.command.UnmountCommand())
    }
  }, [danmakuIsEnabled, send, appStatusDomain.command, danmakuDomain.command])

  const notUserInfo = userInfoLoadFinished && !userInfoSetFinished
  const themeMode =
    userInfo?.themeMode === 'system'
      ? checkDarkMode()
        ? 'dark'
        : 'light'
      : (userInfo?.themeMode ?? (checkDarkMode() ? 'dark' : 'light'))

  return (
    <div id="app" className={cn('contents', themeMode)}>
      <MediaPreviewContext.Provider value={openMediaPreview}>
        <AppLayout>
          <Header />
          <Main
            historySyncIntent={historySyncIntent}
            localSendToken={localSendToken}
            onHistorySyncIntentConsumed={consumeHistorySyncIntent}
          />
          <Footer onLocalTextSent={handleLocalTextSent} />
          {notUserInfo && <Setup />}
          <Toaster
            richColors
            theme={themeMode}
            offset="70px"
            visibleToasts={1}
            toastOptions={{
              classNames: {
                toast: 'dark:bg-slate-950 border dark:border-slate-600'
              }
            }}
            position="top-center"
          />
        </AppLayout>
        <DanmakuContainer ref={danmakuContainerRef} />
        <MediaPreview ref={mediaPreviewRef} shellOpen={appOpenStatus} />
      </MediaPreviewContext.Provider>
    </div>
  )
}

export default App
