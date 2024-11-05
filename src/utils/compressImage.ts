export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface Options {
  input: Blob
  targetSize: number
  toleranceSize?: number
  outputType?: ImageType
}

const compress = async (
  imageBitmap: ImageBitmap,
  targetSize: number,
  low: number,
  high: number,
  toleranceSize: number,
  outputType: ImageType
): Promise<Blob> => {
  // Calculate the middle quality value
  const mid = (low + high) / 2

  // Calculate the width and height after scaling
  const width = Math.round(imageBitmap.width * mid)
  const height = Math.round(imageBitmap.height * mid)

  const offscreenCanvas = new OffscreenCanvas(width, height)
  const offscreenContext = offscreenCanvas.getContext('2d')!

  // Draw the scaled image
  offscreenContext.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height, 0, 0, width, height)

  const outputBlob = await offscreenCanvas.convertToBlob({ type: outputType, quality: mid })

  const currentSize = outputBlob.size

  // Adjust the logic based on the positive or negative value of toleranceSize
  if (toleranceSize < 0) {
    // Negative value: allow results smaller than the target value
    if (currentSize <= targetSize && currentSize >= targetSize + toleranceSize) {
      return outputBlob
    }
  } else {
    // Positive value: allow results larger than the target value
    if (currentSize >= targetSize && currentSize <= targetSize + toleranceSize) {
      return outputBlob
    }
  }

  // Use relative error
  if ((high - low) / high < 0.01) {
    return outputBlob
  }

  if (currentSize > targetSize) {
    return await compress(imageBitmap, targetSize, low, mid, toleranceSize, outputType)
  } else {
    return await compress(imageBitmap, targetSize, mid, high, toleranceSize, outputType)
  }
}

const compressImage = async (options: Options) => {
  const { input, targetSize, toleranceSize = -1024 } = options

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.type)) {
    throw new Error('Only PNG, JPEG and WebP image are supported.')
  }

  if (toleranceSize % 1024 !== 0) {
    throw new Error('Tolerance size must be a multiple of 1024.')
  }

  const outputType = options.outputType || (input.type as ImageType)

  if (input.size <= targetSize && input.type === outputType) {
    return input
  }

  const imageBitmap = await createImageBitmap(input)

  // Initialize quality range
  const low = 0
  const high = 1

  return await compress(imageBitmap, targetSize, low, high, toleranceSize, outputType)
}

export default compressImage
