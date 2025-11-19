import type { JSX } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './layouts/AdminLayout'
import Invitations from './pages/Invitations'
import Jobs from './pages/Jobs'
import Login from './pages/Login'
import Users from './pages/Users'
import ProtectedRoute from './components/protected route/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import JobDetail from './pages/JobDetail'
import PodDetail from './pages/PodDetail'
import JobRunDetail from './pages/JobRunDetail'
import VolumeDetail from './pages/VolumeDetail'
import Profile from './pages/Profile'
import Secrets from './pages/Secrets'
import InputVolumes from './pages/InputVolumes'

const App = (): JSX.Element => {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/invitations" element={<Invitations />} />

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="secrets" element={<Secrets />} />
        <Route path="input-volumes" element={<InputVolumes />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/:jobId" element={<JobDetail />} />
        <Route path="jobs/:jobId/runs/:runId" element={<JobRunDetail />} />
        <Route path="jobs/:jobId/runs/:runId/volumes/:volumeId" element={<VolumeDetail />} />
        <Route path="input-volumes/:volumeId" element={<VolumeDetail />} />
        <Route path="pods/:podName" element={<PodDetail />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
