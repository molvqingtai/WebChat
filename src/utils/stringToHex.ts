const stringToHex = (string: string) => {
  return [...string].map((char) => char.charCodeAt(0).toString(16)).join('')
}

export default stringToHex
