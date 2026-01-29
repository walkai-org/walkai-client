import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import AuthLayout from '../layouts/AuthLayout'
import styles from './ResetPassword.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type ResetPasswordFormState = {
  password: string
  confirmPassword: string
}

type ResetErrorCode = 'invalid-token' | 'error'

type ResetError = Error & { code: ResetErrorCode }

const createResetError = (message: string, code: ResetErrorCode): ResetError =>
  Object.assign(new Error(message), { code })

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const ResetPassword = (): JSX.Element => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [formState, setFormState] = useState<ResetPasswordFormState>({
    password: '',
    confirmPassword: '',
  })
  const [status, setStatus] = useState<'idle' | 'success' | 'invalid-token'>('idle')
  const [error, setError] = useState<string | null>(null)

  const resetPasswordMutation = useMutation<void, ResetError, { token: string; password: string }>({
    mutationFn: async ({ token, password }) => {
      const res = await fetch(`${API_BASE}/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      })

      if (res.status === 400) {
        let message = 'Invalid or expired reset token'
        try {
          const data = await res.json()
          if (data?.detail) message = Array.isArray(data.detail) ? data.detail[0]?.msg || message : data.detail
        } catch {}
        throw createResetError(message, 'invalid-token')
      }

      if (!res.ok) {
        let message = 'Unable to reset password'
        try {
          const data = await res.json()
          if (data?.detail) message = Array.isArray(data.detail) ? data.detail[0]?.msg || message : data.detail
        } catch {}
        throw createResetError(message, 'error')
      }
    },
  })

  useEffect(() => {
    if (status !== 'success') return
    const timeoutId = window.setTimeout(() => {
      navigate('/', { replace: true })
    }, 2500)
    return () => window.clearTimeout(timeoutId)
  }, [status, navigate])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    const field = name as keyof ResetPasswordFormState
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (resetPasswordMutation.isPending) return

    if (!token) {
      setStatus('invalid-token')
      return
    }

    const trimmedPassword = formState.password.trim()
    const trimmedConfirm = formState.confirmPassword.trim()

    if (trimmedPassword.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    if (trimmedPassword !== trimmedConfirm) {
      setError('Passwords do not match.')
      return
    }

    try {
      await resetPasswordMutation.mutateAsync({ token, password: trimmedPassword })
      setStatus('success')
      window.history.replaceState({}, document.title, window.location.pathname)
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const resetError = err as ResetError
        if (resetError.code === 'invalid-token') {
          setStatus('invalid-token')
          setError(resetError.message)
          return
        }
      }
      setError(getErrorMessage(err, 'Unable to reset password.'))
    }
  }

  if (!token || status === 'invalid-token') {
    const invalidMessage = error ?? 'Invalid or expired reset token.'
    return (
      <AuthLayout>
        <div className={styles.header}>
          <h2>Reset link expired</h2>
          <p className={styles.error}>{invalidMessage}</p>
        </div>
        <div className={styles.actions}>
          <Link to="/forgot-password">Request a new link</Link>
          <Link to="/">Back to sign in</Link>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'success') {
    return (
      <AuthLayout>
        <div className={styles.header}>
          <h2>Password updated</h2>
          <p className={styles.info}>Your password has been reset. Redirecting to sign in…</p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className={styles.header}>
        <h2>Reset your password</h2>
        <p>Choose a new password to regain access.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor="password">
          <span>New password</span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter a new password"
            value={formState.password}
            onChange={handleChange}
            required
          />
        </label>

        <label htmlFor="confirmPassword">
          <span>Confirm password</span>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={formState.confirmPassword}
            onChange={handleChange}
            required
          />
        </label>

        <button type="submit" disabled={resetPasswordMutation.isPending}>
          {resetPasswordMutation.isPending ? 'Updating...' : 'Update password'}
        </button>
      </form>

      {error ? <p className={styles.error}>{error}</p> : null}
    </AuthLayout>
  )
}

export default ResetPassword
