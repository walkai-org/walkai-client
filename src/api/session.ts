const API_BASE = import.meta.env.VITE_API_BASE;

export type SessionUser = {
  id: number
  email: string
  role?: string
  high_priority_quota_minutes: number
  high_priority_minutes_used: number
  quota_resets_at: string | null
  high_priority_minutes_remaining: number | null
}

export class UnauthorizedSessionError extends Error {
  constructor(message = 'Unauthorized access') {
    super(message)
    this.name = 'UnauthorizedSessionError'
  }
}

const isSessionUser = (value: unknown): value is SessionUser => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const hasQuotaReset =
    'quota_resets_at' in record && (typeof record.quota_resets_at === 'string' || record.quota_resets_at === null)

  const hasRemaining =
    'high_priority_minutes_remaining' in record &&
    (typeof record.high_priority_minutes_remaining === 'number' || record.high_priority_minutes_remaining === null)

  return (
    typeof record.id === 'number' &&
    typeof record.email === 'string' &&
    typeof record.high_priority_quota_minutes === 'number' &&
    typeof record.high_priority_minutes_used === 'number' &&
    hasQuotaReset &&
    hasRemaining
  )
}

export const fetchSession = async (): Promise<SessionUser> => {
  const response = await fetch(`${API_BASE}/me`, {
    method: 'GET',
    credentials: 'include',
  })

  if (response.status === 401) {
    throw new UnauthorizedSessionError()
  }

  if (!response.ok) {
    throw new Error(`Unable to verify current session (${response.status})`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable session response')
  }

  if (!isSessionUser(payload)) {
    throw new Error('Received malformed session response')
  }

  return payload
}
