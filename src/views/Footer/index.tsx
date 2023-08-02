import { type FC } from 'react'
import { SmileIcon, CornerDownLeftIcon, ImageIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import MessageInput from '@/components/MessageInput'
import MessageInputDomain from '@/domain/MessageInput'
import MessageListDomain from '@/domain/MessageList'

const Footer: FC = () => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())

  const message = useRemeshQuery(messageInputDomain.query.MessageQuery())
  const isPreview = useRemeshQuery(messageInputDomain.query.PreviewQuery())

  const handleInput = (value: string) => {
    send(messageInputDomain.command.InputCommand(value))
  }

  const handleSend = () => {
    send(
      messageListDomain.command.CreateCommand({
        username: '墨绿青苔',
        avatar: 'https://avatars.githubusercontent.com/u/10251037?v=4',
        body: message,
        date: Date.now(),
        likeChecked: false,
        likeCount: 0,
        hateChecked: false,
        hateCount: 0
      })
    )
    send(messageInputDomain.command.ClearCommand())
  }

  return (
    <div className="grid gap-y-2 p-4">
      <MessageInput value={message} preview={isPreview} onEnter={handleSend} onInput={handleInput}></MessageInput>
      <div className="grid grid-cols-[auto_auto_1fr] items-center justify-items-end">
        <Button variant="ghost" size="icon">
          <SmileIcon size={20} />
        </Button>
        <Button variant="ghost" size="icon">
          <ImageIcon size={20} />
        </Button>
        <Button size="sm" onClick={handleSend}>
          <span className="mr-2">Send</span>
          <CornerDownLeftIcon className="text-slate-400" size={12}></CornerDownLeftIcon>
        </Button>
      </div>
    </div>
  )
}

Footer.displayName = 'Footer'

export default Footer
