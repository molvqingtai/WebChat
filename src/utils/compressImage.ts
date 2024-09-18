const compress = async (
  imageBitmap: ImageBitmap,
  targetSize: number,
  low: number,
  high: number,
  bestBlob: Blob,
  threshold: number
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

  // If the current size is close to the target size, update the bestBlob
  if (currentSize <= targetSize && Math.abs(currentSize - targetSize) < Math.abs(bestBlob.size - targetSize)) {
    bestBlob = outputBlob
  }

  // If the current size is between -1024 ~ 0, return the result
  if ((currentSize - targetSize <= 0 && currentSize - targetSize >= -threshold) || high - low < 0.01) {
    return bestBlob
  }

  // Adjust the range for recursion based on the current quality and size
  if (currentSize > targetSize) {
    return await compress(imageBitmap, targetSize, low, mid, bestBlob, threshold)
  } else {
    return await compress(imageBitmap, targetSize, mid, high, bestBlob, threshold)
  }
}

const compressImage = async (inputBlob: Blob, targetSize: number, threshold: number = 1024) => {
  // If the original size already meets the target size, return the original Blob
  if (inputBlob.size <= targetSize) {
    return inputBlob
  }

  // Initialize the range of quality
  const low = 0
  const high = 1

  const imageBitmap = await createImageBitmap(inputBlob)

  // Call the recursive function
  return await compress(imageBitmap, targetSize, low, high, inputBlob, threshold)
}

export default compressImage
