import { useState } from 'react'
import type { ChangeEvent, FormEvent, JSX } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import AuthLayout from '../layouts/AuthLayout'
import styles from './ForgotPassword.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type ForgotPasswordFormState = {
  email: string
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const ForgotPassword = (): JSX.Element => {
  const [formState, setFormState] = useState<ForgotPasswordFormState>({ email: '' })
  const [status, setStatus] = useState<'idle' | 'submitted'>('idle')
  const [error, setError] = useState<string | null>(null)

  const forgotPasswordMutation = useMutation<void, Error, string>({
    mutationFn: async (email) => {
      const res = await fetch(`${API_BASE}/password/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        throw new Error('Unable to send reset email')
      }
    },
  })

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    const field = name as keyof ForgotPasswordFormState
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (forgotPasswordMutation.isPending) return

    try {
      await forgotPasswordMutation.mutateAsync(formState.email)
      setStatus('submitted')
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to send reset email'))
    }
  }

  if (status === 'submitted') {
    return (
      <AuthLayout>
        <div className={styles.header}>
          <h2>Check your email</h2>
          <p className={styles.info}>
            If the email address is valid, instructions will be sent to reset your password.
          </p>
        </div>
        <footer className={styles.footer}>
          <Link to="/">Back to sign in</Link>
        </footer>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className={styles.header}>
        <h2>Forgot password</h2>
        <p>Enter your email and we&apos;ll send a reset link.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor="email">
          <span>Email</span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={formState.email}
            onChange={handleChange}
            required
          />
        </label>

        <button type="submit" disabled={forgotPasswordMutation.isPending}>
          {forgotPasswordMutation.isPending ? 'Sending...' : 'Send reset link'}
        </button>
      </form>

      {error ? <p className={styles.error}>{error}</p> : null}

      <footer className={styles.footer}>
        <Link to="/">Back to sign in</Link>
      </footer>
    </AuthLayout>
  )
}

export default ForgotPassword
