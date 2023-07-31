import { type FC, type ChangeEvent, type KeyboardEvent } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Markdown } from '@/components/ui/Markdown'
import { cn } from '@/utils'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import MessageInputDomain from '@/domain/MessageInput'
import { MESSAGE_MAX_LENGTH } from '@/constants'

export interface MessageInputProps {
  className?: string
  maxLength?: number
}

const MessageInput: FC<MessageInputProps> = ({ className }) => {
  const send = useRemeshSend()
  const messageInputDomain = useRemeshDomain(MessageInputDomain())

  const message = useRemeshQuery(messageInputDomain.query.ValueQuery())
  const isPreview = useRemeshQuery(messageInputDomain.query.PreviewQuery())

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    send(messageInputDomain.command.InputCommand(e.target.value))
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault()
      send(messageInputDomain.command.EnterCommand())
    }
  }

  return (
    <div className={cn('relative', className)}>
      {isPreview ? (
        <Markdown className="max-h-32 rounded-lg border border-input bg-gray-50 2xl:max-h-40">{message}</Markdown>
      ) : (
        // Hack: Auto-Growing Textarea
        <div
          data-value={message}
          className="grid after:pointer-events-none after:invisible after:col-start-1 after:col-end-2 after:row-start-1 after:row-end-2 after:box-border after:max-h-28 after:w-full after:overflow-x-hidden after:whitespace-pre-wrap after:break-words after:rounded-lg after:border after:px-3 after:py-2 after:pb-5 after:text-sm after:content-[attr(data-value)] after:2xl:max-h-40"
        >
          <Textarea
            onKeyDown={handleKeyDown}
            maxLength={MESSAGE_MAX_LENGTH}
            className="col-start-1 col-end-2 row-start-1 row-end-2 box-border max-h-28 resize-none overflow-x-hidden break-words rounded-lg bg-gray-50 pb-5 text-sm 2xl:max-h-40"
            rows={2}
            value={message}
            placeholder="Type your message here."
            onInput={handleInput}
          />
        </div>
      )}
      <div className="absolute bottom-1 right-3 rounded-lg text-xs text-slate-400">
        {message?.length ?? 0}/{MESSAGE_MAX_LENGTH}
      </div>
    </div>
  )
}

MessageInput.displayName = 'MessageInput'

export default MessageInput
