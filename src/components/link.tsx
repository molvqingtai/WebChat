import { cn } from '@/utils'
import type { ReactNode, Ref } from 'react'

export interface LinkProps {
  href: string
  className?: string
  children: ReactNode
  underline?: boolean
}

const Link = ({
  ref,
  href,
  className,
  children,
  underline = true
}: LinkProps & { ref?: Ref<HTMLAnchorElement | null> }) => {
  return (
    <a
      href={href}
      target={href}
      rel="noopener noreferrer"
      className={cn(underline && 'hover:underline', className)}
      ref={ref}
    >
      {children}
    </a>
  )
}

Link.displayName = 'Link'
export default Link
