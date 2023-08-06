// https://night-tailwindcss.vercel.app/docs/breakpoints
export const BREAKPOINTS = {
  sm: 640,
  // => @media (min-width: 640px) { ... }

  md: 768,
  // => @media (min-width: 768px) { ... }

  lg: 1024,
  // => @media (min-width: 1024px) { ... }

  xl: 1280,
  // => @media (min-width: 1280px) { ... }

  '2xl': 1536
  // => @media (min-width: 1536px) { ... }
} as const

export const MESSAGE_MAX_LENGTH = 500 as const

export const STORAGE_NAME = 'WEB_CHAT' as const
