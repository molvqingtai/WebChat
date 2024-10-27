import { forwardRef, type ChangeEvent, CompositionEvent, type KeyboardEvent } from 'react'

import { cn } from '@/utils'
import { Textarea } from '@/components/ui/Textarea'
import { ScrollArea } from '@/components/ui/ScrollArea'

export interface MessageInputProps {
  value?: string
  className?: string
  maxLength?: number
  preview?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onInput?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart?: (e: CompositionEvent<HTMLTextAreaElement>) => void
  onCompositionEnd?: (e: CompositionEvent<HTMLTextAreaElement>) => void
}

/**
 *  Need @ syntax highlighting? Waiting for textarea to support Highlight API
 *
 * @see https://github.com/w3c/csswg-drafts/issues/4603
 */
const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
      value = '',
      className,
      maxLength = 500,
      onInput,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      autoFocus,
      disabled
    },
    ref
  ) => {
    return (
      <div className={cn('relative', className)}>
        <ScrollArea className="box-border max-h-28 w-full rounded-lg border border-input bg-background ring-offset-background focus-within:ring-1 focus-within:ring-ring 2xl:max-h-40">
          <Textarea
            ref={ref}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            maxLength={maxLength}
            className="box-border resize-none whitespace-pre-wrap break-words border-none bg-gray-50 pb-5 [field-sizing:content] [word-break:break-word] focus:ring-0 focus:ring-offset-0"
            rows={2}
            value={value}
            spellCheck={false}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Type your message here."
            onInput={onInput}
            disabled={disabled}
          />
        </ScrollArea>
        <div className="absolute bottom-1 right-3 rounded-lg text-xs text-slate-400">
          {value?.length ?? 0}/{maxLength}
        </div>
      </div>
    )
  }
)

MessageInput.displayName = 'MessageInput'

export default MessageInput
