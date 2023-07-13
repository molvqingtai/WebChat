import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const createElement = <T extends Element>(template: string) => {
  return new Range().createContextualFragment(template).firstElementChild as unknown as T
}

export default createElement
