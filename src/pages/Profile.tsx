import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSession, type SessionUser } from '../api/session'
import styles from './Profile.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type RawPersonalAccessToken = {
  id: number
  name: string
  created_at?: string | null
  last_used_at?: string | null
}

type PersonalAccessToken = {
  id: number
  name: string
  createdAt: string | null
  lastUsedAt: string | null
}

type CreateTokenResponse = {
  token?: string
}

const TOKENS_QUERY_KEY = ['personal-access-tokens'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

const isRawPersonalAccessToken = (value: unknown): value is RawPersonalAccessToken => {
  if (!isRecord(value)) return false
  return typeof value.id === 'number' && typeof value.name === 'string'
}

const toPersonalAccessToken = (token: RawPersonalAccessToken): PersonalAccessToken => ({
  id: token.id,
  name: token.name,
  createdAt: token.created_at ?? null,
  lastUsedAt: token.last_used_at ?? null,
})

const readDetailFromPayload = (payload: unknown): string | null => {
  if (!isRecord(payload)) return null
  const { detail } = payload
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0]
    if (isRecord(first) && typeof first.msg === 'string' && first.msg.trim()) return first.msg
  }
  return null
}

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = await response.json()
    const detail = readDetailFromPayload(payload)
    if (detail) return detail
  } catch { }
  return fallback
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

const fetchPersonalAccessTokens = async (): Promise<PersonalAccessToken[]> => {
  const response = await fetch(`${API_BASE}/users/me/tokens/`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load personal access tokens. Please try again.'))
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable tokens response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isRawPersonalAccessToken)) {
    throw new Error('Received malformed tokens response. Please contact support.')
  }

  return payload.map(toPersonalAccessToken)
}

const createPersonalAccessToken = async (name: string): Promise<CreateTokenResponse> => {
  const response = await fetch(`${API_BASE}/users/me/tokens/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create token. Please try again.'))
  }

  try {
    const payload: unknown = await response.json()
    if (!isRecord(payload)) return {}
    const token = typeof payload.token === 'string' && payload.token.trim() ? payload.token : undefined
    return token ? { token } : {}
  } catch {
    return {}
  }
}

const deletePersonalAccessToken = async (tokenId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/users/me/tokens/${tokenId}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete token. Please try again.'))
  }
}

const submitClusterConfig = async (clusterUrl: string, clusterToken: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/cluster/cluster-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cluster_url: clusterUrl, cluster_token: clusterToken }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to save cluster configuration. Please try again.'))
  }
}

const formatDateTime = (value: string | null): string => {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

const formatQuotaResetAt = (value: string | null): string => {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

const Profile = (): JSX.Element => {
  const queryClient = useQueryClient()
  const clusterResetTimerRef = useRef<number | null>(null)
  const lastSubmittedClusterRef = useRef<{ url: string; token: string } | null>(null)

  const [tokenName, setTokenName] = useState('')
  const [tokenNameError, setTokenNameError] = useState<string | null>(null)
  const [generatedTokenValue, setGeneratedTokenValue] = useState<string | null>(null)
  const [confirmingTokenId, setConfirmingTokenId] = useState<number | null>(null)
  const [isEmptyTokensNoticeDismissed, setEmptyTokensNoticeDismissed] = useState(false)
  const [clusterUrl, setClusterUrl] = useState('')
  const [clusterToken, setClusterToken] = useState('')
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [clusterSuccess, setClusterSuccess] = useState<string | null>(null)

  const sessionQuery = useQuery<SessionUser, Error>({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  })

  const tokensQuery = useQuery<PersonalAccessToken[], Error>({
    queryKey: TOKENS_QUERY_KEY,
    queryFn: fetchPersonalAccessTokens,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  })

  const createTokenMutation = useMutation<CreateTokenResponse, Error, string>({
    mutationFn: (name) => createPersonalAccessToken(name),
    onSuccess: (data) => {
      setGeneratedTokenValue(data.token ?? null)
      setTokenName('')
      setTokenNameError(null)
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY })
    },
  })

  const deleteTokenMutation = useMutation<void, Error, number>({
    mutationFn: (tokenId) => deletePersonalAccessToken(tokenId),
    onSuccess: (_, tokenId) => {
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY })
      setConfirmingTokenId((current) => (current === tokenId ? null : current))
    },
  })

  const clusterConfigMutation = useMutation<void, Error, { clusterUrl: string; clusterToken: string }>({
    mutationFn: ({ clusterUrl, clusterToken }) => submitClusterConfig(clusterUrl, clusterToken),
    onSuccess: () => {
      setClusterSuccess('Cluster configuration saved.')
      setClusterError(null)
      if (clusterResetTimerRef.current) {
        window.clearTimeout(clusterResetTimerRef.current)
      }
      clusterResetTimerRef.current = window.setTimeout(() => {
        setClusterUrl((current) =>
          lastSubmittedClusterRef.current?.url === current ? '' : current,
        )
        setClusterToken((current) =>
          lastSubmittedClusterRef.current?.token === current ? '' : current,
        )
        setClusterSuccess(null)
        if (clusterResetTimerRef.current) {
          window.clearTimeout(clusterResetTimerRef.current)
          clusterResetTimerRef.current = null
        }
      }, 3_000)
    },
  })

  useEffect(() => {
    return () => {
      if (clusterResetTimerRef.current) {
        window.clearTimeout(clusterResetTimerRef.current)
      }
    }
  }, [])

  const handleTokenNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTokenName(event.target.value)
    if (tokenNameError) setTokenNameError(null)
  }

  const handleClusterFieldChange =
    (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value)
      if (clusterError) setClusterError(null)
      if (clusterSuccess) setClusterSuccess(null)
    }

  const handleCreateToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = tokenName.trim()

    if (!trimmed) {
      setTokenNameError('Please provide a descriptive name.')
      return
    }

    try {
      await createTokenMutation.mutateAsync(trimmed)
    } catch (error) {
      window.alert(getErrorMessage(error, 'Unable to create token. Please try again.'))
    }
  }

  const handleClusterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedUrl = clusterUrl.trim()
    const trimmedToken = clusterToken.trim()

    if (!trimmedUrl || !trimmedToken) {
      setClusterError('Please provide both a cluster URL and token.')
      setClusterSuccess(null)
      return
    }

    try {
      lastSubmittedClusterRef.current = { url: trimmedUrl, token: trimmedToken }
      await clusterConfigMutation.mutateAsync({ clusterUrl: trimmedUrl, clusterToken: trimmedToken })
    } catch (error) {
      setClusterError(getErrorMessage(error, 'Unable to save cluster configuration. Please try again.'))
      setClusterSuccess(null)
    }
  }

  const handleRequestDeleteToken = (tokenId: number) => {
    if (isDeletingToken) return
    setConfirmingTokenId((current) => (current === tokenId ? null : tokenId))
  }

  const handleCancelDeleteToken = () => {
    if (isDeletingToken) return
    setConfirmingTokenId(null)
  }

  const handleConfirmDeleteToken = async (tokenId: number) => {
    try {
      await deleteTokenMutation.mutateAsync(tokenId)
    } catch (error) {
      window.alert(getErrorMessage(error, 'Unable to delete token. Please try again.'))
    }
  }

  const tokens = tokensQuery.data ?? []
  const isDeletingToken = deleteTokenMutation.isPending
  const deletingTokenId = isDeletingToken ? deleteTokenMutation.variables : null
  const handleDismissGeneratedToken = () => setGeneratedTokenValue(null)
  const handleDismissEmptyTokensNotice = () => setEmptyTokensNoticeDismissed(true)
  const quotaMinutes = sessionQuery.data?.high_priority_quota_minutes ?? 0
  const usedMinutes = sessionQuery.data?.high_priority_minutes_used ?? 0
  const remainingMinutes =
    sessionQuery.data?.high_priority_minutes_remaining ?? Math.max(quotaMinutes - usedMinutes, 0)
  const totalForBar = Math.max(quotaMinutes, usedMinutes + remainingMinutes)
  const usedPercent = totalForBar > 0 ? Math.min(100, (usedMinutes / totalForBar) * 100) : 0
  const remainingPercent =
    totalForBar > 0 ? Math.max(0, Math.min(100 - usedPercent, (remainingMinutes / totalForBar) * 100)) : 0
  const isOverQuota = remainingMinutes <= 0 || usedMinutes > quotaMinutes
  const isAdmin = sessionQuery.data?.role === 'admin'

  return (
    <>
      <section className={styles.profile}>
      <header className={styles.header}>
        <div>
          <h1>Profile</h1>
          <p>Review your account details and manage personal access tokens.</p>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="profile-account">
          <div className={styles.cardHeader}>
            <h2 id="profile-account">Account</h2>
            <p>Your primary account information.</p>
          </div>
          {sessionQuery.isPending ? (
            <p className={styles.muted}>Loading account details…</p>
          ) : sessionQuery.isError ? (
            <p className={styles.error}>Unable to load account details. Please refresh.</p>
          ) : (
            <dl className={styles.details}>
              <div>
                <dt>Email</dt>
                <dd>{sessionQuery.data?.email ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{sessionQuery.data?.role ?? 'Not assigned'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className={styles.card} aria-labelledby="profile-tokens">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="profile-tokens">Personal Access Tokens</h2>
              <p>Create tokens for CLI or automation access.</p>
            </div>
          </div>

          <form className={styles.tokenForm} onSubmit={handleCreateToken}>
            <label htmlFor="token-name">Token name</label>
            <div className={styles.tokenFormRow}>
              <input
                id="token-name"
                name="tokenName"
                type="text"
                value={tokenName}
                onChange={handleTokenNameChange}
                placeholder="e.g. CLI"
                disabled={createTokenMutation.isPending}
                aria-invalid={tokenNameError ? 'true' : 'false'}
              />
              <button type="submit" disabled={createTokenMutation.isPending}>
                {createTokenMutation.isPending ? 'Creating…' : 'Generate token'}
              </button>
            </div>
            {tokenNameError ? <p className={styles.fieldError}>{tokenNameError}</p> : null}
            {createTokenMutation.isError ? (
              <p className={styles.error}>
                {getErrorMessage(createTokenMutation.error, 'Failed to create token. Please try again.')}
              </p>
            ) : null}
          </form>

          {generatedTokenValue ? (
            <div className={styles.tokenNotice} role="status">
              <div className={styles.tokenNoticeHeader}>
                <strong>New token</strong>
                <button
                  type="button"
                  className={styles.tokenNoticeClose}
                  onClick={handleDismissGeneratedToken}
                  aria-label="Dismiss generated token"
                />
              </div>
              <code className={styles.tokenValue}>{generatedTokenValue}</code>
              <p>This token is shown only once. Store it securely now.</p>
            </div>
          ) : null}

          <div className={styles.tokenList}>
            {tokensQuery.isPending ? (
              <p className={styles.muted}>Loading tokens…</p>
            ) : tokensQuery.isError ? (
              <p className={styles.error}>
                {getErrorMessage(tokensQuery.error, 'Unable to load tokens. Please refresh.')}
              </p>
            ) : tokens.length === 0 ? (
              <>
                {!isEmptyTokensNoticeDismissed ? (
                  <div className={styles.tokenNotice} role="status">
                    <div className={styles.tokenNoticeHeader}>
                      <strong>Haven&apos;t set up the Walk:AI CLI yet?</strong>
                      <button
                        type="button"
                        className={styles.tokenNoticeClose}
                        onClick={handleDismissEmptyTokensNotice}
                        aria-label="Dismiss CLI setup notice"
                      />
                    </div>
                    <p>
                      Create a new personal access token and follow the
                      instructions at{' '}
                      <a
                        href="https://github.com/walkai-org/walkai-cli?tab=readme-ov-file#walkai-cli"
                        target="_blank"
                        rel="noreferrer"
                      >
                        walkai-cli README
                      </a>
                      .
                    </p>
                  </div>
                ) : null}
                <p className={styles.muted}>No tokens yet. Create one to get started.</p>
              </>
            ) : (
              <ul className={styles.tokens} aria-live="polite">
                {tokens.map((token) => (
                  <li key={token.id} className={styles.tokenItem}>
                    <div className={styles.tokenMeta}>
                      <h3>{token.name}</h3>
                      <p>
                        Created: {formatDateTime(token.createdAt)}
                      </p>
                    </div>
                    <div className={styles.deleteControls}>
                      <button
                        type="button"
                        onClick={() => handleRequestDeleteToken(token.id)}
                        disabled={isDeletingToken}
                        className={styles.deleteButton}
                        aria-haspopup="dialog"
                        aria-expanded={confirmingTokenId === token.id}
                        aria-controls={confirmingTokenId === token.id ? `token-${token.id}-confirm` : undefined}
                      >
                        Delete
                      </button>
                      {confirmingTokenId === token.id ? (
                        <div
                          id={`token-${token.id}-confirm`}
                          className={styles.deleteConfirm}
                          role="alert"
                          aria-live="assertive"
                        >
                          <p>Remove this token? This action cannot be undone.</p>
                          <div className={styles.deleteActions}>
                            <button
                              type="button"
                              className={styles.deleteCancel}
                              onClick={handleCancelDeleteToken}
                              disabled={isDeletingToken}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={styles.deleteConfirmButton}
                              onClick={() => handleConfirmDeleteToken(token.id)}
                              disabled={isDeletingToken}
                            >
                              {isDeletingToken && deletingTokenId === token.id ? 'Removing…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </div>

      <section className={styles.card} aria-labelledby="profile-usage">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="profile-usage">Usage</h2>
            <p>Track your high priority minutes allocation.</p>
          </div>
        </div>

        {sessionQuery.isPending ? (
          <p className={styles.muted}>Loading usage…</p>
        ) : sessionQuery.isError ? (
          <p className={styles.error}>Unable to load usage details. Please refresh.</p>
        ) : (
          <>
            <div className={styles.usageBar} role="presentation" aria-hidden="true">
              <span
                className={`${styles.usageUsed} ${isOverQuota ? styles.usageUsedOver : ''}`}
                style={{ width: `${usedPercent}%` }}
              />
              <span className={styles.usageRemaining} style={{ width: `${remainingPercent}%` }} />
            </div>
            <dl className={styles.usageStats}>
              <div>
                <dt>Total quota</dt>
                <dd>{quotaMinutes.toLocaleString()} min</dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd className={styles.usageStatValue}>
                  <span className={`${styles.usageDot} ${styles.usageDotUsed}`} aria-hidden="true" />
                  {usedMinutes.toLocaleString()} min
                </dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd className={styles.usageStatValue}>
                  <span className={`${styles.usageDot} ${isOverQuota ? styles.usageDotRemainingOver : styles.usageDotRemaining}`} aria-hidden="true" />
                  {remainingMinutes.toLocaleString()} min
                </dd>
              </div>
            </dl>
            <p className={styles.usageReset}>
              Resets: {formatQuotaResetAt(sessionQuery.data?.quota_resets_at ?? null)}
            </p>
          </>
        )}
      </section>
    </section>

    {isAdmin ? (
      <section className={styles.card} aria-labelledby="profile-cluster">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="profile-cluster">Cluster</h2>
            <p>Configure the cluster connection details for Walk:AI.</p>
          </div>
        </div>

        <form className={styles.clusterForm} onSubmit={handleClusterSubmit} autoComplete="off">
          <label htmlFor="cluster-url">Cluster URL</label>
          <input
            id="cluster-url"
            name="clusterUrl"
            type="text"
            value={clusterUrl}
            onChange={handleClusterFieldChange(setClusterUrl)}
            placeholder="https://cluster.example.com"
            autoComplete="off"
            required
            disabled={clusterConfigMutation.isPending}
          />

          <label htmlFor="cluster-token">Cluster token</label>
          <input
            id="cluster-token"
            name="clusterToken"
            type="password"
            value={clusterToken}
            onChange={handleClusterFieldChange(setClusterToken)}
            autoComplete="new-password"
            required
            disabled={clusterConfigMutation.isPending}
          />

          <button type="submit" disabled={clusterConfigMutation.isPending}>
            {clusterConfigMutation.isPending ? 'Saving…' : 'Save cluster'}
          </button>

          {clusterError ? <p className={styles.fieldError}>{clusterError}</p> : null}
          {clusterSuccess ? <p className={styles.success}>{clusterSuccess}</p> : null}
        </form>
      </section>
    ) : null}
    </>
  )
}

export default Profile
