import type { ComponentType, JSX, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import styles from './Sidebar.module.css'

type SidebarIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number
  title?: string
}

export type SidebarNavItem = {
  label: string
  icon: ComponentType<SidebarIconProps>
  to: string
  end?: boolean
}

type SidebarProps = {
  items: SidebarNavItem[]
  title?: string
  profileItem?: SidebarNavItem
  onLogout?: () => void
  logoutLabel?: string
  logoutDisabled?: boolean
}

const Sidebar = ({
  items,
  title,
  profileItem,
  onLogout,
  logoutLabel = 'Log out',
  logoutDisabled = false,
}: SidebarProps): JSX.Element => {
  const ProfileIconComponent = profileItem?.icon

  return (
    <aside className={styles.sidebar}>
      {title ? (
        <div className={styles.identity}>
          <div className={styles.brand}>{title}</div>
        </div>
      ) : null}
      <nav className={styles.nav} aria-label="Admin navigation">
        {items.map(({ label, icon: IconComponent, to, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [styles.navItem, isActive ? styles.active : ''].join(' ').trim()
            }
          >
            <IconComponent className={styles.icon} aria-hidden title="" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className={styles.footer}>
        {profileItem && ProfileIconComponent ? (
          <NavLink
            to={profileItem.to}
            end={profileItem.end}
            aria-label={profileItem.label}
            className={({ isActive }) =>
              [styles.profileLink, isActive ? styles.profileActive : ''].join(' ').trim()
            }
          >
            <ProfileIconComponent className={styles.profileIcon} aria-hidden title="" />
          </NavLink>
        ) : null}
        {onLogout ? (
          <button
            type="button"
            className={styles.logoutButton}
            onClick={onLogout}
            disabled={logoutDisabled}
          >
            {logoutLabel}
          </button>
        ) : null}
      </div>
    </aside>
  )
}

export default Sidebar
