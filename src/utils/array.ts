export const chunk = <T = any>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_v, i) => array.slice(i * size, i * size + size))

export const desert = <T extends object>(target: T[], key: keyof T, value: T) => {
  const index = target.findIndex((item) => item[key] === value[key])
  return index === -1 ? [...target, value] : target.toSpliced(index, 1)
}

export const upsert = <T extends object>(target: T[], key: keyof T, value: T) => {
  const index = target.findIndex((item) => item[key] === value[key])
  return index === -1 ? [...target, value] : target.toSpliced(index, 1, value)
}
