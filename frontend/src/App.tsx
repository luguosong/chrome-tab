import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ConfigSyncProvider } from './context/ConfigSyncProvider'
import RequireAuth from './components/RequireAuth'
import LoginPage from './routes/LoginPage'
import DashboardPage from './routes/DashboardPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
