import { type FC, type ChangeEvent } from 'react'
import { Globe2Icon } from 'lucide-react'
import React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar'
import { Label } from '@/components/ui/Label'

export interface AvatarSelectProps {
  value?: string
  className?: string
  onload?: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null
  onerror?: ((this: FileReader, ev: ProgressEvent) => any) | null
  onChange?: (src: string) => void
}

const AvatarSelect = React.forwardRef<HTMLInputElement, AvatarSelectProps>(
  ({ onChange, value, onerror, onload, className }, ref) => {
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (e) => {
          onload?.call(reader, e)
          const src = e.target?.result as string
          onChange?.(src)
        }
        reader.onerror = (e) => onerror?.call(reader, e)
        reader.readAsDataURL(file)
      }
    }
    return (
      <Label className="contents">
        <Avatar className={cn('h-20 w-20 cursor-pointer border-4 border-white', className)}>
          <AvatarImage src={value} alt="avatar" />
          <AvatarFallback>
            <Globe2Icon size="100%" className="text-gray-400" />
          </AvatarFallback>
        </Avatar>
        <input ref={ref} hidden type="file" accept="image/*" onChange={handleChange} />
      </Label>
    )
  }
)
AvatarSelect.displayName = 'AvatarSelect'

export default AvatarSelect
