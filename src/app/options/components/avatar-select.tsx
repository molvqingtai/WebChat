import type { Ref } from 'react'
import React from 'react'
import { type ChangeEvent } from 'react'
import { ImagePlusIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Label } from '@/components/ui/label'
import { blobToBase64, cn } from '@/utils'
import imgcap from 'imgcap'

export interface AvatarSelectProps {
  value?: string
  className?: string
  disabled?: boolean
  compressSize?: number
  onSuccess?: (blob: string) => void
  onWarning?: (error: Error) => void
  onError?: (error: Error) => void
  onChange?: (src: string) => void
}

const AvatarSelect = ({
  ref,
  onChange,
  value,
  onError,
  onWarning,
  onSuccess,
  className,
  compressSize = 8 * 1024,
  disabled
}: AvatarSelectProps & { ref?: Ref<HTMLInputElement | null> }) => {
  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!/image\/(png|jpeg|webp)/.test(file.type)) {
        onWarning?.(new Error('Only PNG, JPEG and WebP image are supported.'))
        return
      }

      try {
        /**
         * In chrome storage.sync, each key-value pair supports a maximum storage of 8kb
         * and all key-value pairs support a maximum storage of 100kb.
         */
        const blob = await imgcap(file, { targetSize: compressSize, outputType: 'image/webp' })
        const base64 = await blobToBase64(blob)
        onSuccess?.(base64)
        onChange?.(base64)
      } catch (error) {
        onError?.(error as Error)
      }
    }
  }
  return (
    <Label className="contents">
      <Avatar
        tabIndex={disabled ? -1 : 1}
        className={cn(
          'group h-24 w-24 cursor-pointer border-4 border-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          {
            'cursor-not-allowed': disabled,
            'opacity-50': disabled
          },
          className
        )}
      >
        <AvatarImage src={value} className="size-full" alt="avatar" />
        <AvatarFallback>
          <ImagePlusIcon size={30} className="text-slate-400 group-hover:text-slate-500" />
        </AvatarFallback>
      </Avatar>
      <input
        ref={ref}
        hidden
        disabled={disabled}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleChange}
      />
    </Label>
  )
}
AvatarSelect.displayName = 'AvatarSelect'

export default AvatarSelect
