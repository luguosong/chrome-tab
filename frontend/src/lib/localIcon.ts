const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** 把本地来源图片归一化为可写入「图标覆盖」的 WebP data URL。 */
export async function prepareLocalIcon(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片')
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MiB')
  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch {
    throw new Error('图片无法解码')
  }
  if (image.width > 4096 || image.height > 4096) {
    image.close()
    throw new Error('图片宽高不能超过 4096px')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法处理图片')
    const scale = Math.min(256 / image.width, 256 / image.height)
    const width = image.width * scale
    const height = image.height * scale
    ctx.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height)
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!output) throw new Error('图片编码失败')
    if (output.size > 128 * 1024) throw new Error('处理后的图片不能超过 128 KiB')
    const bytes = new Uint8Array(await output.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return `data:image/webp;base64,${btoa(binary)}`
  } finally {
    image.close()
  }
}
