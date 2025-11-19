import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX, MouseEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import styles from './Users.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const USERS_STALE_TIME_MS = 5_000
const USERS_REFETCH_INTERVAL_MS = 15_000

type UserRecord = {
  id: number
  email: string
  role: string
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const isUserRecord = (value: unknown): value is UserRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'number' && typeof record.email === 'string' && typeof record.role === 'string'
}

const fetchUsers = async (): Promise<UserRecord[]> => {
  const res = await fetch(`${API_BASE}/users`, { credentials: 'include' })

  if (!res.ok) {
    let detail = 'Failed to load users. Please try again.'
    try {
      const data = await res.json()
      if (data?.detail) detail = Array.isArray(data.detail) ? data.detail[0]?.msg || detail : data.detail
    } catch {}
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    throw new Error('Received unreadable users response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isUserRecord)) {
    throw new Error('Received malformed users response. Please contact support.')
  }

  return payload
}

const Users = (): JSX.Element => {
  const {
    data: users = [],
    isLoading: isLoadingUsers,
    isError: isUsersError,
    error: usersError,
  } = useQuery<UserRecord[], Error>({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: USERS_STALE_TIME_MS,
    refetchInterval: USERS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const [isInviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFeedback, setInviteFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const createInvitationMutation = useMutation<void, Error, string>({
    mutationFn: async (email) => {
      const res = await fetch(`${API_BASE}/admin/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })

      if (res.status === 201) return

      let detail = 'Failed to send invitation. Please try again.'
      try {
        const data = await res.json()
        if (data?.detail) detail = Array.isArray(data.detail) ? data.detail[0]?.msg || detail : data.detail
      } catch {}
      throw new Error(detail)
    },
  })

  const isSubmittingInvite = createInvitationMutation.isPending

  useEffect(() => {
    if (!inviteFeedback) return
    const timeoutId = window.setTimeout(() => {
      setInviteFeedback(null)
    }, 4000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [inviteFeedback])

  const handleOpenInvite = () => {
    setInviteOpen(true)
  }

  const handleCloseInvite = () => {
    if (createInvitationMutation.isPending) return
    setInviteOpen(false)
    setInviteEmail('')
  }

  const handleInviteEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInviteEmail(event.target.value)
  }

  const handleModalClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleInviteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!inviteEmail || createInvitationMutation.isPending) return

    const email = inviteEmail.trim().toLowerCase()

    try {
      await createInvitationMutation.mutateAsync(email)
      setInviteFeedback({ type: 'success', message: 'Invitation created successfully.' })
      setInviteOpen(false)
      setInviteEmail('')
    } catch (error) {
      window.alert(getErrorMessage(error, 'Failed to send invitation. Please try again.'))
    }
  }

  const handleFeedbackDismiss = () => {
    setInviteFeedback(null)
  }

  return (
    <section className={styles.users}>
      <header className={styles.header}>
        <div>
          <h1>Users</h1>
          <p>Manage user roles, invitations, and access controls.</p>
        </div>
        <button type="button" className={styles.primaryAction} onClick={handleOpenInvite}>
          Invite User
        </button>
      </header>

      {inviteFeedback ? (
        <div
          className={`${styles.feedback} ${
            inviteFeedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError
          }`}
          role={inviteFeedback.type === 'success' ? 'status' : 'alert'}
          aria-live={inviteFeedback.type === 'success' ? 'polite' : 'assertive'}
        >
          <span>{inviteFeedback.message}</span>
          <button type="button" className={styles.feedbackDismiss} onClick={handleFeedbackDismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <caption className="sr-only">List of users</caption>
          <thead>
            <tr>
              <th scope="col">User ID</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingUsers ? (
              <tr>
                <td colSpan={3} className={styles.tableMessage}>
                  Loading users...
                </td>
              </tr>
            ) : isUsersError ? (
              <tr>
                <td colSpan={3} className={styles.tableMessageError}>
                  {getErrorMessage(usersError, 'Unable to load users. Please try again later.')}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={3} className={styles.tableMessage}>
                  No users found.
                </td>
              </tr>
            ) : (
              users.map(({ id, email, role }) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{email}</td>
                  <td>{role}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isInviteOpen ? (
        <div className={styles.modalOverlay} role="presentation" onClick={handleCloseInvite}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inviteUserTitle"
            onClick={handleModalClick}
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleCloseInvite}
              aria-label="Close invite dialog"
              disabled={isSubmittingInvite}
            >
              &times;
            </button>
            <h2 id="inviteUserTitle" className={styles.modalTitle}>
              Invite user
            </h2>
            <p className={styles.modalDescription}>Send an invitation email to add a new team member.</p>
            <form className={styles.modalForm} onSubmit={handleInviteSubmit}>
              <label htmlFor="inviteEmail">
                Email address
                <input
                  id="inviteEmail"
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={handleInviteEmailChange}
                  autoFocus
                  required
                />
              </label>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCloseInvite}
                  disabled={isSubmittingInvite}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryAction}
                  disabled={!inviteEmail || isSubmittingInvite}
                >
                  {isSubmittingInvite ? 'Sending...' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default Users
