const blobToBase64 = (blob: Blob) => {
  // SAFETY: FileReader.readAsDataURL always produces a string result, and onload only fires on success.
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    // SAFETY: FileReader.readAsDataURL always produces a string result, and onload only fires on success.
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsDataURL(blob)
  })
}

export default blobToBase64
