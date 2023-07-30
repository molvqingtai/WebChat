import { type FC, type ChangeEvent } from 'react'
import { Textarea } from '@/components/ui/Textarea'

import { Markdown } from '@/components/ui/Markdown'
import { cn } from '@/utils'

export interface MessageInputProps {
  value?: string
  focus?: boolean
  preview?: boolean
  className?: string
  maxLength?: number
  onInput?: (message: string) => void
  onChange?: (message: string) => void
  onFocus?: () => void
  onBlur?: () => void
}

const MessageInput: FC<MessageInputProps> = ({
  value,
  focus = true,
  className,
  preview,
  maxLength = 500,
  onInput,
  onChange,
  onFocus,
  onBlur
}) => {
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
            autoFocus={focus}
            maxLength={maxLength}
            className="col-start-1 col-end-2 row-start-1 row-end-2 box-border max-h-28 resize-none overflow-x-hidden break-words rounded-lg bg-gray-50 pb-5 text-sm 2xl:max-h-40"
            rows={2}
            value={value}
            placeholder="Type your message here."
            onInput={(e: ChangeEvent<HTMLTextAreaElement>) => onInput?.(e.target.value)}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
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
