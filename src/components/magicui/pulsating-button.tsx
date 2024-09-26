'use client'

import React from 'react'

import { cn } from '@/utils/index'

interface PulsatingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pulseColor?: string
  duration?: string
}

export default function PulsatingButton({
  className,
  children,
  pulseColor = '#0f172a50',
  duration = '1.5s',
  ...props
}: PulsatingButtonProps) {
  return (
    <button
      className={cn(
        'relative rounded-full text-center cursor-pointer text-sm font-medium flex justify-center items-center text-primary-foreground bg-primary py-2 h-10 px-8 hover:bg-primary/90',
        className
      )}
      style={
        {
          '--pulse-color': pulseColor,
          '--duration': duration
        } as React.CSSProperties
      }
      {...props}
    >
      <div className="relative z-10">{children}</div>
      <div className="absolute left-1/2 top-1/2 size-full -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-inherit" />
    </button>
  )
}
