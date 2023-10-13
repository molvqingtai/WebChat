import { type FC } from 'react'
import { SmileIcon, CornerDownLeftIcon, ImageIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import MessageInput from '@/components/MessageInput'
import MessageInputDomain from '@/domain/MessageInput'
import MessageListDomain from '@/domain/MessageList'
import { MESSAGE_MAX_LENGTH } from '@/constants'
import { type Message } from '@/types'

const Footer: FC = () => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain<Message>())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())
  const text = useRemeshQuery(messageInputDomain.query.MessageQuery())
  const isPreview = useRemeshQuery(messageInputDomain.query.PreviewQuery())

  const handleInput = (value: string) => {
    send(messageInputDomain.command.InputCommand(value))
  }

  const message = {
    username: '墨绿青苔',
    avatar: 'https://avatars.githubusercontent.com/u/10251037?v=4',
    body: text,
    date: Date.now(),
    likeChecked: false,
    likeCount: 0,
    hateChecked: false,
    hateCount: 0
  }

  const handleSend = () => {
    send(messageListDomain.command.CreateItemCommand(message))
    send(messageInputDomain.command.ClearCommand())
  }

  return (
    <div className="grid gap-y-2 px-4 pb-4">
      <MessageInput
        value={text}
        preview={isPreview}
        onEnter={handleSend}
        onInput={handleInput}
        maxLength={MESSAGE_MAX_LENGTH}
      ></MessageInput>
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
