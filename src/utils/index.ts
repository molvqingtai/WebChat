import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}

export const createElement = <T extends Element>(template: string) => {
  return new Range().createContextualFragment(template).firstElementChild as unknown as T
}

export const chunk = <T = any>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_v, i) => array.slice(i * size, i * size + size))
