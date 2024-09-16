export const clamp = (number: number, min: number, max: number) => Math.min(Math.max(number, min), max)
export const isInRange = (number: number, min: number, max: number) => number >= min && number <= max
