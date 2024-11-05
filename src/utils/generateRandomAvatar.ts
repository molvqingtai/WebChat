import generateUglyAvatar from '@/lib/uglyAvatar'
import compressImage, { ImageType } from './compressImage'

const generateRandomAvatar = async (targetSize: number, outputType: ImageType = 'image/webp') => {
  const svgBlob = generateUglyAvatar()

  // compressImage can't directly compress svg, need to convert to jpeg first
  const imageBlob = await new Promise<Blob>((resolve, reject) => {
    const image = new Image()
    image.onload = async () => {
      const canvas = new OffscreenCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(image, 0, 0)
      const blob = await canvas.convertToBlob({ type: outputType })
      resolve(blob)
    }
    image.onerror = () => reject(new Error('Failed to load SVG'))
    image.src = URL.createObjectURL(svgBlob)
  })
  const miniAvatarBlob = await compressImage({ input: imageBlob, targetSize, outputType })
  const miniAvatarBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to convert Blob to Base64'))
    reader.readAsDataURL(miniAvatarBlob)
  })
  return miniAvatarBase64
}

export default generateRandomAvatar
