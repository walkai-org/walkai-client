import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JSX } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import styles from './PodDetail.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const GPU_PROFILES = ['1g.10gb', '2g.20gb', '3g.40gb', '4g.40gb', '7g.79gb'] as const
const GPU_PROFILE_ORDER = new Map(GPU_PROFILES.map((profile, index) => [profile, index]))
const MAX_LOG_LINES = 500

type GPUProfile = (typeof GPU_PROFILES)[number]

type ClusterPod = {
  name: string
  namespace: string
  status: string
  gpu: GPUProfile
  start_time: string | null
  finish_time: string | null
}

type PodDetailLocationState = {
  pod?: ClusterPod
}

const getProfileOrder = (profile: GPUProfile): number => GPU_PROFILE_ORDER.get(profile) ?? GPU_PROFILES.length

const formatGpuLabel = (gpu: GPUProfile): string => gpu.replace(/gb$/i, '')

const formatStatusLabel = (status: string): string =>
  status
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown'

const getStatusStyleKey = (status: string): 'running' | 'pending' | 'failed' | 'succeeded' | 'unknown' => {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('run')) return 'running'
  if (normalized.includes('pend')) return 'pending'
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('succ') || normalized.includes('compl')) return 'succeeded'
  return 'unknown'
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return dateTimeFormatter.format(date)
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const isClusterPod = (value: unknown): value is ClusterPod => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const name = record.name
  const namespace = record.namespace
  const status = record.status
  const gpu = record.gpu
  const startTime = record.start_time
  const finishTime = record.finish_time

  const isGpuProfile = typeof gpu === 'string' && GPU_PROFILE_ORDER.has(gpu as GPUProfile)
  const isDateValue = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof name === 'string' &&
    name.length > 0 &&
    typeof namespace === 'string' &&
    namespace.length > 0 &&
    typeof status === 'string' &&
    status.length > 0 &&
    isGpuProfile &&
    isDateValue(startTime) &&
    isDateValue(finishTime)
  )
}

const fetchClusterPods = async (): Promise<ClusterPod[]> => {
  const response = await fetch(`${API_BASE}/cluster/pods`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = 'Failed to load pod data. Please try again.'
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail
      }
    } catch {
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable pod response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isClusterPod)) {
    throw new Error('Received malformed pod response. Please contact support.')
  }

  return payload.sort((a, b) => getProfileOrder(a.gpu) - getProfileOrder(b.gpu))
}

const PodDetail = (): JSX.Element => {
  const navigate = useNavigate()
  const location = useLocation()
  const { podName: routePodName } = useParams<{ podName: string }>()

  const podName = routePodName ? decodeURIComponent(routePodName) : ''
  const statePod = (location.state as PodDetailLocationState | undefined)?.pod

  const podsQuery = useQuery<ClusterPod[], Error>({
    queryKey: ['cluster', 'pods'],
    queryFn: fetchClusterPods,
    enabled: !statePod,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  const pod = useMemo(() => {
    if (statePod) return statePod
    if (!podName) return null
    return podsQuery.data?.find((candidate) => candidate.name === podName) ?? null
  }, [podName, podsQuery.data, statePod])

  const [logLines, setLogLines] = useState<string[]>([])
  const [logError, setLogError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    if (!podName) return undefined

    let isActive = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      follow: 'true',
      timestamps: 'true',
    })

    setLogLines([])
    setLogError(null)
    setIsStreaming(true)

    const streamLogs = async () => {
      try {
        const response = await fetch(`${API_BASE}/cluster/pods/${encodeURIComponent(podName)}/logs?${params}`, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        })

        if (!response.ok) {
          let detail = `Failed to stream logs for pod ${podName}.`
          try {
            const payload = (await response.json()) as { detail?: unknown }
            if (typeof payload?.detail === 'string' && payload.detail.trim()) {
              detail = payload.detail
            }
          } catch {
            // ignore parsing errors
          }
          if (!isActive) return
          setLogError(detail)
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          if (!isActive) return
          setLogError('Log streaming is not supported by this browser.')
          return
        }

        const decoder = new TextDecoder()
        let pending = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          pending += decoder.decode(value, { stream: true })
          const parts = pending.split('\n')
          pending = parts.pop() ?? ''

          if (!isActive || parts.length === 0) continue

          setLogLines((previous) => {
            const next = [...previous, ...parts]
            if (next.length <= MAX_LOG_LINES) return next
            return next.slice(-MAX_LOG_LINES)
          })
        }

        const finalChunk = pending + decoder.decode()
        if (isActive && finalChunk) {
          setLogLines((previous) => {
            const next = [...previous, finalChunk]
            if (next.length <= MAX_LOG_LINES) return next
            return next.slice(-MAX_LOG_LINES)
          })
        }
      } catch (error) {
        if (controller.signal.aborted || !isActive) {
          return
        }
        setLogError(getErrorMessage(error, `Failed to stream logs for pod ${podName}.`))
      } finally {
        if (isActive) {
          setIsStreaming(false)
        }
      }
    }

    void streamLogs()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [podName])

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const handleBack = () => {
    navigate(-1)
  }

  const LOADING_META_MESSAGE = 'Loading pod metadata…'

  const metaState = (() => {
    if (pod) return null
    if (!podName) return 'Pod name is not specified.'
    if (podsQuery.isPending) return LOADING_META_MESSAGE
    if (podsQuery.isError) return podsQuery.error.message
    return 'Pod metadata is unavailable.'
  })()

  const metaStateIsError = Boolean(metaState && metaState !== LOADING_META_MESSAGE)
  const metaStateClassName = metaStateIsError ? `${styles.state} ${styles.stateError}` : styles.state

  return (
    <section className={styles.podDetail}>
      <header className={styles.header}>
        <div>
          <h1>Pod {podName || 'Unknown'}</h1>
          <p>Monitor live logs and metadata for this workload.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.backButton} onClick={handleBack}>
            Back
          </button>
          <Link to="/app/dashboard" className={styles.linkButton}>
            View dashboard
          </Link>
        </div>
      </header>

      {metaState ? (
        <p className={metaStateClassName}>{metaState}</p>
      ) : (
        pod && (
          <section className={styles.metaSection} aria-labelledby="pod-overview-heading">
            <h2 id="pod-overview-heading">Overview</h2>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Pod</dt>
                <dd className={styles.monospace}>{pod.name}</dd>
              </div>
              <div>
                <dt>Namespace</dt>
                <dd className={styles.monospace}>{pod.namespace}</dd>
              </div>
              <div>
                <dt>GPU Profile</dt>
                <dd>{formatGpuLabel(pod.gpu)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={getStatusClassName(pod.status)}>{formatStatusLabel(pod.status)}</span>
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(pod.start_time)}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{formatDateTime(pod.finish_time)}</dd>
              </div>
            </dl>
          </section>
        )
      )}

      <section className={styles.logsSection} aria-labelledby="pod-logs-heading">
        <div className={styles.logsHeading}>
          <h2 id="pod-logs-heading">Live Logs</h2>
          <span className={styles.streamStatus}>
            <span
              className={`${styles.streamIndicator} ${!isStreaming ? styles.streamIndicatorPaused : ''}`.trim()}
              aria-hidden
            />
            {isStreaming ? 'Streaming' : 'Paused'}
          </span>
        </div>

        {logError ? (
          <p className={`${styles.state} ${styles.stateError}`}>{logError}</p>
        ) : (
          <div className={styles.logsContainer} role="log" aria-live="polite">
            {logLines.length === 0 ? (
              <p>Waiting for log entries…</p>
            ) : (
              logLines.map((line, index) => (
                <p key={`${podName}-log-${index}`} className={styles.logLine}>
                  {line}
                </p>
              ))
            )}
          </div>
        )}
      </section>
    </section>
  )
}

export default PodDetail
