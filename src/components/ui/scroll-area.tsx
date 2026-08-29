import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/utils'

function ScrollArea({
  className,
  children,
  scrollLock = true,
  viewport,
  ref,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  scrollLock?: boolean
  viewport?: (content: {
    children: React.ReactNode
    Viewport: typeof ScrollAreaPrimitive.Viewport
    viewportClassName: string
    viewportRef: React.Ref<HTMLDivElement> | undefined
  }) => React.ReactElement
}) {
  const viewportClassName = cn(
    'focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1',
    scrollLock ? 'overscroll-none' : 'overscroll-auto'
  )
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative grid grid-rows-[1fr] overflow-hidden', className)}
      {...props}
    >
      {/* The optional `viewport` render prop is the composition seam for behavior engines:
          the caller renders its engine viewport with the supplied Radix Viewport as the
          engine's `render` target, so one DOM element owns overflow, Radix scrollbar
          measurement, and the engine's own ref/handlers. Existing callers are unaffected
          because the default keeps this component's own viewport element. */}
      {viewport ? (
        viewport({ children, Viewport: ScrollAreaPrimitive.Viewport, viewportClassName, viewportRef: ref })
      ) : (
        <ScrollAreaPrimitive.Viewport ref={ref} data-slot="scroll-area-viewport" className={viewportClassName}>
          {children}
        </ScrollAreaPrimitive.Viewport>
      )}
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
