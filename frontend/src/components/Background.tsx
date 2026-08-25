import { useState } from 'react'
import { useWallpaper } from '../api/wallpaper'

/**
 * 单张壁纸层:opacity 400ms 淡入。backgroundColor div 挂不上 onLoad,故改 <img>。
 * key=src 换源(每日壁纸轮换)时重挂载、loaded 归零,新图重新走淡入,不闪旧图。
 */
function WallpaperLayer({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      onLoad={() => setLoaded(true)}
      className="absolute inset-0 w-full h-full object-cover"
      style={{
        transform: 'scale(1.05)',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 400ms ease',
      }}
    />
  )
}

/**
 * 全屏壁纸背景层（fixed -z-10）：
 * - 必应每日壁纸，放大 1.05 避免边缘露白（不再做自身模糊，保留原图清晰度，
 *   由上层 page-panel 做轻度雾化）
 * - 上覆暗色遮罩压住亮度、保证前景文字可读：亮色 black/35（Apple clear 档官方唯一
 *   公开数值——底层内容明亮时叠 35% 暗色调光层,L2 近透明底上的白字依赖它），暗色 black/45
 * - 加载/失败时回退到纯渐变，不阻塞页面;渐变层恒渲染垫底,壁纸淡入期间不黑屏
 */
export default function Background() {
  const { data } = useWallpaper()
  const bg = data?.url
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-zinc-950">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" />
      {bg && <WallpaperLayer key={bg} src={bg} />}
      {/* 可读性遮罩 */}
      <div className="absolute inset-0 bg-black/35 dark:bg-black/45" />
    </div>
  )
}
