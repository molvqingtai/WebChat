import { forwardRef, type ChangeEvent, CompositionEvent, type KeyboardEvent } from 'react'

import { Textarea } from '@/components/ui/Textarea'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/utils'
import { ScrollArea } from '@/components/ui/ScrollArea'

export interface MessageInputProps {
  value?: string
  className?: string
  maxLength?: number
  preview?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onInput?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onEnter?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart?: (e: CompositionEvent<HTMLTextAreaElement>) => void
  onCompositionEnd?: (e: CompositionEvent<HTMLTextAreaElement>) => void
}

const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
      value = '',
      className,
      maxLength = 500,
      onInput,
      onEnter,
      onCompositionStart,
      onCompositionEnd,
      preview,
      autoFocus,
      disabled
    },
    ref
  ) => {
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
        e.preventDefault()
        onEnter?.(e)
      }
    }

    return (
      <div className={cn('relative', className)}>
        {preview ? (
          <Markdown className="max-h-28 rounded-lg border border-input bg-gray-50 2xl:max-h-40">{value}</Markdown>
        ) : (
          <ScrollArea className="box-border max-h-28 w-full rounded-lg border border-input bg-background ring-offset-background focus-within:ring-1 focus-within:ring-ring 2xl:max-h-40">
            <Textarea
              ref={ref}
              onKeyDown={handleKeyDown}
              autoFocus={autoFocus}
              maxLength={maxLength}
              className="box-border resize-none whitespace-pre-wrap break-words border-none bg-gray-50 pb-5 text-primary [field-sizing:content] focus:ring-0 focus:ring-offset-0"
              rows={2}
              value={value}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              placeholder="Type your message here."
              onInput={onInput}
              disabled={disabled}
            />
          </ScrollArea>
        )}
        <div className="absolute bottom-1 right-3 rounded-lg text-xs text-slate-400">
          {value?.length ?? 0}/{maxLength}
        </div>
      </div>
    )
  }
)

MessageInput.displayName = 'MessageInput'

export default MessageInput
