'use client'

import { cn } from '@/utils'
import { cva, VariantProps } from 'class-variance-authority'

interface AvatarCirclesProps {
  className?: string
  avatarUrls: string[]
  maxLength?: number
  size?: VariantProps<typeof SizeVariants>['size']
}

const SizeVariants = cva('z-10 flex -space-x-4 rtl:space-x-reverse', {
  variants: {
    size: {
      default: 'h-10 min-w-10',
      sm: 'h-8 min-w-8',
      xs: 'h-6 min-w-6',
      lg: 'h-12 min-w-12'
    },
    defaultVariants: {
      size: 'default'
    }
  }
})

const spaceVariants = cva('flex -space-x-4 rtl:space-x-reverse', {
  variants: {
    size: {
      default: '-space-x-4',
      sm: '-space-x-3',
      xs: '-space-x-2',
      lg: '-space-x-5'
    },
    defaultVariants: {
      size: 'default'
    }
  }
})

export const AvatarCircles = ({ className, avatarUrls, size, maxLength = 10 }: AvatarCirclesProps) => {
  return (
    <div className={cn(spaceVariants({ size }), className)}>
      {avatarUrls.slice(0, maxLength).map((url, index) => (
        <img
          key={index}
          className={cn(
            'rounded-full border-2 border-white dark:border-slate-800 aspect-square',
            SizeVariants({ size })
          )}
          src={url}
          alt={`Avatar ${index + 1}`}
        />
      ))}
      {(avatarUrls.length ?? 0) > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full border-2 border-white bg-slate-600 text-center text-xs font-medium text-white dark:border-slate-800 p-1',
            SizeVariants({ size }),
            size === 'xs' && 'text-2xs'
          )}
        >
          +{avatarUrls.length}
        </div>
      )}
    </div>
  )
}
