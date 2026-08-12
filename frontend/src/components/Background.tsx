import { useWallpaper } from '../api/wallpaper'

/**
 * 全屏壁纸背景层（fixed -z-10）：
 * - 必应每日壁纸，放大 1.05 避免边缘露白（不再做自身模糊，保留原图清晰度，
 *   由上层 page-panel 做轻度雾化）
 * - 上覆暗色遮罩压住亮度、保证前景文字可读：亮色 black/25，暗色 black/45
 * - 加载/失败时回退到纯渐变，不阻塞页面
 */
export default function Background() {
  const { data } = useWallpaper()
  const bg = data?.url
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-zinc-950">
      {bg ? (
        <div
          className="absolute inset-0 bg-center bg-cover"
          style={{
            backgroundImage: `url(${bg})`,
            transform: 'scale(1.05)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" />
      )}
      {/* 可读性遮罩 */}
      <div className="absolute inset-0 bg-black/25 dark:bg-black/45" />
    </div>
  )
}
