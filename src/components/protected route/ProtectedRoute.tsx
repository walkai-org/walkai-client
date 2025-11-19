import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSession, UnauthorizedSessionError, type SessionUser } from '../../api/session'

type SessionErrorCode = 'unauth' | 'error'

type SessionError = Error & { code: SessionErrorCode }

const createSessionError = (message: string, code: SessionErrorCode): SessionError =>
  Object.assign(new Error(message), { code })

type ProtectedRouteProps = {
  children: ReactElement
}

const SESSION_REFETCH_INTERVAL_MS = 30_000

export default function ProtectedRoute({ children }: ProtectedRouteProps): ReactElement | null {
  const navigate = useNavigate()

  const sessionQuery = useQuery<SessionUser, SessionError>({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await fetchSession()
      } catch (error) {
        if (error instanceof UnauthorizedSessionError) {
          throw createSessionError('Unauthorized', 'unauth')
        }
        if (error instanceof Error) {
          throw createSessionError(error.message, 'error')
        }
        throw createSessionError('Failed to verify session', 'error')
      }
    },
    retry: false,
    refetchInterval: SESSION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    if (sessionQuery.isError) navigate('/', { replace: true })
  }, [sessionQuery.isError, navigate])

  if (sessionQuery.isPending) {
    return <div style={{ padding: 24 }}>Checking session…</div>
  }
  if (sessionQuery.isError) return null
  return children
}
