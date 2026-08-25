import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLocalIcon } from './localIcon'

afterEach(() => vi.unstubAllGlobals())

describe('prepareLocalIcon', () => {
  it('仅接受 PNG、JPEG、WebP 来源图片', async () => {
    const file = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' })
    await expect(prepareLocalIcon(file)).rejects.toThrow('仅支持 PNG、JPEG、WebP 图片')
  })

  it('拒绝超过 5 MiB 的来源图片', async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'icon.png', { type: 'image/png' })
    await expect(prepareLocalIcon(file)).rejects.toThrow('图片不能超过 5 MiB')
  })

  it('拒绝宽或高超过 4096px 的来源图片', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4097, height: 1, close() {} }))
    const file = new File(['png'], 'icon.png', { type: 'image/png' })
    await expect(prepareLocalIcon(file)).rejects.toThrow('图片宽高不能超过 4096px')
  })

  it('把图片完整居中放入 256px 透明方形并输出 WebP data URL', async () => {
    const image = { width: 512, height: 256, close: vi.fn() }
    const drawImage = vi.fn()
    const webp = new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])], {
      type: 'image/webp',
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (done: BlobCallback) => done(webp),
    }
    vi.stubGlobal('createImageBitmap', async () => image)
    vi.stubGlobal('document', { createElement: () => canvas })

    const value = await prepareLocalIcon(new File(['png'], 'icon.png', { type: 'image/png' }))

    expect(value).toBe('data:image/webp;base64,UklGRgAAAABXRUJQ')
    expect(canvas).toMatchObject({ width: 256, height: 256 })
    expect(drawImage).toHaveBeenCalledWith(image, 0, 64, 256, 128)
    expect(image.close).toHaveBeenCalledOnce()
  })

  it('拒绝编码后超过 128 KiB 的 WebP', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close() {} }))
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (done: BlobCallback) =>
          done(new Blob([new Uint8Array(128 * 1024 + 1)], { type: 'image/webp' })),
      }),
    })
    const file = new File(['png'], 'icon.png', { type: 'image/png' })
    await expect(prepareLocalIcon(file)).rejects.toThrow('处理后的图片不能超过 128 KiB')
  })
})
