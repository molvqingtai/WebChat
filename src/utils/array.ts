export const chunk = <T = any>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_value, index) =>
    array.slice(index * size, index * size + size)
  )
