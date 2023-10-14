import { type FC, type ChangeEvent, type KeyboardEvent } from 'react'

import { Textarea } from '@/components/ui/Textarea'
import { Markdown } from '@/components/ui/Markdown'
import { cn } from '@/utils'

export interface MessageInputProps {
  value?: string
  className?: string
  maxLength?: number
  preview?: boolean
  onInput?: (value: string) => void
  onEnter?: (value: string) => void
}

const MessageInput: FC<MessageInputProps> = ({ value = '', className, maxLength = 500, onInput, onEnter, preview }) => {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault()
      onEnter?.(value)
    }
  }
  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onInput?.(e.target.value)
  }

  return (
    <div className={cn('relative', className)}>
      {preview ? (
        <Markdown className="max-h-32 rounded-lg border border-input bg-gray-50 2xl:max-h-40">{value}</Markdown>
      ) : (
        // Hack: Auto-Growing Textarea
        <div
          data-value={value}
          className="grid after:pointer-events-none after:invisible after:col-start-1 after:col-end-2 after:row-start-1 after:row-end-2 after:box-border after:max-h-28 after:w-full after:overflow-x-hidden after:whitespace-pre-wrap after:break-words after:rounded-lg after:border after:px-3 after:py-2 after:pb-5 after:text-sm after:content-[attr(data-value)] after:2xl:max-h-40"
        >
          <Textarea
            onKeyDown={handleKeyDown}
            maxLength={maxLength}
            className="col-start-1 col-end-2 row-start-1 row-end-2 box-border max-h-28 resize-none overflow-x-hidden whitespace-pre-wrap break-words rounded-lg bg-gray-50 pb-5 text-sm 2xl:max-h-40"
            rows={2}
            value={value}
            placeholder="Type your message here."
            onInput={handleInput}
          />
        </div>
      )}
      <div className="absolute bottom-1 right-3 rounded-lg text-xs text-slate-400">
        {value?.length ?? 0}/{maxLength}
      </div>
    </div>
  )
}

MessageInput.displayName = 'MessageInput'

export default MessageInput
