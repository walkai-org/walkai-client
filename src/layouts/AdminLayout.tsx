import { useMutation } from '@tanstack/react-query'
import type { JSX } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar, { type SidebarNavItem } from '../components/sidebar/Sidebar'
import { DashboardIcon, JobsIcon, ProfileIcon, SecretsIcon, UsersIcon, VolumesIcon } from '../components/icons'
import styles from './AdminLayout.module.css'

const API_BASE = '/api'

const navItems: SidebarNavItem[] = [
  {
    label: 'Dashboard',
    icon: DashboardIcon,
    to: '/app/dashboard',
    end: true,
  },
  {
    label: 'Jobs',
    icon: JobsIcon,
    to: '/app/jobs',
  },
  {
    label: 'Input Volumes',
    icon: VolumesIcon,
    to: '/app/input-volumes',
  },
  {
    label: 'Secrets',
    icon: SecretsIcon,
    to: '/app/secrets',
  },
  {
    label: 'Users',
    icon: UsersIcon,
    to: '/app/users',
  },
]

const profileItem: SidebarNavItem = {
  label: 'Profile',
  icon: ProfileIcon,
  to: '/app/profile',
}

const AdminLayout = (): JSX.Element => {
  const navigate = useNavigate()

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
  return (
    <div className={styles.container}>
      <Sidebar
        items={navItems}
        title="Walk:AI"
        profileItem={profileItem}
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
