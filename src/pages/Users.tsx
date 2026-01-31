import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX, MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSession, type SessionUser } from '../api/session'
import styles from './Users.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const USERS_STALE_TIME_MS = 5_000
const USERS_REFETCH_INTERVAL_MS = 15_000

type UserRecord = {
  id: number
  email: string
  role: string
  high_priority_quota_minutes: number
  high_priority_minutes_used: number
  quota_resets_at: string | null
  high_priority_minutes_remaining?: number | null
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const isUserRecord = (value: unknown): value is UserRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const hasOptionalRemaining =
    record.high_priority_minutes_remaining === undefined ||
    record.high_priority_minutes_remaining === null ||
    typeof record.high_priority_minutes_remaining === 'number'

  const hasQuotaReset =
    'quota_resets_at' in record &&
    (typeof record.quota_resets_at === 'string' || record.quota_resets_at === null)

  return (
    typeof record.id === 'number' &&
    typeof record.email === 'string' &&
    typeof record.role === 'string' &&
    typeof record.high_priority_quota_minutes === 'number' &&
    typeof record.high_priority_minutes_used === 'number' &&
    hasQuotaReset &&
    hasOptionalRemaining
  )
}

const fetchUsers = async (): Promise<UserRecord[]> => {
  const res = await fetch(`${API_BASE}/users`, { credentials: 'include' })

  if (!res.ok) {
    let detail = 'Failed to load users. Please try again.'
    try {
      const data = await res.json()
      if (data?.detail) detail = Array.isArray(data.detail) ? data.detail[0]?.msg || detail : data.detail
    } catch { }
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

const formatQuotaResetAt = (value: string | null): string => {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

const Users = (): JSX.Element => {
  const queryClient = useQueryClient()
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
  const sessionQuery = useQuery<SessionUser, Error>({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  })

  const [isInviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFeedback, setInviteFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [quotaUser, setQuotaUser] = useState<UserRecord | null>(null)
  const [quotaValue, setQuotaValue] = useState('')
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [quotaSuccess, setQuotaSuccess] = useState<string | null>(null)

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
      } catch { }
      throw new Error(detail)
    },
  })

  const isSubmittingInvite = createInvitationMutation.isPending
  const updateQuotaMutation = useMutation<void, Error, { userId: number; quota: number }>({
    mutationFn: async ({ userId, quota }) => {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/quota`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ high_priority_quota_minutes: quota }),
      })

      if (res.ok) return

      let detail = 'Failed to update quota. Please try again.'
      try {
        const data = await res.json()
        if (data?.detail) detail = Array.isArray(data.detail) ? data.detail[0]?.msg || detail : data.detail
      } catch { }
      throw new Error(detail)
    },
    onSuccess: async (_, { quota }) => {
      setQuotaSuccess('Quota updated.')
      setQuotaError(null)
      setQuotaValue(String(quota))
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      setQuotaSuccess(null)
      setQuotaError(error.message || 'Failed to update quota.')
    },
  })
  const isAdmin = sessionQuery.data?.role === 'admin'

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

  useEffect(() => {
    if (!quotaSuccess || !quotaUser) return
    const timeoutId = window.setTimeout(() => {
      setQuotaUser(null)
      setQuotaValue('')
      setQuotaError(null)
      setQuotaSuccess(null)
    }, 1000)
    return () => window.clearTimeout(timeoutId)
  }, [quotaSuccess, quotaUser])

  const handleOpenQuotaModal = (user: UserRecord) => {
    setQuotaUser(user)
    setQuotaValue(String(user.high_priority_quota_minutes))
    setQuotaError(null)
    setQuotaSuccess(null)
  }

  const handleCloseQuotaModal = () => {
    if (updateQuotaMutation.isPending) return
    setQuotaUser(null)
    setQuotaValue('')
    setQuotaError(null)
    setQuotaSuccess(null)
  }

  const handleQuotaChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuotaValue(event.target.value)
    if (quotaError) setQuotaError(null)
    if (quotaSuccess) setQuotaSuccess(null)
  }

  const handleQuotaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!quotaUser || updateQuotaMutation.isPending) return

    const parsed = Number(quotaValue)
    if (!Number.isInteger(parsed) || parsed < 0) {
      setQuotaError('Quota must be a non-negative whole number of minutes.')
      return
    }

    try {
      await updateQuotaMutation.mutateAsync({ userId: quotaUser.id, quota: parsed })
    } catch {
      // handled in onError
    }
  }

  return (
    <section className={styles.users}>
      <header className={styles.header}>
        <div>
          <h1>Users</h1>
          <p>Manage user roles, invitations, and access controls.</p>
        </div>
        {isAdmin ? (
          <div className={styles.cardActions}>
            <button type="button" className={styles.primaryAction} onClick={handleOpenInvite}>
              Invite User
            </button>
          </div>
        ) : null}
      </header>

      {inviteFeedback ? (
        <div
          className={`${styles.feedback} ${inviteFeedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError
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
              <th scope="col">High priority quota (min)</th>
              <th scope="col">High priority used (min)</th>
              <th scope="col">Quota resets at</th>
              {isAdmin ? (
                <th scope="col" className={styles.actionsCol}>
                  Actions
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {isLoadingUsers ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={styles.tableMessage}>
                  Loading users...
                </td>
              </tr>
            ) : isUsersError ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={styles.tableMessageError}>
                  {getErrorMessage(usersError, 'Unable to load users. Please try again later.')}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={styles.tableMessage}>
                  No users found.
                </td>
              </tr>
            ) : (
              users.map(
                ({ id, email, role, high_priority_quota_minutes, high_priority_minutes_used, quota_resets_at }) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{email}</td>
                    <td>{role}</td>
                    <td>{high_priority_quota_minutes.toLocaleString()}</td>
                    <td>{high_priority_minutes_used.toLocaleString()}</td>
                    <td>{formatQuotaResetAt(quota_resets_at)}</td>
                    {isAdmin ? (
                      <td>
                        <button
                          type="button"
                          className={styles.inlineButton}
                          onClick={() =>
                            handleOpenQuotaModal({
                              id,
                              email,
                              role,
                              high_priority_quota_minutes,
                              high_priority_minutes_used,
                              quota_resets_at,
                            })
                          }
                        >
                          Edit quota
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {quotaUser ? (
        <div className={styles.modalOverlay} role="presentation" onClick={handleCloseQuotaModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotaModalTitle"
            onClick={handleModalClick}
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleCloseQuotaModal}
              aria-label="Close quota dialog"
              disabled={updateQuotaMutation.isPending}
            >
              &times;
            </button>
            <h2 id="quotaModalTitle" className={styles.modalTitle}>
              Update quota
            </h2>
            <p className={styles.modalDescription}>
              Set the high-priority quota for <strong>{quotaUser.email}</strong>.
            </p>

            {quotaError ? (
              <div className={`${styles.feedback} ${styles.feedbackError}`} role="alert">
                {quotaError}
              </div>
            ) : null}
            {quotaSuccess ? (
              <div className={`${styles.feedback} ${styles.feedbackSuccess}`} role="status">
                {quotaSuccess}
              </div>
            ) : null}

            <form className={styles.modalForm} onSubmit={handleQuotaSubmit}>
              <label htmlFor="quotaInput">
                High priority quota (minutes)
                <input
                  id="quotaInput"
                  type="number"
                  min={0}
                  step={1}
                  value={quotaValue}
                  onChange={handleQuotaChange}
                  disabled={updateQuotaMutation.isPending}
                  required
                />
              </label>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleCloseQuotaModal}
                  disabled={updateQuotaMutation.isPending}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.primaryAction} disabled={updateQuotaMutation.isPending}>
                  {updateQuotaMutation.isPending ? 'Saving...' : 'Save quota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

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
