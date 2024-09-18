export const chunk = <T = any>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_v, i) => array.slice(i * size, i * size + size))

export const desert = <T = any>(target: T[], value: T, key?: keyof T) => {
  const index = target.findIndex((item) => (key ? item[key] === value[key] : value === item))
  return index === -1 ? [...target, value] : target.toSpliced(index, 1)
}

export const upsert = <T = any>(target: T[], value: T, key?: keyof T) => {
  const index = target.findIndex((item) => (key ? item[key] === value[key] : value === item))
  return index === -1 ? [...target, value] : target.toSpliced(index, 1, value)
}
