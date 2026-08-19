// L2 clear 折射档的 displacement map 生成(ADR-0012)。
// 技法:rebane2001 gist 滤镜链参数 + shuding/liquid-glass 的 canvas rounded-rect
// SDF map 方案(自写,不引库),参数为原型实机验证定稿(研究票 01 §4)。
// 挂载组件 <LensBox> 在 components/LensBox.tsx(需 JSX)。

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** rounded-rect SDF(iq):p 相对中心,q = 内矩形半宽高,r = 圆角。d < 0 在形状内。 */
export function sdRoundRect(px: number, py: number, qx: number, qy: number, r: number) {
  const dx = Math.abs(px) - qx
  const dy = Math.abs(py) - qy
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r
}

/** SDF 距离 → map 像素值:128 = 不位移;边缘 band 带内渐变到 255(位移最强)。 */
export function lensPixel(d: number, band: number): number {
  return Math.round(128 + clamp01(1 - Math.abs(d) / band) * 127)
}

/**
 * 生成 rounded-rect 位移贴图 dataURL。
 * 贴图必须与元素同尺寸同圆角(map 不可跨尺寸缩放,否则 band 像素对应关系失效)。
 */
export function lensMapDataUrl(w: number, h: number, radius: number, band = 12): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const qx = w / 2 - radius
  const qy = h / 2 - radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = sdRoundRect(x + 0.5 - w / 2, y + 0.5 - h / 2, qx, qy, radius)
      const v = lensPixel(d, band)
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}
