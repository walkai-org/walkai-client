import type { JSX, ReactNode } from 'react'
import logo from '../assets/walkai_logo_final.png'
import styles from './AuthLayout.module.css'

type AuthLayoutProps = {
  children: ReactNode
}

const AuthLayout = ({ children }: AuthLayoutProps): JSX.Element => {
  return (
    <div className={styles.container}>
      <section className={styles.card}>
        <div className={styles.branding}>
          <img src={logo} alt="Walk:AI logo" className={styles.logo} />
        </div>
        <div className={styles.content}>{children}</div>
      </section>
    </div>
  )
}

export default AuthLayout
