const compress = async (
  imageBitmap: ImageBitmap,
  size: number,
  low: number,
  high: number,
  bestBlob: Blob
): Promise<Blob> => {
  // Calculate the middle value of quality
  const mid = (low + high) / 2

  // Calculate the width and height after scaling
  const width = imageBitmap.width * mid
  const height = imageBitmap.height * mid

  const offscreenCanvas = new OffscreenCanvas(width, height)
  const offscreenContext = offscreenCanvas.getContext('2d')!

  offscreenContext.drawImage(imageBitmap, 0, 0, width, height)

  const outputBlob = await offscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: mid })

  // Calculate the current size based on the current quality
  const currentSize = outputBlob.size

  // If the current size is close to the target size, update the bestResult
  if (Math.abs(currentSize - size) < Math.abs(bestBlob.size - size)) {
    bestBlob = outputBlob
  }

  // If the current size is close to the target size or the range of low and high is too small, return the result
  if (Math.abs(currentSize - size) < 100 || high - low < 0.01) {
    return bestBlob
  }

  // Adjust the range for recursion based on the current quality and size
  if (currentSize > size) {
    return await compress(imageBitmap, size, low, mid, bestBlob)
  } else {
    return await compress(imageBitmap, size, mid, high, bestBlob)
  }
}

const compressImage = async (inputBlob: Blob, targetSize: number) => {
  // If the original size already meets the target size, return the original Blob
  if (inputBlob.size <= targetSize) {
    return inputBlob
  }

  // Initialize the range of quality
  const low = 0
  const high = 1

  // Initialize bestBlob with the original input Blob
  const bestBlob = inputBlob

  const imageBitmap = await createImageBitmap(inputBlob)

  // Call the recursive function
  return await compress(imageBitmap, targetSize, low, high, bestBlob)
}

export default compressImage
