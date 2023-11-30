const chunk = <T = any>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_v, i) => array.slice(i * size, i * size + size))

export default chunk
