import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { JSX } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar, { type SidebarNavItem } from '../components/sidebar/Sidebar'
import { DashboardIcon, JobsIcon, UsersIcon } from '../components/icons'
import type { SessionUser } from '../api/session'
import styles from './AdminLayout.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

const navItems: SidebarNavItem[] = [
  {
    label: 'Dashboard',
    icon: DashboardIcon,
    to: '/app/dashboard',
    end: true,
  },
  {
    label: 'Users',
    icon: UsersIcon,
    to: '/app/users',
  },
  {
    label: 'Jobs',
    icon: JobsIcon,
    to: '/app/jobs',
  },
]

const AdminLayout = (): JSX.Element => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const logoutMutation = useMutation<void>({
    mutationFn: async () => {
      const response = await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(`Logout request failed (${response.status})`)
      }
    },
  })

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync()
    } catch (error) {
      console.warn('Logout request failed', error)
    } finally {
      navigate('/', { replace: true })
    }
  }

  const isLoggingOut = logoutMutation.isPending
  const session = queryClient.getQueryData<SessionUser>(['session'])

  return (
    <div className={styles.container}>
      <Sidebar
        items={navItems}
        title="Walk:AI"
        userEmail={session?.email}
        onLogout={handleLogout}
        logoutLabel={isLoggingOut ? 'Logging out...' : 'Log out'}
        logoutDisabled={isLoggingOut}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AdminLayout
