import { useState, useEffect } from 'react'
import type { ChangeEvent, FormEvent, JSX } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import AuthLayout from '../layouts/AuthLayout'
import styles from './Invitations.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type InvitationVerificationResponse = {
  email: string
}

type InvitationErrorCode = 'expired' | 'error' | 'conflict'

type InvitationError = Error & { code: InvitationErrorCode }

const createInvitationError = (message: string, code: InvitationErrorCode): InvitationError =>
  Object.assign(new Error(message), { code })

type InvitationFormState = {
  password: string
  confirmPassword: string
}

type InvitationStatus = 'no-token' | 'expired' | 'loading' | 'error' | 'ok'

type AcceptInvitationVariables = {
  token: string
  password: string
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const Invitations = (): JSX.Element => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [err, setErr] = useState<string | null>(null)
  const [formState, setFormState] = useState<InvitationFormState>({ password: '', confirmPassword: '' })
  const [forceExpired, setForceExpired] = useState(false)

  const invitationToken = searchParams.get('token')

  const verifyInvitationQuery = useQuery<InvitationVerificationResponse, InvitationError>({
    queryKey: ['invitation-verify', invitationToken],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/invitations/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitationToken })
      })

      if (res.status === 400) {
        throw createInvitationError('Invalid or expired invitation.', 'expired')
      }

      if (!res.ok) {
        throw createInvitationError('Invitation verification failed.', 'error')
      }

      const data = (await res.json()) as InvitationVerificationResponse
      return data
    },
    enabled: Boolean(invitationToken),
    retry: false,
  })

  useEffect(() => {
    if (verifyInvitationQuery.isSuccess) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [verifyInvitationQuery.isSuccess])

  const acceptInvitationMutation = useMutation<void, InvitationError, AcceptInvitationVariables>({
    mutationFn: async ({ token, password }) => {
      const res = await fetch(`${API_BASE}/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      })

      if (res.status === 201) return

      if (res.status === 409) throw createInvitationError('Account already exists for this invitation.', 'conflict')
      if (res.status === 400) throw createInvitationError('Invalid or expired invitation.', 'expired')

      let message = 'Failed to accept invitation.'
      try {
        const data = await res.json()
        if (data?.detail) message = Array.isArray(data.detail) ? data.detail[0]?.msg || message : data.detail
      } catch {}

      throw createInvitationError(message, 'error')
    },
  })

  const githubSignupMutation = useMutation<string, Error, string>({
    mutationFn: async (token) => {
      const url = `${API_BASE}/oauth/github/start?invitation_token=${encodeURIComponent(token)}&flow=register`
      const res = await fetch(url, { method: 'GET' })
      if (!res.ok) throw new Error(`start failed: ${res.status}`)
      const { authorize_url: authorizeUrl } = await res.json()
      if (!authorizeUrl) throw new Error('GitHub start failed')
      return authorizeUrl
    },
  })

  const submitting = acceptInvitationMutation.isPending
  const loadingGitHub = githubSignupMutation.isPending
  const email = verifyInvitationQuery.data?.email ?? ''

  const invitationStatus: InvitationStatus = (() => {
    if (!invitationToken) return 'no-token'
    if (forceExpired) return 'expired'
    if (verifyInvitationQuery.isPending) return 'loading'
    if (verifyInvitationQuery.isError) {
      return verifyInvitationQuery.error?.code === 'expired' ? 'expired' : 'error'
    }
    return 'ok'
  })()

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    const field = name as keyof InvitationFormState
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErr(null)

    if (!invitationToken) {
      setErr('Missing invitation token in URL')
      setForceExpired(true)
      return
    }

    if (formState.password.trim().length < 8) {
      alert('Password must be at least 8 characters long.')
      return
    }

    if (formState.password !== formState.confirmPassword) {
      alert('Passwords do not match.')
      return
    }

    try {
      await acceptInvitationMutation.mutateAsync({ token: invitationToken, password: formState.password })
      alert('Account created')
      navigate('/')
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const invitationError = error as InvitationError
        if (invitationError.code === 'conflict') {
          setErr(invitationError.message)
        } else if (invitationError.code === 'expired') {
          setErr(invitationError.message)
          setForceExpired(true)
        } else {
          setErr(invitationError.message || 'Network error')
        }
      } else {
        setErr(getErrorMessage(error, 'Network error'))
      }
    }
  }

  const handleGithubSignup = async () => {
    setErr(null)
    if (!invitationToken) {
      setErr('Missing invitation token in URL')
      return
    }
    try {
      const authorizeUrl = await githubSignupMutation.mutateAsync(invitationToken)
      window.location.href = authorizeUrl
    } catch (error) {
      setErr(getErrorMessage(error, 'GitHub start failed'))
    }
  }

  if (invitationStatus === 'loading') {
    return <AuthLayout><p className={styles.info}>Checking your invitation…</p></AuthLayout>
  }

  if (invitationStatus === 'expired' || invitationStatus === 'no-token') {
    return (
      <AuthLayout>
        <div className={styles.header}>
          <h2>Invitation not available</h2>
          <p className={styles.error}>
            {invitationStatus === 'expired' ? 'Your invitation has expired or was already used' : 'Missing invitation token.'}
          </p>
          <button onClick={() => navigate('/')}>Go to login</button>
        </div>
      </AuthLayout>
    )
  }

  if (invitationStatus === 'error') {
    return (
      <AuthLayout>
        <div className={styles.header}>
          <h2>Something went wrong</h2>
          <p className={styles.error}>Please try again later.</p>
          <button onClick={() => navigate('/')}>Go to login</button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className={styles.header}>
        <h2>Accept your invitation</h2>
        <p>Hi <span className={styles.email}>{email}</span> you have been invited to walk:ai</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor="password">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Create a password"
            autoComplete="new-password"
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
            placeholder="Repeat your password"
            autoComplete="new-password"
            value={formState.confirmPassword}
            onChange={handleChange}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>

      {err ? <p className={styles.error}>{err}</p> : null}

      <button type="button" className={styles.githubButton} onClick={handleGithubSignup} disabled={loadingGitHub}>
        {loadingGitHub ? 'Contacting GitHub…' : (
          <>
            <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false" className={styles.githubIcon}>
              <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8a8.002 8.002 0 005.47 7.59c.4.075.547-.173.547-.385 0-.19-.007-.693-.01-1.36-2.226.483-2.695-1.073-2.695-1.073-.364-.924-.89-1.17-.89-1.17-.727-.497.055-.487.055-.487.803.057 1.225.825 1.225.825.715 1.225 1.874.871 2.33.666.072-.518.28-.872.508-1.073-1.777-.202-3.644-.888-3.644-3.953 0-.873.312-1.586.823-2.146-.083-.202-.357-1.015.078-2.117 0 0 .672-.215 2.2.82a7.657 7.657 0 012.003-.27 7.65 7.65 0 012.003.27c1.527-1.035 2.198-.82 2.198-.82.437 1.102.163 1.915.08 2.117.513.56.821 1.273.821 2.146 0 3.073-1.87 3.748-3.653 3.946.288.247.544.735.544 1.48 0 1.068-.01 1.93-.01 2.192 0 .213.145.463.55.384A8.003 8.003 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign up with GitHub
          </>
        )}
      </button>
    </AuthLayout>
  )
}

export default Invitations
