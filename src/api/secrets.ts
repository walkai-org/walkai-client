const API_BASE = import.meta.env.VITE_API_BASE;

export type SecretSummary = {
  name: string
}

export type SecretDetail = {
  name: string
  keys: string[]
}

export type CreateSecretPayload = {
  name: string
  data: Record<string, string>
}

const isSecretSummary = (value: unknown): value is SecretSummary => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' && record.name.trim().length > 0
}

const isSecretDetail = (value: unknown): value is SecretDetail => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const keys = record.keys
  return typeof record.name === 'string' && Array.isArray(keys) && keys.every((key) => typeof key === 'string')
}

export const fetchSecrets = async (): Promise<SecretSummary[]> => {
  const response = await fetch(`${API_BASE}/secrets/`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load secrets (status ${response.status}).`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable secrets response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isSecretSummary)) {
    throw new Error('Received malformed secrets response. Please contact support.')
  }

  return payload
}

export const fetchSecretDetail = async (secretName: string): Promise<SecretDetail> => {
  const response = await fetch(`${API_BASE}/secrets/${encodeURIComponent(secretName)}`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load details for “${secretName}” (status ${response.status}).`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable secret detail response. Please try again.')
  }

  if (!isSecretDetail(payload)) {
    throw new Error('Received malformed secret detail response. Please contact support.')
  }

  return payload
}

export const createSecret = async ({ name, data }: CreateSecretPayload): Promise<void> => {
  const response = await fetch(`${API_BASE}/secrets/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, data }),
  })

  if (!response.ok) {
    let detail = `Failed to create secret (status ${response.status}).`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      const errorDetail = payload?.detail
      if (typeof errorDetail === 'string' && errorDetail.trim()) {
        detail = errorDetail
      } else if (Array.isArray(errorDetail)) {
        const message = errorDetail
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const maybeRecord = item as { msg?: unknown }
            return typeof maybeRecord.msg === 'string' ? maybeRecord.msg : null
          })
          .filter((msg): msg is string => Boolean(msg))
          .join('\n')
        if (message) {
          detail = message
        }
      }
    } catch {
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }
}

export const deleteSecret = async (secretName: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/secrets/${encodeURIComponent(secretName)}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = `Failed to delete secret (status ${response.status}).`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      const errorDetail = payload?.detail
      if (typeof errorDetail === 'string' && errorDetail.trim()) {
        detail = errorDetail
      } else if (Array.isArray(errorDetail)) {
        const message = errorDetail
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const maybeRecord = item as { msg?: unknown }
            return typeof maybeRecord.msg === 'string' ? maybeRecord.msg : null
          })
          .filter((msg): msg is string => Boolean(msg))
          .join('\n')
        if (message) {
          detail = message
        }
      }
    } catch {
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }
}
