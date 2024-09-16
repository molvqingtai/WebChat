// const compress = async (
//   imageBitmap: ImageBitmap,
//   targetSize: number,
//   low: number,
//   high: number,
//   bestBlob: Blob
// ): Promise<Blob> => {
//   // Calculate the middle value of quality
//   const mid = (low + high) / 2

//   // Calculate the width and height after scaling
//   const width = imageBitmap.width * mid
//   const height = imageBitmap.height * mid

//   const offscreenCanvas = new OffscreenCanvas(width, height)
//   const offscreenContext = offscreenCanvas.getContext('2d')!

//   offscreenContext.drawImage(imageBitmap, 0, 0, width, height)

//   const outputBlob = await offscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: mid })

//   // Calculate the current size based on the current quality
//   const currentSize = outputBlob.size

//   // If the current size is close to the target size, update the bestBlob
//   if (currentSize <= targetSize && Math.abs(currentSize - targetSize) < Math.abs(bestBlob.size - targetSize)) {
//     bestBlob = outputBlob
//   }

//   // If the current size is between -1024 ~ 0, return the result
//   if ((currentSize - targetSize <= 0 && currentSize - targetSize >= -1024) || high - low < 0.01) {
//     return bestBlob
//   }

//   // Adjust the range for recursion based on the current quality and size
//   if (currentSize > targetSize) {
//     return await compress(imageBitmap, targetSize, low, mid, bestBlob)
//   } else {
//     return await compress(imageBitmap, targetSize, mid, high, bestBlob)
//   }
// }

// const compressImage = async (inputBlob: Blob, targetSize: number) => {
//   // If the original size already meets the target size, return the original Blob
//   if (inputBlob.size <= targetSize) {
//     return inputBlob
//   }

//   // Initialize the range of quality
//   const low = 0
//   const high = 1

//   // Initialize bestBlob with the original input Blob
//   const bestBlob = inputBlob

//   const imageBitmap = await createImageBitmap(inputBlob)

//   // Call the recursive function
//   return await compress(imageBitmap, targetSize, low, high, bestBlob)
// }

// export default compressImage

const compress = async (
  imageBitmap: ImageBitmap,
  targetSize: number,
  errorMargin: number,
  low: number,
  high: number,
  bestBlob: Blob
): Promise<Blob> => {
  const mid = (low + high) / 2
  const width = imageBitmap.width * mid
  const height = imageBitmap.height * mid

  const offscreenCanvas = new OffscreenCanvas(width, height)
  const offscreenContext = offscreenCanvas.getContext('2d')!
  offscreenContext.drawImage(imageBitmap, 0, 0, width, height)

  const outputBlob = await offscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: mid })
  const currentSize = outputBlob.size

  if (Math.abs(currentSize - targetSize) < Math.abs(bestBlob.size - targetSize)) {
    bestBlob = outputBlob
  }

  if (Math.abs(currentSize - targetSize) <= errorMargin || high - low < 0.01) {
    return bestBlob
  }

  if (currentSize > targetSize) {
    return await compress(imageBitmap, targetSize, errorMargin, low, mid, bestBlob)
  } else {
    return await compress(imageBitmap, targetSize, errorMargin, mid, high, bestBlob)
  }
}

const compressImage = async (inputBlob: Blob, targetSize: number, errorMargin: number = 1024) => {
  if (inputBlob.size <= targetSize) {
    return inputBlob
  }

  const low = 0.1
  const high = 0.9
  const bestBlob = inputBlob
  const imageBitmap = await createImageBitmap(inputBlob)

  return await compress(imageBitmap, targetSize, errorMargin, low, high, bestBlob)
}

export default compressImage
