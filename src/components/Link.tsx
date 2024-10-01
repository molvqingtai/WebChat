import { cn } from '@/utils'
import { forwardRef, ReactNode } from 'react'

export interface LinkProps {
  href: string
  className?: string
  children: ReactNode
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(({ href, className, children }, ref) => {
  return (
    <a href={href} target={href} rel="noopener noreferrer" className={cn('hover:underline', className)} ref={ref}>
      {children}
    </a>
  )
})

Link.displayName = 'Link'
export default Link
