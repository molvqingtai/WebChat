const stringToHex = (input: string): string => {
  if (input.length === 0) return ''
  return [...input].map((char) => char.codePointAt(0)!.toString(16).padStart(4, '0')).join('')
}

export default stringToHex
