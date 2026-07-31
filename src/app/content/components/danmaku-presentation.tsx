import { useEffect, useRef } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import DanmakuDomain from '@/domain/Danmaku'
import DanmakuContainer from '@/app/content/components/danmaku-container'

const DanmakuPresentation = () => {
  const send = useRemeshSend()
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const enabled = useRemeshQuery(danmakuDomain.query.IsEnabledQuery())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (enabled) send(danmakuDomain.command.MountCommand(containerRef.current!))
    return () => {
      if (enabled) send(danmakuDomain.command.UnmountCommand())
    }
  }, [enabled, send, danmakuDomain.command])

  return <DanmakuContainer ref={containerRef} />
}

export default DanmakuPresentation
