import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}

export const createElement = <T extends Element>(template: string) => {
  return new Range().createContextualFragment(template).firstElementChild as unknown as T
}
