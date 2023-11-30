import { type ChangeEvent } from 'react'
import { ImagePlusIcon } from 'lucide-react'
import React from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar'
import { Label } from '@/components/ui/Label'
import { cn, compressImage } from '@/utils'

export interface AvatarSelectProps {
  value?: string
  className?: string
  disabled?: boolean
  onload?: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null
  onerror?: ((this: FileReader, ev: ProgressEvent) => any) | null
  onChange?: (src: string) => void
}

const AvatarSelect = React.forwardRef<HTMLInputElement, AvatarSelectProps>(
  ({ onChange, value, onerror, onload, className, disabled }, ref) => {
    const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]

      if (file) {
        // Compress to 10kb
        const blob = await compressImage(file, 10 * 1024)
        const reader = new FileReader()
        reader.onload = (e) => {
          onload?.call(reader, e)
          const src = e.target?.result as string
          onChange?.(src)
          console.log(file.size, blob.size)
        }
        reader.onerror = (e) => onerror?.call(reader, e)
        reader.readAsDataURL(blob)
      }
    }
    return (
      <Label className="contents">
        <Avatar
          tabIndex={disabled ? -1 : 1}
          className={cn(
            'group h-20 w-20 cursor-pointer border-4 border-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            {
              'cursor-not-allowed': disabled,
              'opacity-50': disabled
            },
            className
          )}
        >
          <AvatarImage src={value} alt="avatar" />
          <AvatarFallback>
            <ImagePlusIcon size={30} className="text-slate-400 group-hover:text-slate-500" />
          </AvatarFallback>
        </Avatar>
        <input ref={ref} hidden disabled={disabled} type="file" accept="image/*" onChange={handleChange} />
      </Label>
    )
  }
)
AvatarSelect.displayName = 'AvatarSelect'

export default AvatarSelect
