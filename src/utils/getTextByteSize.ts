export const getTextByteSize = (text: string) => {
  return new TextEncoder().encode(text).length
}
