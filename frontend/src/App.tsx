import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ConfigSyncProvider } from './context/ConfigSyncProvider'
import RequireAuth from './components/RequireAuth'
import LoginPage from './routes/LoginPage'
import DashboardPage from './routes/DashboardPage'
// PROTOTYPE ONLY(票 03):Liquid Glass 视觉原型,一次性路由,勿扩展。
// 懒加载:一次性对照资产不进主包(静态 import 实测 +20KB)
const PrototypeLiquidGlassPage = lazy(() => import('./routes/PrototypeLiquidGlassPage'))

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* PROTOTYPE ONLY(票 03):/prototype/liquid-glass?variant=A|B|C,免登录 */}
        <Route
          path="/prototype/liquid-glass"
          element={
            <Suspense fallback={null}>
              <PrototypeLiquidGlassPage />
            </Suspense>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ConfigSyncProvider>
                <DashboardPage />
              </ConfigSyncProvider>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
